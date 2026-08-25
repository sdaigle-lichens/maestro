// The Claude Agent SDK — the ground the session pane stands on.
//
// GET THE PACKAGE RIGHT. This is `@anthropic-ai/claude-agent-sdk`: it spawns the `claude` CLI the
// user is already logged into, and the work draws on their subscription. It is NOT
// `@anthropic-ai/sdk`, the REST client for the Messages API — that one takes an API key, bills
// pay-as-you-go, spawns nothing and has no `canUseTool`. The names differ by one path segment, both
// install without complaint, and the wrong one defeats the entire point while looking correct.
// Same trap in the repos: `anthropics/claude-agent-sdk-typescript` is this SDK,
// `anthropics/anthropic-sdk-typescript` is not.
//
// Three things live here. `runAgentSdkSmoke` exists to prove, on the machine the app is actually
// installed on, that a query runs at all — see SESSION-PANE-PLAN.md, of which this is the first
// slice. `nodeSettings()` resolves the effective settings cascade so the confirmation dialog can
// state what a run will actually be able to read; it spawns no CLI (see its own comment) and is
// handed to the preview as a PORT, because the preview may not import this module.
// `startAgentSession()` is the third and the one that does the work: it is what `claude-run.ts`
// executes a previewed invocation with, in place of the `claude -p` spawn it used to be.
//
// This is also the only module in the app that imports the SDK, and `test/isolation.test.ts` pins
// that: the SDK is a second path to the `claude` binary, and the options it is given decide the
// permission model of everything built on it.
//
// ┌─ THREE THINGS THAT ONLY FAIL IN A PACKAGED BUILD ──────────────────────────────────────────┐
// │                                                                                             │
// │ 1. THE SDK MUST BE EXTERNALIZED. It is in the desktop app's package.json `dependencies` —   │
// │    the block `externalizeDepsPlugin` derives its externals from, and a block this app did    │
// │    not have until this slice, since everything it uses is a devDependency. Bundled instead,  │
// │    the SDK's own `require.resolve` of a CLI on disk resolves against the bundle and throws   │
// │    `Native CLI binary for <platform> not found`. It must NOT join the `exclude:` list in     │
// │    electron.vite.config.ts — that list is for workspace SOURCE packages with no build        │
// │    artifact to resolve, which is the opposite case.                                         │
// │                                                                                             │
// │ 2. ASAR IS THE SECOND HALF, AND IS NOT ACTIONABLE YET. Externalizing gets `require` to look  │
// │    for the package at runtime; in a packaged app it then looks inside `app.asar`, where a    │
// │    native binary cannot be executed. The fix is `asar: { unpack:                             │
// │    "**/node_modules/@anthropic-ai/**" }` plus rewriting `app.asar` → `app.asar.unpacked` on  │
// │    the resolved path. It is the single most reported Agent-SDK-in-Electron failure. THERE IS │
// │    NO electron-builder CONFIG IN THIS REPO, so there is nowhere to write it: this is a       │
// │    constraint on whoever adds packaging, not an omission here. (We sidestep the bundled      │
// │    binary entirely — see 3 — but the app's own `node_modules` copy of the SDK is still       │
// │    inside the archive.)                                                                     │
// │                                                                                             │
// │ 3. THE CLI PATH IS HANDED OVER, NEVER LOOKED UP. Left to itself the SDK spawns NODE to run   │
// │    a bundled `cli.js`, and a GUI-launched Electron app has a PATH with no `node` on it — the │
// │    failure reads `spawn node ENOENT` and does not reproduce from a terminal. `claude-cli.ts` │
// │    already resolves the real binary with `fs` for exactly this reason (on a machine with the │
// │    native installer, `~/.local/bin/claude` is a single-file binary needing no runtime at     │
// │    all), so `pathToClaudeCodeExecutable` gets that answer and the SDK never guesses.         │
// └─────────────────────────────────────────────────────────────────────────────────────────────┘
//
// A note on versions: the SDK tracks the CLI it was cut against patch-for-patch (0.3.222 ↔ 2.1.222)
// and the stdio control protocol between them is private. Pointing it at the user's own,
// self-updating `claude` is the right trade — that binary is the one they are logged into — but it
// means the two can drift. The smoke result reports both versions so a support answer can say so.

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { cliNotFoundMessage, resolveClaudeCli, claudeChildPath, type ResolveOptions } from "./claude-cli.js";
import { decideWrite, targetPathOf, READ_ONLY_TOOLS } from "./write-scope.js";
import { withinDirectory } from "./read-scope.js";
import { decideBoundary, grantOptionsFor } from "./session-scope.js";
import { autoRefusal, decidePaneCall, permissionReason, PANE_ASK_TOOLS } from "./session-permission.js";
import {
  answerQuestions,
  describeQuestions,
  QUESTION_PREVIEW_FORMAT,
  QUESTION_REFUSAL,
  QUESTION_TOOL,
  QUESTION_UNRENDERABLE,
} from "./session-question.js";
import { createPermissionRegistry } from "./permission-registry.js";
import type { StoredMessage, StoredSession } from "./session-resume.js";
import {
  accrueTurn,
  ceilingOf,
  ceilingTurnNote,
  exhaust,
  isPacingUnsupported,
  newSpend,
  paneBudget,
  DEFAULT_EFFORT,
  EFFORT_LEVELS,
  type BudgetPolicy,
} from "./session-budget.js";
import type {
  AgentQuestion,
  ClaudeOutputChunk,
  EffectiveSettingsSnapshot,
  ParkedAnswer,
  PermissionAnswer,
  QuestionChoice,
  SessionEffort,
  SessionEndReason,
  SessionEvent,
  SessionEventBody,
  SessionModel,
  SessionSpend,
  SettingsPermissions,
  SettingsPort,
  SettingsSourceInfo,
  SettingsTier,
} from "./contracts.js";

// Type-only, and therefore erased: `claude-run.ts` supplies the spawn function and must be able to
// type it without importing the SDK, which this module is the app's only importer of.
import type { SpawnOptions, SpawnedProcess } from "@anthropic-ai/claude-agent-sdk";
export type { SpawnOptions, SpawnedProcess };

/** The one correct package name, in one place, so a typo is a diff rather than a silent downgrade. */
export const AGENT_SDK_PACKAGE = "@anthropic-ai/claude-agent-sdk";

/**
 * Credentials that silently move the bill off the user's subscription and onto an API account.
 *
 * The SDK's `env` option REPLACES the subprocess environment rather than merging into it, which is
 * what makes dropping these possible at all — but also means the environment has to be built in
 * full, `PATH` included, or we re-acquire the bug `claude-cli.ts` exists to prevent.
 *
 * Both entries are here because both are believed-you rather than asked-about: a stray
 * `ANTHROPIC_API_KEY` in a shell profile, or an `ANTHROPIC_AUTH_TOKEN` from a gateway experiment,
 * turns every turn in this app into a pay-as-you-go API call with nothing on screen saying so.
 * Deliberately NOT here: `CLAUDE_CODE_USE_BEDROCK` / `CLAUDE_CODE_USE_VERTEX` and the like. Those
 * are a deployment the user configured on purpose, and dropping them would break a working setup
 * to defend an assumption; the smoke reports them instead (`otherProviderVars`).
 */
export const BILLING_ENV_VARS = ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"] as const;

/** Provider-selection variables left alone but worth reporting — they change WHO serves the model. */
const PROVIDER_ENV_VARS = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "CLAUDE_CODE_USE_BEDROCK",
  "CLAUDE_CODE_USE_VERTEX",
] as const;

/** How long a smoke query may take before it is aborted. It is one turn with no tools. */
const SMOKE_TIMEOUT_MS = 90_000;

/** What the smoke query asks for. Short, deterministic, and cheap enough to run on every launch. */
export const SMOKE_PROMPT = "Reply with exactly `MAESTRO_SDK_OK` and nothing else.";

/** The description of the environment handed to the child, for disclosure and for tests. */
export interface AgentChildEnv {
  env: Record<string, string | undefined>;
  /** Billing credentials that were present in the parent and are absent from `env`. */
  dropped: string[];
  /** Provider-selection variables still set — not removed, but not silent either. */
  otherProviderVars: string[];
}

/**
 * The environment the `claude` child runs in — constructed, not inherited.
 *
 * Two properties, and they pull in opposite directions, which is why this is a function rather than
 * an object literal at the call site:
 *
 *   • No billing credential survives. `{ ...process.env }` passed through would hand an
 *     `ANTHROPIC_API_KEY` to a CLI that would then happily use it, and the user would find out on
 *     an invoice. The keys are DELETED rather than set to `undefined`: `undefined` is dropped by
 *     `child_process.spawn` and is what the SDK's own type suggests, but absence is the property we
 *     actually want and the only one a test can assert without knowing how the SDK spreads it.
 *   • `PATH` survives, and is the expanded one. `env` replaces rather than merges, so the naive
 *     "just drop the key" also drops PATH — and the CLI shells out to `git`, to hooks, to whatever
 *     the project runs. It gets the same list `claude-cli.ts` searched, for the same reason.
 */
export function agentChildEnv(opts: ResolveOptions = {}): AgentChildEnv {
  const parent = opts.env ?? process.env;
  const env: Record<string, string | undefined> = { ...parent };

  const dropped: string[] = [];
  for (const key of BILLING_ENV_VARS) {
    if (env[key]) dropped.push(key);
    delete env[key];
  }

  env.PATH = claudeChildPath(opts);

  return {
    env,
    dropped,
    otherProviderVars: PROVIDER_ENV_VARS.filter((key) => Boolean(parent[key])),
  };
}

/** Where the money for a query goes, as the CLI itself reports it on the init message. */
export type AgentBilling = "subscription" | "api-key" | "unknown";

/**
 * Read the billing shape off the init message's `apiKeySource`.
 *
 * `"oauth"` is the subscription login. `"none"` also means the subscription: the documented union
 * does not contain it, but the CLI emits it at runtime when no API key is in play, which is exactly
 * the state this app wants to be in. Everything else names a place an API key came from — so it is
 * an API bill, and the caller should say so rather than assume.
 */
export function billingFrom(apiKeySource: string | null): AgentBilling {
  if (apiKeySource === "oauth" || apiKeySource === "none") return "subscription";
  if (apiKeySource === null) return "unknown";
  return "api-key";
}

/** The receipt a smoke query leaves. Everything a support answer or a next slice would want. */
export interface AgentSdkSmokeResult {
  ok: boolean;
  /** ISO timestamp, so a stale receipt on disk cannot be mistaken for this launch's. */
  at: string;
  durationMs: number;
  /** The exact executable handed to the SDK. Null means the CLI was not found and nothing ran. */
  bin: string | null;
  cwd: string;
  sdkVersion: string | null;
  /** What the child reported about itself — the other half of the version pair. */
  cliVersion: string | null;
  apiKeySource: string | null;
  billing: AgentBilling;
  model: string | null;
  /** The text of the SDK result message. Its presence IS the acceptance criterion. */
  result: string | null;
  costUsd: number | null;
  numTurns: number | null;
  env: {
    /** Billing credentials found in the parent environment and withheld from the child. */
    dropped: string[];
    /** Provider-selection variables still set. Not removed; see BILLING_ENV_VARS. */
    otherProviderVars: string[];
    /** Both asserted rather than assumed: `env` replaces, so either could be lost in one edit. */
    hasPath: boolean;
    hasApiKey: boolean;
  };
  /** Whatever the CLI wrote to stderr, tail-capped. Empty on a healthy run. */
  stderr: string;
  error: string | null;
}

/**
 * The SDK's own version, read from the package `require` actually resolves to.
 *
 * Resolved rather than imported from a constant: the number that matters is the one on disk next to
 * the running bundle, which in a packaged app is not necessarily the one in the manifest. Null when
 * resolution fails, which is itself the interesting answer — it is what the asar failure looks like.
 */
function sdkVersion(): string | null {
  try {
    // The entry point, then its manifest beside it — NOT `resolve("<pkg>/package.json")`, which
    // throws ERR_PACKAGE_PATH_NOT_EXPORTED: this package's `exports` map lists ".", "./extract",
    // "./browser", "./bridge" and "./sdk-tools", and a manifest that is not exported is not
    // resolvable however obviously it is there.
    const entry = createRequire(import.meta.url).resolve(AGENT_SDK_PACKAGE);
    const manifest = path.join(path.dirname(entry), "package.json");
    return (JSON.parse(fs.readFileSync(manifest, "utf8")).version as string) ?? null;
  } catch {
    return null;
  }
}

export interface SmokeOptions extends ResolveOptions {
  /** Where to run. Defaults to the app's own cwd; nothing is read and nothing is written. */
  cwd?: string;
  timeoutMs?: number;
}

/**
 * Run one query through the SDK and report what came back.
 *
 * The import is dynamic, and that is not laziness about typing — it is what keeps 1.3 MB of SDK off
 * the app's startup path, since a launch that never opens a session should never parse it. It is
 * still a runtime resolution of an EXTERNAL package either way, which is the property this slice is
 * about; `test/isolation.test.ts` asserts the built bundle carries the specifier rather than the
 * source.
 *
 * Never throws. A missing CLI, a failed import (the asar case above), an aborted read loop and a
 * CLI that errors are all outcomes to report, because every one of them is a thing a user could be
 * looking at and the difference between them is the whole diagnostic value.
 */
export async function runAgentSdkSmoke(opts: SmokeOptions = {}): Promise<AgentSdkSmokeResult> {
  const startedAt = Date.now();
  const cwd = opts.cwd ?? process.cwd();
  const cli = resolveClaudeCli(opts);
  const { env, dropped, otherProviderVars } = agentChildEnv(opts);

  const base: AgentSdkSmokeResult = {
    ok: false,
    at: new Date().toISOString(),
    durationMs: 0,
    bin: cli.bin,
    cwd,
    sdkVersion: sdkVersion(),
    cliVersion: null,
    apiKeySource: null,
    billing: "unknown",
    model: null,
    result: null,
    costUsd: null,
    numTurns: null,
    env: {
      dropped,
      otherProviderVars,
      hasPath: Boolean(env.PATH),
      hasApiKey: BILLING_ENV_VARS.some((key) => key in env),
    },
    stderr: "",
    error: null,
  };

  const done = (patch: Partial<AgentSdkSmokeResult>): AgentSdkSmokeResult => ({
    ...base,
    ...patch,
    durationMs: Date.now() - startedAt,
  });

  if (!cli.available || !cli.bin) {
    return done({
      error: `The \`claude\` CLI was not found; looked in ${cli.searched.length} directories. Nothing was spawned.`,
    });
  }

  const stderr: string[] = [];
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), opts.timeoutMs ?? SMOKE_TIMEOUT_MS);
  timer.unref?.();

  try {
    // The specifier is a literal, not `AGENT_SDK_PACKAGE`: a variable would type the whole query as
    // `any` and every field read below would stop being checked. It stays external either way.
    const { query } = await import("@anthropic-ai/claude-agent-sdk");

    let cliVersion: string | null = null;
    let apiKeySource: string | null = null;
    let model: string | null = null;

    for await (const message of query({
      prompt: SMOKE_PROMPT,
      options: {
        cwd,
        // (3) above: the resolved binary, never the SDK's own PATH lookup or bundled cli.js.
        pathToClaudeCodeExecutable: cli.bin,
        env,
        // No tools at all. `allowedTools` would be the wrong lever — it auto-approves without
        // restricting, and unlisted tools still fall through to a prompt nobody is here to answer.
        tools: [],
        permissionMode: "default",
        // The second door for an API key: one in ~/.claude/settings.json would override the
        // environment built above. Nothing on disk configures this query.
        settingSources: [],
        maxTurns: 1,
        abortController: abort,
        stderr: (chunk: string) => {
          stderr.push(chunk);
          if (stderr.length > 50) stderr.shift();
        },
      },
    })) {
      if (message.type === "system" && message.subtype === "init") {
        cliVersion = message.claude_code_version ?? null;
        apiKeySource = message.apiKeySource ?? null;
        model = message.model ?? null;
        continue;
      }
      if (message.type === "result") {
        // The read loop ends on the RESULT message, not on the first quiet moment.
        return done({
          ok: message.subtype === "success" && !message.is_error,
          cliVersion,
          apiKeySource,
          billing: billingFrom(apiKeySource),
          model,
          result: message.subtype === "success" ? message.result : null,
          costUsd: message.total_cost_usd ?? null,
          numTurns: message.num_turns ?? null,
          stderr: stderr.join("").trim(),
          error: message.subtype === "success" ? null : `The query ended as ${message.subtype}.`,
        });
      }
    }

    return done({
      cliVersion,
      apiKeySource,
      billing: billingFrom(apiKeySource),
      model,
      stderr: stderr.join("").trim(),
      error: abort.signal.aborted ? "The query timed out." : "The query ended without a result message.",
    });
  } catch (err) {
    return done({
      stderr: stderr.join("").trim(),
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Write a smoke receipt where a human — or a probe driving the packaged app — can read it.
 *
 * This exists because the failure this slice is about is invisible from a terminal: the app has to
 * be launched the way it is actually launched, from a desktop entry with no shell rc sourced, and
 * that launch has no stdout anyone is watching. A file is the only channel back.
 */
export function writeSmokeReceipt(file: string, result: AgentSdkSmokeResult): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(result, null, 2)}\n`, "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// The session — what a previewed invocation actually runs as.
//
// This replaced `spawn("claude", ["-p", "--permission-mode", "acceptEdits", prompt])`. The prompt,
// the working directory and the binary are unchanged and still come from the token `claude-preview.ts`
// issued; what changed is that the host process is now SOMEBODY TO ASK. `acceptEdits` existed only
// because a headless run had nobody — and it granted writes to anything anywhere under the working
// directory, which for a marketplace target is a whole repository. `canUseTool` grants exactly the
// paths the confirmation displayed instead, silently, with no prompt and nothing for the user to
// notice beyond a run that can no longer wander.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The built-in tools a session is offered. Everything absent from this list is absent from the
 * model's context, which costs nothing; a tool that is present and denied costs turns to argue with.
 *
 * `Bash` is gone and can be, because `016` moved `git init` and the first commit into the
 * deterministic scaffold and the create-marketplace prompt now forbids git rather than asking for
 * it. It is also the one tool whose filesystem reach cannot be bounded by inspecting `tool_input` —
 * a path check cannot see what `cd .. && cat` does at runtime — so withholding it is what makes the
 * check below meaningful rather than decorative.
 *
 * `AskUserQuestion` is in SESSION-PANE-PLAN.md's set and deliberately not here: this path is still
 * headless, so a question has nobody to answer it. It arrives with the pane.
 *
 * `Skill` WAS in that same sentence until `026`, and the reason it moved is the reason `026`
 * exists. The four create-\* prompts used to inline the instructions their matching `SKILL.md`
 * already carried — two copies of the same guidance, one reachable only from the app and one only
 * from a terminal, with nothing to catch them drifting apart. Deleting the inlined copy means the
 * headless run has to be able to reach the surviving one, which is `Skill` plus the plugin loaded
 * at the query (see `SESSION_SKILLS` and `AgentSessionRequest.pluginDir`). Nothing about the
 * headless contract widened with it: a skill invocation reads a file that ships with the app, and
 * the write scope, the missing shell and the missing subagents are all unchanged.
 */
export const SESSION_TOOLS = [...READ_ONLY_TOOLS, "Edit", "Write", "Skill"] as const;

/**
 * The skills any session may reach by name — the four create-\* flows.
 *
 * They are the single source of "how to finish a scaffolded artifact" since `026`: the prompt a
 * confirmation displays carries the FACTS (the path, the form's own words, the repository state)
 * and names the skill for the rest. So this list is not a convenience — a run that cannot resolve
 * these names is a run working from a prompt with the guidance taken out of it.
 *
 * Resolvable only because the plugin is loaded programmatically alongside it. `skills` on its own,
 * with `settingSources: []`, makes the `Skill` tool answer "Unknown skill" for every name: measured
 * in the window, silently, with nothing logged.
 */
export const SESSION_SKILLS = ["create-skill", "create-subagent", "create-plugin", "create-marketplace"] as const;

/**
 * Named as forbidden as well as omitted from `SESSION_TOOLS`, and the redundancy is the point:
 * `tools` sets the base list, `disallowedTools` removes a tool from the model's context even if
 * something else would have put it back. `Agent` goes because a subagent's prompts arrive with an
 * `agentID` nothing here disambiguates; `NotebookEdit` because it writes and this app never wants it.
 */
export const SESSION_DISALLOWED_TOOLS = ["Bash", "Agent", "NotebookEdit"] as const;

/** One tool call this session refused, kept so the run can report what it would not do. */
export interface AgentDenial {
  tool: string;
  /** The path it was aimed at, when it named one. */
  path: string | null;
  /** The reason handed back to the model — the same string, so the transcript matches. */
  message: string;
}

export interface AgentSessionRequest {
  /** The prompt the preview built and the confirmation displayed. Never assembled here. */
  prompt: string;
  cwd: string;
  /** The resolved `claude` binary, from the invocation. Never a PATH lookup. */
  bin: string;
  /** Absolute paths this session may write. A directory means anything under it; empty means none. */
  writable: readonly string[];
  /**
   * How to start the CLI.
   *
   * Supplied by the caller rather than left to the SDK because the child must be its own process
   * group: the CLI spawns its own children, and a Stop that signals only the process we started
   * leaves the grandchildren running. `claude-run.ts` owns that, and owns the teardown that goes
   * with it, so the SDK is handed a spawner rather than trusted with a lifecycle.
   */
  spawn: (options: SpawnOptions) => SpawnedProcess;
  /** Output as it arrives — assistant text, tool activity, and the CLI's stderr. */
  output(chunk: ClaudeOutputChunk): void;
  /**
   * The bundled plugin's root, so `SESSION_SKILLS` resolve to something.
   *
   * Supplied by main, which is the only place that knows where the app's own files landed — the
   * same composition-root shape as `GitPort` and `SettingsPort`. Absent (a test, or a layout where
   * the plugin could not be found) the session simply loads no plugin and no skills: the prompt
   * still carries every fact about the artifact, so the run degrades to a thinner instruction
   * rather than to a wrong one.
   */
  pluginDir?: string | null;
  /** Resolution options for the child environment. Tests pass a fake machine; the app passes none. */
  envOptions?: ResolveOptions;
}

/** How a session ended. Never a throw: every failure is one of these. */
export interface AgentSessionResult {
  ok: boolean;
  /** The SDK result message's subtype (`success`, `error_max_turns`, …), or null if none arrived. */
  subtype: string | null;
  /** The final assistant text, as the result message reported it. */
  text: string | null;
  /** Why it is not `ok`. Null on success. */
  error: string | null;
  costUsd: number | null;
  numTurns: number | null;
  sessionId: string | null;
  /** Where the money went, as the CLI reported it on init. */
  billing: AgentBilling;
  /** Everything `canUseTool` refused, in order. */
  denied: AgentDenial[];
}

export interface AgentSession {
  /** Resolves when the session ends. Never rejects. */
  result: Promise<AgentSessionResult>;
  /**
   * End the session and terminate the CLI.
   *
   * Interrupting a turn, aborting the read loop and closing the query are three different things,
   * and only this one releases the child. Idempotent, and safe to call before the dynamic import
   * has even resolved — a close that lands first prevents the query rather than racing it.
   */
  close(): void;
}

/** Text and tool activity out of one assistant message, rendered the way a terminal would show it. */
function renderAssistant(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block?.type === "text" && typeof block.text === "string") parts.push(block.text);
    if (block?.type === "tool_use") {
      const input = (block.input ?? {}) as Record<string, unknown>;
      const target = typeof input.file_path === "string" ? input.file_path : "";
      parts.push(`⏺ ${String(block.name)}${target ? `(${target})` : ""}`);
    }
  }
  return parts.filter(Boolean).join("\n");
}

/**
 * Start a session for a previewed invocation and stream what it does.
 *
 * Returns synchronously — the SDK import is dynamic (1.3 MB that a launch which never runs anything
 * should not parse), so the query does not exist yet when this returns, and `close()` is written to
 * cope with being called in that window.
 *
 * Never rejects. A failed import (the asar case at the top of this file), a CLI that cannot be
 * spawned, an aborted read loop and a session that errored are all outcomes to report: each one is
 * a different thing for the user to do next, and collapsing them into a rejection loses that.
 */
export function startAgentSession(request: AgentSessionRequest): AgentSession {
  const { env } = agentChildEnv(request.envOptions);
  const stderr: string[] = [];
  const denied: AgentDenial[] = [];
  let closed = false;
  let query: { close(): void } | null = null;

  const result = (async (): Promise<AgentSessionResult> => {
    const base: AgentSessionResult = {
      ok: false,
      subtype: null,
      text: null,
      error: null,
      costUsd: null,
      numTurns: null,
      sessionId: null,
      billing: "unknown",
      denied,
    };

    try {
      // Literal specifier, not AGENT_SDK_PACKAGE — see the note at `runAgentSdkSmoke`.
      const sdk = await import("@anthropic-ai/claude-agent-sdk");
      if (closed) return { ...base, error: "The session was closed before it started." };

      let apiKeySource: string | null = null;
      let sessionId: string | null = null;

      const q = sdk.query({
        prompt: request.prompt,
        options: {
          cwd: request.cwd,
          // The resolved binary, never the SDK's own lookup — see (3) in the box at the top.
          pathToClaudeCodeExecutable: request.bin,
          env,
          spawnClaudeCodeProcess: request.spawn,
          // The base tool set, and the same names forbidden outright. See both constants above.
          tools: [...SESSION_TOOLS],
          disallowedTools: [...SESSION_DISALLOWED_TOOLS],
          // The create-* skills, and the plugin that makes their names resolvable. Both or neither:
          // `skills` alone answers "Unknown skill" under `settingSources: []`. See `SESSION_SKILLS`.
          skills: request.pluginDir ? [...SESSION_SKILLS] : [],
          plugins: request.pluginDir ? [{ type: "local" as const, path: request.pluginDir }] : [],
          // `default`, never `acceptEdits` and never `bypassPermissions`: the callback below is the
          // whole permission model, and a mode that pre-decides would make it unreachable.
          permissionMode: "default",
          // Nothing on disk configures this session — not its permissions, and not where the bill
          // goes. `agentChildEnv` closed the environment door; this is the other one.
          settingSources: [],
          // `claude -p` runs with Claude Code's own system prompt. The SDK does not use it unless
          // asked, and a create-* run that lost it would author against a different set of defaults
          // than the one every prompt in this app was written for.
          systemPrompt: { type: "preset", preset: "claude_code" },
          canUseTool: async (tool, input) => {
            const decision = decideWrite({ tool, input, writable: request.writable, cwd: request.cwd });
            if (decision.behavior === "allow") return { behavior: "allow" };
            const target = typeof input?.file_path === "string" ? input.file_path : null;
            denied.push({ tool, path: target, message: decision.message });
            // Surfaced as stderr rather than swallowed: a run that quietly declined half of what it
            // was asked to do, and then said it was finished, is the failure worth seeing.
            request.output({
              stream: "stderr",
              chunk: `Denied ${tool}${target ? ` ${target}` : ""}: ${decision.message}\n`,
            });
            return decision;
          },
          stderr: (chunk: string) => {
            stderr.push(chunk);
            if (stderr.length > 50) stderr.shift();
            request.output({ stream: "stderr", chunk });
          },
        },
      });
      query = q;
      if (closed) q.close();

      for await (const message of q) {
        if (message.type === "system" && message.subtype === "init") {
          apiKeySource = message.apiKeySource ?? null;
          sessionId = message.session_id ?? null;
          continue;
        }
        if (message.type === "assistant") {
          const text = renderAssistant(message.message?.content);
          if (text) request.output({ stream: "stdout", chunk: `${text}\n` });
          continue;
        }
        if (message.type === "result") {
          return {
            ...base,
            ok: message.subtype === "success" && !message.is_error,
            subtype: message.subtype,
            text: message.subtype === "success" ? message.result : null,
            costUsd: message.total_cost_usd ?? null,
            numTurns: message.num_turns ?? null,
            sessionId: message.session_id ?? sessionId,
            billing: billingFrom(apiKeySource),
            error:
              message.subtype === "success" && !message.is_error
                ? null
                : `The session ended as ${message.subtype}.${stderr.length ? ` ${stderr.join("").trim()}` : ""}`,
          };
        }
      }

      // The loop ends on the RESULT message. Falling out of it means the stream stopped without
      // one, which is a closed query or a child that went away — not a session that finished.
      return {
        ...base,
        sessionId,
        billing: billingFrom(apiKeySource),
        error: closed ? null : "The session ended without a result.",
      };
    } catch (err) {
      return { ...base, error: err instanceof Error ? err.message : String(err) };
    }
  })();

  return {
    result,
    close() {
      closed = true;
      query?.close();
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The pane session — the same SDK, driven as a conversation rather than as a job.
//
// `startAgentSession` above takes a `prompt` STRING, which gives a one-shot query: there is no way
// to add a turn to it and no working Stop, because `interrupt()` exists only in streaming-input
// mode. So the pane's session is a sibling of that function over the same options rather than a
// second SDK importer — this module is still the only one in the app that imports the SDK, and
// `test/isolation.test.ts` pins that.
//
// Three things are genuinely new here, and each is load-bearing:
//
//   • **Input is a stream the app yields into.** A queue plus an async generator, closed when the
//     session is disposed. Deciding this later would mean rewriting the message pump.
//   • **A turn is stamped `origin: { kind: "human" }`.** Claude Code treats an unattributed user
//     message differently, and checks that require a human-typed prompt reject it. That is what
//     makes "the user writes the prompts, not the renderer" enforceable at the SDK boundary rather
//     than only in a test.
//   • **A `PreToolUse` hook bounds READS.** `canUseTool` cannot: it fires only for calls that would
//     otherwise prompt, and `Read`/`Glob`/`Grep` never do. The hook fires for every tool call,
//     before the permission flow, so it is the only place a read can be stopped at all.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The tools a PANE session is offered — `SESSION_TOOLS` extended, never a second list.
 *
 * `Skill` used to arrive HERE rather than in the base set, and moved down to it in `026` when the
 * four create-\* prompts stopped carrying their own copy of the guidance: a headless run that
 * cannot reach the skill is a run reading an instruction with its middle removed. See
 * `SESSION_TOOLS`.
 *
 * `AskUserQuestion` arrives with `021`, and it is the pane's headline feature rather than one more
 * tool: it is how the model asks a real question with real options instead of guessing. It has TWO
 * mechanical preconditions and neither is inferable from this list — the tool has to be here, AND
 * `toolConfig.askUserQuestion.previewFormat` has to be passed at the query, without which Claude
 * emits no previews at all and every option list arrives bare. If a question never arrives, check
 * those two before anything else.
 */
export const PANE_TOOLS = [...SESSION_TOOLS, QUESTION_TOOL] as const;

/**
 * What an outstanding permission request is told when the session goes away underneath it.
 *
 * It reaches the model, not the user — the window is already closing — but it still has to be a
 * real sentence: a deny with an empty message is the one shape the SDK does not define behaviour
 * for, and a run reading its transcript later should be able to tell this apart from a refusal
 * somebody actually meant.
 */
export const TEARDOWN_DENIAL = "The session ended before this could be answered, so it was refused. Nothing was done.";

/**
 * The skills a PANE session may reach by name — `SESSION_SKILLS` extended, never a second list.
 *
 * The four create-\* skills so a conversation can finish the work a form started — which `022` made
 * literal: a submitted form can hand its completed preview to this session, seed what it scaffolded
 * and open the artifact's own directory for writing. They are shared with the headless run since
 * `026`; what is added here is `super-help`, the one thing the pane inherits from the deleted help
 * chat — a declared session skill now, rather than a name pasted into a generated prompt.
 *
 * `update-skill-tags` is pane-only, unlike the four create-\* skills — this flow only ever runs
 * from the `/skills` page's button, handed off straight into the pane, and never headlessly.
 */
export const PANE_SKILLS = [...SESSION_SKILLS, "maestro-help", "update-skill-tags"] as const;

/** What the pane can say about the CLI before a session exists. Resolved here, never in main. */
export interface PaneSessionTarget {
  bin: string | null;
  available: boolean;
  searched: string[];
  /** Set only when `available` is false: what was looked for, and where. */
  unavailable: string | null;
}

/**
 * Where the pane's `claude` would come from.
 *
 * Exists so `src/main/claude-session.ts` does not have to call `resolveClaudeCli` itself: the list
 * of modules that produce a path to the CLI is the list of ways to reach it, `test/isolation.test.ts`
 * asserts it is two modules long, and a session pane is not a reason to make it three.
 */
export function paneSessionTarget(opts: ResolveOptions = {}): PaneSessionTarget {
  const cli = resolveClaudeCli(opts);
  return {
    bin: cli.bin,
    available: cli.available,
    searched: cli.searched,
    unavailable: cli.available ? null : cliNotFoundMessage(cli),
  };
}

export interface PaneSessionRequest {
  /** Where the session runs, and the root of what it can read. */
  cwd: string;
  /** The resolved `claude` binary. Never a PATH lookup — see `paneSessionTarget`. */
  bin: string;
  /**
   * Trees beyond `cwd` this session may read, passed to the SDK as `additionalDirectories` AND used
   * as the boundary the hook enforces. One list, so the disclosure and the check cannot disagree.
   */
  additionalDirectories: readonly string[];
  /**
   * The Maestro plugin's root directory, or null when this build does not ship it.
   *
   * `settingSources: []` loads no installed plugins, so naming a skill in `skills` is not enough
   * to make it resolvable — measured in the window, the `Skill` tool answered "Unknown skill" for
   * every name in `PANE_SKILLS` until the plugin was loaded here. Passing the path is the same
   * trade this app makes everywhere else: what the session gets is what this process handed it,
   * not what a file on disk happened to say.
   */
  pluginDir: string | null;
  /** How to start the CLI — a detached process-group leader, supplied by the caller. */
  spawn: (options: SpawnOptions) => SpawnedProcess;
  /** Everything that happens, in order, as it happens. */
  emit(event: SessionEvent): void;
  envOptions?: ResolveOptions;
  /**
   * What this session may spend before it stops and offers to continue (`024`).
   *
   * Resolved by `paneBudget` when absent, which is the case in the app: the ceiling is a policy
   * decision and lives in `session-budget.ts` rather than at this call site. The argument exists so
   * a test — or a Continue granting a fresh allowance — can state one without editing the default.
   */
  budget?: Partial<Pick<BudgetPolicy, "maxBudgetUsd" | "maxTurns">>;
  /**
   * The figures a CONTINUED conversation carries in — its lifetime estimate and turn count, with a
   * fresh allowance already applied by `renewAllowance`.
   *
   * Seeded here rather than merged by the caller so there is one accumulator rather than two. The
   * SDK's own cost counter restarts with the resumed query, which is exactly what an allowance is;
   * what must NOT restart is the total the user is shown, and this is how it survives.
   */
  spend?: SessionSpend;
  /** How hard the model thinks per turn. Changeable afterwards through `setEffort`. */
  effort?: SessionEffort;
  /** The model to run on, or null for the CLI's own default. Changeable through `setModel`. */
  model?: string | null;
  /**
   * A CLI session id to resume — the whole of what makes Continue a door rather than a restart.
   *
   * The transcript lives on disk under the CLI's own session store (`persistSession`, which this
   * query passes explicitly rather than inheriting), so resuming picks the conversation up with
   * every turn intact and the SDK's own spend counter back at zero. That is exactly "a fresh
   * allowance for the same conversation", and it is why the ceiling can be set low enough to fire.
   */
  resume?: string | null;
  /**
   * Resume into a COPY, leaving the resumed session's own transcript alone (`025`).
   *
   * False for a Continue and true for the picker, and the difference is whose history is being
   * written. A Continue resumes this app's own conversation in place: it is the same session, the
   * same transcript, one allowance later, and forking it would leave the user with two records of
   * one conversation. Attaching to a session the user started elsewhere is the opposite case — the
   * terminal they started it in still has that session, and writing this pane's turns into its
   * history would corrupt something the app was never given.
   *
   * Measured (`025`): with this set, the source transcript is byte-identical after the resume and
   * the fork is written into the RESUMING session's project directory, under a new id that
   * `sessionId()` reports.
   */
  fork?: boolean;
  /**
   * Send the model a pacing budget. True in the app, and false only on the reopen that follows a
   * model refusing one — see `isPacingUnsupported` and `onPacingRejected` below.
   */
  pacing?: boolean;
  /**
   * The model would not accept a pacing budget, so the session has to be reopened without one.
   *
   * A CALLBACK RATHER THAN AN EVENT, because the caller is the only thing that can act on it: this
   * closure owns no child and no entry, and cannot restart itself. Measured behaviour, not a
   * defensive branch — Haiku 4.5 answers every turn with a 400 while `taskBudget` is set.
   */
  onPacingRejected?(): void;
}

export interface PaneSession {
  /**
   * Add a turn. The text is the USER'S, verbatim: nothing here wraps it, and nothing may.
   *
   * Returns false when the session has already ended, so the caller can say so rather than dropping
   * the turn into a closed stream.
   */
  say(text: string): boolean;
  /**
   * Answer a parked permission request.
   *
   * False when the id names nothing pending — a click that arrived after the session ended, or a
   * second click on a prompt already answered. Both are ordinary, and neither may park anything.
   */
  answer(requestId: string, answer: PermissionAnswer): boolean;
  /**
   * Answer a parked QUESTION with a selection, and let this module build the payload.
   *
   * THE CARVE-OUT LIVES HERE, and this signature is what makes it checkable. A question's answer
   * cannot be a decision — it is the tool's own input, written back with the user's choices in it —
   * so the caller hands over which question and which labels, and the payload is rebuilt from the
   * call the SDK actually delivered. Every label is checked against the options that call offered;
   * one that was not offered is refused and NOTHING is answered, because forwarding it would send
   * the model an answer to a question it never asked.
   *
   * False when the id names nothing pending, and when the selection was rejected — the two are
   * distinguishable to the caller only by the reason it gets back, which is why it gets one.
   */
  answerQuestion(requestId: string, choice: QuestionChoice): { ok: boolean; error: string | null };
  /**
   * Append a turn that does NOT trigger one — context, not a question.
   *
   * `shouldQuery: false` holds the message until the next turn that does query, so a create-\*
   * handoff can tell the session what was scaffolded, where it landed and what is left to write
   * without spending a model call. The user's first typed message is still the first thing that
   * costs anything, and it arrives with this in front of it.
   *
   * NOT `say`, and the difference is the `origin` stamp: `say` carries text a person typed and is
   * marked human-authored, which is what makes "the renderer never authors a prompt" checkable.
   * This is the app's own context and is deliberately not marked as anyone's speech.
   */
  seed(text: string): boolean;
  /**
   * Add a directory (or a file) to what this session may WRITE, for as long as it lasts.
   *
   * THE ONLY WAY THE WRITE SCOPE EVER GROWS, and the caller is `session:handoff` answering a
   * completed create-\* preview — a form the user filled in and a scaffold that already wrote a
   * file there. Nothing else in the app calls it, and there is no channel by which a renderer could.
   *
   * Returns the paths that were actually new, so an announcement is made once rather than per
   * submit. Nothing here reaches the disk and nothing survives `close()`.
   */
  allowWrites(paths: readonly string[]): string[];
  /** What this session may write, in force right now. Ordered as added. */
  writable(): string[];
  /**
   * Widen what this session may read, for as long as it lasts.
   *
   * THE BOUNDARY'S HALF OF A GRANT, and it is not the same half as `updatedPermissions`. That field
   * tells the CLI's own permission system to stop prompting; this tells the `PreToolUse` hook to
   * stop routing the path into a prompt in the first place. Both are needed and neither substitutes
   * for the other: the hook runs first and would otherwise ask again forever, and the permission
   * system runs after and would otherwise refuse what the hook waved through.
   *
   * Returns the paths that were actually new. Nothing here reaches the disk, and nothing survives
   * `close()` — the list lives in this closure.
   */
  grant(paths: readonly string[]): string[];
  /**
   * Take a grant back.
   *
   * The hook is the authority, which is what makes this work at all: the SDK has no API for
   * withdrawing a `PermissionUpdate`, but a path the hook no longer recognises is routed into a
   * prompt again on the next call, and the permission system never gets to answer for it. So
   * revoking narrows the boundary even though the session-scoped update stays where it was.
   */
  revoke(path: string): boolean;
  /** Everything a person has granted, in force right now. Ordered as granted. */
  granted(): string[];
  /** Request ids still waiting on a person, so a reconnecting UI can re-render them. */
  pendingPermissions(): string[];
  /**
   * Interrupt the turn in flight, leaving the session usable.
   *
   * Resolves with the uuids of queued user messages that SURVIVED the interrupt, when the CLI
   * advertises `interrupt_receipt_v1`. Each of those runs as its own turn afterwards, so a Stop
   * that reported nothing while a message was still queued would be a lie on screen.
   */
  stop(): Promise<{ stillQueued: string[] }>;
  /** End the session and release the CLI. Idempotent, and safe before the import resolves. */
  close(): void;
  /**
   * Resolves when the session is over. Never rejects.
   *
   * `reason` is what `024` added and it is the whole difference between a door and a crash: a
   * ceiling ends the query exactly as a failure does, and a caller that cannot tell them apart
   * cannot offer to continue one and not the other.
   */
  ended: Promise<{ error: string | null; reason: SessionEndReason; spend: SessionSpend }>;
  /**
   * The CLI's own session id, once the session has initialised — what a Continue resumes against.
   *
   * Null until the init message arrives, which is also the window in which nothing has been spent,
   * so there is nothing to continue from yet.
   */
  sessionId(): string | null;
  /** What has been spent, as an estimate, right now. */
  spend(): SessionSpend;
  /**
   * Change the effort level for the turns to come.
   *
   * Applied from the NEXT turn — the SDK is explicit about that — and the conversation is untouched,
   * which is the property that makes this a header control rather than a reason to start again.
   */
  setEffort(effort: SessionEffort): Promise<boolean>;
  /**
   * Change the model, mid-conversation.
   *
   * Applied DURING the current turn: whatever Claude is already generating finishes on the old
   * model and the next model call uses the new one. The transcript is unaffected either way.
   */
  setModel(model: string | null): Promise<boolean>;
  /** What this session could run on, as the CLI lists it. Empty when it cannot be asked. */
  models(): Promise<SessionModel[]>;
}

/**
 * The third argument `canUseTool` is called with, as much of it as this app reads.
 *
 * Declared here rather than imported: the SDK's own `CanUseTool` type would have to be imported as
 * a VALUE-adjacent type from the package this module is the app's only importer of, which is fine —
 * but every field below is optional on older CLIs (`requestId` and `title` are recent additions),
 * and writing them out is what makes the fallbacks at the call site legible.
 */
interface CanUseToolOptions {
  signal?: AbortSignal;
  blockedPath?: string;
  decisionReason?: string;
  /** The CLI's own prompt sentence, when it rendered one. Preferred over reconstructing it. */
  title?: string;
  toolUseID?: string;
  agentID?: string;
  requestId?: string;
}

/** The user turn, in the SDK's own shape. The `origin` is the point — see the block comment above. */
function humanTurn(text: string): {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
  origin: { kind: "human" };
} {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    origin: { kind: "human" },
  };
}

/**
 * Context appended to the transcript WITHOUT starting a turn.
 *
 * Two fields carry the whole difference from `humanTurn`:
 *
 *   • **`shouldQuery: false`** — the SDK holds the message and merges it into the next user message
 *     that does query. That is what makes a handoff free: the seeded context is in the model's
 *     view of the conversation, and no request has been made, so nothing has been spent.
 *   • **No `origin`** — this text is the app's, not a person's. Stamping it `human` would be the
 *     one lie that matters here: checks that require a human-typed prompt would accept it, and the
 *     invariant `session:say` exists to make checkable would quietly stop meaning anything.
 */
function contextTurn(text: string): {
  type: "user";
  message: { role: "user"; content: string };
  parent_tool_use_id: null;
  shouldQuery: false;
} {
  return {
    type: "user",
    message: { role: "user", content: text },
    parent_tool_use_id: null,
    shouldQuery: false,
  };
}

/**
 * Start a live session and drive it from a stream of user turns.
 *
 * Returns synchronously for the same reason `startAgentSession` does: the SDK import is dynamic, so
 * the query does not exist yet, and `say`/`close` are written to cope with being called in that
 * window — a turn typed before the import resolves is queued, not lost.
 *
 * Never rejects. Every failure is an `ended` event with a reason on it.
 */
export function startPaneSession(request: PaneSessionRequest): PaneSession {
  const { env } = agentChildEnv(request.envOptions);

  /**
   * The three ceilings, and the running figure they are measured against.
   *
   * `spend` moves in exactly one place — the `result` branch of the read loop, behind the same
   * guard that decides whether a result was a turn at all. That is not tidiness: a
   * `shouldQuery: false` append is answered by its own zero-cost result, and a spend figure fed
   * from anywhere else would count an append that cost nothing as a turn that did.
   */
  const policy = paneBudget(request.budget);
  let spend = request.spend ?? newSpend(policy);

  /**
   * The two levers the header can move on a LIVE session, and the model the CLI actually chose.
   *
   * Held here rather than derived from the query because both are set-once-then-changed: `effort`
   * goes in at the query and afterwards through `applyFlagSettings`, and `model` is whatever the
   * caller asked for — or, until it asks for anything, whatever the CLI's own default turns out to
   * be, which is only knowable from the init message.
   */
  let effort: SessionEffort = request.effort ?? DEFAULT_EFFORT;
  let activeModel: string | null = request.model ?? null;
  /** Announced once, on the first init. Every later turn re-inits and would re-announce the same. */
  let announcedSettings = false;
  /** Latched so one refused pacing budget produces one reopen, not one per turn. */
  let pacingRejected = false;

  /**
   * What a PERSON opened, mid-session, by answering a prompt.
   *
   * `020` resolved the readable set once and handed the same array to the hook and the disclosure.
   * This is the first thing in the app that makes it move, so it stopped being an array and became
   * a function: every check reads `readable()`, and there is no captured copy anywhere that could
   * go on answering the old question. It dies with this closure — no file is written, and nothing
   * carries it into the next session.
   */
  const granted: string[] = [];

  /**
   * What a submitted FORM opened — the session's write scope, and the only list here that authors.
   *
   * A function for the same reason `readable()` is one, and the lesson is `023`'s: a form submitted
   * mid-session has to reach the live `canUseTool`, not the list it closed over when the pane
   * opened. The literal `writable: []` this replaces was the whole of the pane's write authority;
   * what makes the replacement safe is not this closure but its only caller — `allowWrites` is
   * reachable exclusively from a claimed create-\* preview token.
   */
  const writes: string[] = [];
  const writable = (): string[] => [...writes];

  /**
   * Write directories the CLI has not been told about yet.
   *
   * THE SDK HAS NO "ADD A DIRECTORY" CONTROL REQUEST. `updatedPermissions` rides on a permission
   * ANSWER and nowhere else, so a scope that grows between two tool calls can be told to the CLI
   * only at the next call it decides — which is exactly what this set is for: the first allow that
   * lands inside a newly-opened directory carries the `addDirectories` update with it, once, and
   * every allow after that is a plain allow.
   *
   * Without it the app's own check and the CLI's own working roots disagree: our callback allows a
   * write the CLI then refuses because the path is outside the directories it was started with, and
   * the user watches a granted directory behave as though nothing was granted.
   */
  const unannounced = new Set<string>();

  /**
   * Everything this session may read: the cwd, what the app opened, what a person granted — and
   * what a form made writable.
   *
   * The last one is not a convenience. A session that may write a file it may not read has to be
   * asked about every read half of every edit, which is the prompt this slice exists to remove; and
   * a directory the user opened by submitting a form for it is not one they need to be asked about
   * looking at.
   */
  const readable = (): string[] => [request.cwd, ...request.additionalDirectories, ...granted, ...writes];

  let seq = 0;
  const emit = (event: SessionEventBody): void => request.emit({ ...event, seq: ++seq } as SessionEvent);

  // ── the input pump ────────────────────────────────────────────────────────
  // A queue and one waiting resolver. `say` pushes; the generator below yields. Closing resolves
  // the waiter with `null`, which ends the generator, which ends the query — that is the only
  // orderly way out of a stream the SDK is iterating.
  const queue: Array<ReturnType<typeof humanTurn> | ReturnType<typeof contextTurn>> = [];
  let wake: ((value: null) => void) | null = null;
  let closed = false;

  async function* turns() {
    for (;;) {
      while (queue.length > 0) {
        const next = queue.shift()!;
        if (closed) return;
        yield next;
      }
      if (closed) return;
      await new Promise<null>((resolve) => {
        wake = resolve;
      });
    }
  }

  let query: {
    close(): void;
    interrupt(): Promise<{ still_queued?: string[] } | undefined>;
    setModel(model?: string): Promise<void>;
    applyFlagSettings(settings: { effortLevel?: SessionEffort | null }): Promise<void>;
    supportedModels(): Promise<
      Array<{
        value: string;
        displayName?: string;
        description?: string;
        supportsEffort?: boolean;
        supportedEffortLevels?: readonly string[];
      }>
    >;
  } | null = null;
  type Ending = { error: string | null; reason: SessionEndReason; spend: SessionSpend };
  let resolveEnded: (value: Ending) => void = () => {};
  const ended = new Promise<Ending>((resolve) => {
    resolveEnded = resolve;
  });

  /** The CLI's own id for this conversation, read off the init message. What a Continue resumes. */
  let cliSessionId: string | null = request.resume ?? null;

  /**
   * The ceiling that ended the query, recorded off the RESULT rather than off the teardown.
   *
   * MEASURED, AND THE ONE THING THAT MAKES THE DOOR WORK — and the teardown it has to survive comes
   * in two shapes, which is why the reason is latched rather than derived at the exit:
   *
   *   • ONE-SHOT: the SDK delivers the `error_max_budget_usd` result, the child exits non-zero, and
   *     the very next turn of the `for await` THROWS — `Claude Code returned an error result:
   *     Reached maximum budget ($0.50)`. Left alone that lands in the catch below and the pane
   *     reports a crash: an error banner, no reason, no Continue, and a transcript the user has
   *     every right to carry on from looking exactly like one that broke.
   *   • STREAMING INPUT, which is what the pane is: nothing tears down at all. The pump is still
   *     open, so the query stays alive and answers every further turn with another error result.
   *     See the `break` in the read loop — that exit is the pane's, not the SDK's.
   */
  let ceilingHit: SessionEndReason | null = null;

  /** Last-resort key for a CLI too old to send `requestId`. Ascending, so it cannot collide. */
  let askSeq = 0;

  /**
   * User turns that have been sent and not yet answered by a result.
   *
   * The pump feeds the SDK two kinds of message and only one of them asks anything: `say` queries,
   * `seed` does not. Both are answered with a result, so this counter is how the read loop tells a
   * turn from a receipt for context nobody requested an answer to. Incremented where the message is
   * queued rather than where it is yielded, because a turn typed before the import resolves is
   * still a turn that is going to be answered.
   */
  let awaitingTurns = 0;

  /**
   * Is this path a directory ON DISK? The one question about a grant that needs the filesystem.
   *
   * It decides the SHAPE of the offer, not just its wording — a file is offered as itself or as its
   * containing directory, a directory only as itself. Anything unreadable or absent answers `false`
   * and is treated as a file, which is the narrower of the two and the right way to be wrong.
   */
  const isDirectory = (target: string): boolean => {
    try {
      return fs.statSync(target).isDirectory();
    } catch {
      return false;
    }
  };

  /**
   * Tell the CLI about a write directory, at the first tool call that lands inside it.
   *
   * Returns the directories to announce on THIS allow — normally none, exactly once per handoff a
   * single one. The call has to name a path: a directory can only be announced when there is
   * something to announce it about, and an unrelated allow must not carry a permission update for a
   * tree the model was not asking about.
   */
  const announceWriteScope = (target: string | null): string[] => {
    if (unannounced.size === 0 || !target) return [];
    const resolved = path.resolve(request.cwd, target);
    const opened: string[] = [];
    for (const directory of unannounced) {
      if (!withinDirectory(directory, resolved)) continue;
      unannounced.delete(directory);
      opened.push(directory);
    }
    return opened;
  };

  /**
   * Tell the pane which model it is on, which effort, and what else it could pick.
   *
   * `supportedModels()` is a control request to the running CLI, so it cannot be answered before
   * the session exists and it can fail on a CLI too old to answer — in which case the selector
   * simply has nothing to offer and the header still states the model in force. Never throws: a
   * header control is not worth losing a session over.
   */
  const announceSettings = async (model: string | null): Promise<void> => {
    activeModel = activeModel ?? model;
    let models: SessionModel[] = [];
    try {
      const supported = (await query?.supportedModels()) ?? [];
      models = supported.map((entry) => ({
        id: entry.value,
        label: entry.displayName ?? entry.value,
        description: entry.description ?? "",
        // Filtered against the levels this app knows how to send, rather than passed through: the
        // CLI's list is the authority on what a model accepts, and `SessionEffort` is the authority
        // on what this wire can carry.
        effortLevels:
          entry.supportsEffort === false
            ? []
            : ((entry.supportedEffortLevels ?? EFFORT_LEVELS).filter((level) =>
                (EFFORT_LEVELS as readonly string[]).includes(level)
              ) as SessionEffort[]),
      }));
    } catch {
      /* a CLI that will not list its models still runs on one — the header says which */
    }
    emit({ kind: "settings", effort, model: activeModel, models });
  };

  /** The hook output that routes a call into the prompt instead of answering it. */
  const askHook = (reason: string) => ({
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "ask" as const,
      permissionDecisionReason: reason,
    },
  });

  // ── the permission registry ───────────────────────────────────────────────
  // Parked promises, one per outstanding ask — a permission request or a structured QUESTION, both
  // in the one registry so both are drained by the one teardown. See ./permission-registry.ts for
  // the four things that make it fiddly; the one that matters HERE is that every exit below
  // resolves what it holds.
  const permissions = createPermissionRegistry();

  /**
   * The questions parked right now — the call AS THE SDK DELIVERED IT, per request id.
   *
   * THIS IS WHAT AN ANSWER IS VALIDATED AGAINST, and holding it here rather than in main is the
   * whole of the carve-out. The renderer sends labels; main forwards them; and they are checked
   * against the options in the actual tool call, on the same side of the boundary as the payload
   * that gets built from them. Nothing that crossed a process boundary describes what was offered.
   *
   * Emptied as each question is answered, so it is bounded by what is on screen.
   */
  const asked = new Map<string, { input: Record<string, unknown>; questions: AgentQuestion[] }>();

  /**
   * Deny everything outstanding, and tell the UI so it can stop showing questions nobody can answer.
   *
   * Called from `finish` and from `close`, because they are not the same moment: `close()` runs the
   * instant the window goes away, while `finish` waits for the SDK's stream to actually end — which
   * it cannot do while a `canUseTool` promise is still parked. Denying first is what unblocks it.
   */
  const releasePermissions = (message: string): void => {
    for (const requestId of permissions.denyAll(message)) {
      // A question goes the same way, and that is the criterion "dismissing the pane or switching
      // projects with a question outstanding resolves it rather than wedging the session" — already
      // solved, by not building a second registry to forget to drain.
      asked.delete(requestId);
      emit({ kind: "permission-resolved", requestId, outcome: "cancelled" });
    }
  };

  /**
   * End the session once, saying WHY.
   *
   * The reason is not derived from `error` and must not be: a ceiling produces an error string (the
   * SDK throws one, see `ceilingHit`) and is not a failure, while a session closed by a person
   * produces no string at all. `canContinue` follows the reason rather than the error for the same
   * reason — a session that broke is not a session that ran out of allowance.
   */
  const finish = (error: string | null, reason: SessionEndReason = error ? "error" : "closed"): void => {
    if (!closed) closed = true;
    releasePermissions(TEARDOWN_DENIAL);
    wake?.(null);
    wake = null;
    const ceiling = reason === "budget" || reason === "turns";
    if (ceiling) spend = exhaust(spend, reason === "budget" ? "budget" : "turns");
    emit({
      kind: "ended",
      error: ceiling ? null : error,
      reason,
      spend,
      // The door, and only for a ceiling: continuing needs a transcript on disk to resume against,
      // which is exactly what a session that ran out of allowance still has.
      canContinue: ceiling && cliSessionId !== null,
    });
    resolveEnded({ error, reason, spend });
  };

  /**
   * The idempotency key for one ask.
   *
   * `requestId` is the SDK's own envelope id: the same request redelivered after a transport gap
   * carries the same one, and the registry then resolves the entry that already exists instead of
   * parking a second. The two fallbacks are for CLIs too old to send it.
   */
  const askKey = (tool: string, options: CanUseToolOptions): string =>
    options?.requestId || options?.toolUseID || `${tool}-${++askSeq}`;

  /**
   * Park a structured question and wait for a person to answer it.
   *
   * The shape is the permission ask's — same registry, same idempotency key, same drain on every
   * exit — and everything that differs is in what comes back. A permission request resolves to a
   * DECISION; this resolves to the tool's own input with the user's choices written into it, which
   * is the one payload this app ever authors and the reason `answerQuestion` below validates rather
   * than forwards.
   */
  const askQuestion = async (input: Record<string, unknown>, options: CanUseToolOptions): Promise<ParkedAnswer> => {
    const questions = describeQuestions(input);
    if (questions.length === 0) {
      // NOT PARKED. A question with nothing to pick between is a card that cannot be answered, and
      // an unanswerable card is a promise only teardown will ever resolve. Refusing says so, in a
      // sentence the model can act on — it can ask the same thing in prose instead.
      emit({
        kind: "refusal",
        tool: QUESTION_TOOL,
        target: null,
        reason: QUESTION_UNRENDERABLE,
        source: "question",
        decidedBy: null,
      });
      // The refusal comes back from the pure module fully formed, decision included. This callback
      // authors none of its own — the property `020` established and `test/isolation.test.ts` pins.
      return QUESTION_REFUSAL;
    }

    const requestId = askKey(QUESTION_TOOL, options);
    const { fresh, answer } = permissions.request(requestId);
    if (fresh) {
      asked.set(requestId, { input, questions });
      emit({
        kind: "question",
        request: {
          requestId,
          toolUseId: options?.toolUseID ?? null,
          agentId: options?.agentID ?? null,
          questions,
        },
      });
    }

    const decision = await answer;
    asked.delete(requestId);
    emit({
      kind: "permission-resolved",
      requestId,
      // A question is answered or it is cancelled with the session; it is never allowed or denied.
      outcome: decision.behavior === "allow" ? "answered" : "cancelled",
    });
    return decision;
  };

  void (async () => {
    try {
      // Literal specifier, not AGENT_SDK_PACKAGE — see the note at `runAgentSdkSmoke`.
      const sdk = await import("@anthropic-ai/claude-agent-sdk");
      if (closed) return finish(null);

      const q = sdk.query({
        prompt: turns(),
        options: {
          cwd: request.cwd,
          pathToClaudeCodeExecutable: request.bin,
          env,
          spawnClaudeCodeProcess: request.spawn,
          // The first time this app passes any: `018` widened nothing, so a run reads its cwd. The
          // same list the boundary hook below checks against.
          additionalDirectories: [...request.additionalDirectories],
          tools: [...PANE_TOOLS],
          disallowedTools: [...SESSION_DISALLOWED_TOOLS],
          // ── WHAT THIS SESSION MAY SPEND (`024`) ────────────────────────
          // Three limits, and they are three different mechanisms rather than one written three
          // ways. `maxBudgetUsd` is the hard stop: the CLI compares its own client-side estimate
          // against it and ends the query, which is why the pane has to offer a door out of it.
          // `taskBudget` is the opposite kind of thing — the API tells the MODEL how much room is
          // left, so it paces and wraps up instead of being cut off mid-write. And `maxTurns` is
          // the brake for the loop neither of the others catches: cheap per turn, never converging.
          maxBudgetUsd: policy.maxBudgetUsd,
          maxTurns: policy.maxTurns,
          // Omitted entirely rather than zeroed on the reopen: a model that refused one must not be
          // sent a smaller one, it must be sent none. See `isPacingUnsupported`.
          ...(request.pacing === false ? {} : { taskBudget: { total: policy.pacingTokens } }),
          effort,
          // Null means the CLI's own default, which is what a session that has never touched the
          // model selector should get — not this app's opinion of which model to use.
          ...(request.model ? { model: request.model } : {}),
          // THE TRANSCRIPT HAS TO OUTLIVE THE QUERY, or the ceiling has no door. Passed explicitly
          // rather than left to the SDK's `true` default, because the whole of Continue rests on it
          // and a diff that turned it off would break resuming while every test still passed.
          persistSession: true,
          // The same conversation, picked up where the last allowance ran out. Absent on a session
          // the user started themselves.
          ...(request.resume ? { resume: request.resume } : {}),
          // FORK, so a conversation the app did not start keeps its own history (`025`). Only ever
          // set with `resume`, and only by the picker: a Continue is the same session carrying on,
          // and a fork there would split one conversation into two records of itself.
          ...(request.resume && request.fork ? { forkSession: true } : {}),
          // A budget can land mid-write. Checkpointing is what makes that recoverable rather than
          // merely reported — the files the interrupted turn had already touched are tracked, so a
          // rewind is possible without re-deriving what changed from the transcript.
          enableFileCheckpointing: true,
          // PREVIEWS ARE OPT-IN, AND THIS IS THE OPT-IN. Without it Claude emits no `preview` on
          // any `AskUserQuestion` option — not a shorter one, none at all — and the choice arrives
          // as a bare list of labels. It is the second of this feature's two mechanical
          // preconditions; the first is `AskUserQuestion` being in `PANE_TOOLS` above.
          toolConfig: { askUserQuestion: { previewFormat: QUESTION_PREVIEW_FORMAT } },
          // The skills the pane may reach, and the plugin they live in. Both, or neither works —
          // see `PaneSessionRequest.pluginDir`.
          skills: [...PANE_SKILLS],
          plugins: request.pluginDir ? [{ type: "local" as const, path: request.pluginDir }] : [],
          permissionMode: "default",
          // Nothing on disk configures this session — not its permissions, not its skills, and not
          // where the bill goes. Note the consequence: CLAUDE.md files are NOT auto-loaded, since
          // the SDK needs `settingSources` to include 'project' for that. The model can still Read
          // them, and the pane should expect to be told to.
          settingSources: [],
          systemPrompt: { type: "preset", preset: "claude_code" },
          hooks: {
            // THE READ BOUNDARY. `canUseTool` cannot do this: it fires only for calls that would
            // otherwise prompt, and reads never do. This fires for every tool call.
            PreToolUse: [
              {
                hooks: [
                  async (input: unknown) => {
                    const hook = input as { tool_name?: string; tool_input?: Record<string, unknown> };
                    const tool = String(hook.tool_name ?? "");
                    const toolInput = hook.tool_input ?? {};

                    // The network tools reach `canUseTool` only because this says so. They pass
                    // every path check there is — they touch no path — so without a route into the
                    // prompt they are auto-approved, and a `WebFetch` is how the contents of the
                    // project the session can read leave the machine.
                    if ((PANE_ASK_TOOLS as readonly string[]).includes(tool)) {
                      return askHook(`${tool} reaches the network. The app does not decide that for you.`);
                    }

                    // Only where `decideWrite` does not answer. Every write is already answered by
                    // the write scope with a reason the model can act on, and letting the boundary
                    // answer first would replace that reason with a different one.
                    if (!(READ_ONLY_TOOLS as readonly string[]).includes(tool)) return {};

                    const verdict = decideBoundary({
                      tool,
                      input: toolInput,
                      // Read fresh on EVERY call. A session grant widens this between one tool call
                      // and the next, and a list captured when the session started would go on
                      // stopping a path the user has already opened.
                      directories: readable(),
                      cwd: request.cwd,
                    });
                    if (verdict.decision === "allow") return {};

                    // A call with NO PATH IN IT STAYS A DENY, and it is the only one that does.
                    // There is nothing here for a person to authorise — the call named no file, so
                    // "allow it" would mean allowing an unknown read — and a prompt whose subject
                    // is blank is a prompt answered by reflex.
                    //
                    // This is also why the transcript entry below still exists. Hook denials are
                    // NOT reported through `SDKPermissionDeniedMessage`, so this layer owns its own
                    // entry or the call vanishes: no prompt, no auto-deny event, and a tool that
                    // simply appears to have found nothing.
                    if (!verdict.path) {
                      emit({
                        kind: "refusal",
                        tool,
                        target: null,
                        reason: verdict.reason,
                        source: "read-boundary",
                        decidedBy: null,
                      });
                      return {
                        hookSpecificOutput: {
                          hookEventName: "PreToolUse" as const,
                          permissionDecision: "deny" as const,
                          permissionDecisionReason: verdict.reason,
                        },
                      };
                    }

                    // ROUTED, NOT REFUSED. `"ask"` is what makes a read the boundary stopped reach
                    // `canUseTool` at all: reads are auto-approved and never prompt on their own,
                    // so without this the call is silently allowed or silently denied and the user
                    // is asked nothing. The verdict is spelled "out-of-scope" rather than "deny"
                    // precisely so this stayed the one-word change it was written to be. The
                    // transcript entry then comes from the ANSWER, so a routed read is written down
                    // once rather than twice.
                    return askHook(verdict.reason);
                  },
                ],
              },
            ],
            // ── THE OTHER DOORS ────────────────────────────────────────────
            // A permission prompt is not the only way the read scope can move, and the other ways
            // do not go through `canUseTool` at all: a directory added to the CLI's own working
            // roots, and the working directory moving underneath the whole session. Neither reaches
            // this app's boundary — `readable()` is ours and only a grant adds to it — so the
            // failure they cause is not an open door, it is a SILENT DISAGREEMENT: the CLI thinks a
            // tree is in scope, the hook goes on asking about it, and nothing says why. These two
            // handlers are the "and is surfaced" half. They are boundary events, not log lines.
            //
            // MEASURED IN THE WINDOW, and narrower than it looks: `/add-dir` typed into the
            // composer answers `/add-dir isn't available in this environment.` in an SDK session —
            // for a directory inside the cwd and outside it alike — so that door is closed by the
            // CLI and its refusal is already visible in the transcript as an assistant turn. What
            // remains is `source: "register_repo_root"`, the SDK control request, which nothing in
            // this app issues today. So `DirectoryAdded` is currently unreachable from the pane;
            // it is registered because the alternative to a handler that never fires is a silent
            // widening the first time one of those two things changes.
            DirectoryAdded: [
              {
                hooks: [
                  async (input: unknown) => {
                    const hook = input as { directory?: string; source?: string };
                    const directory = String(hook.directory ?? "").trim();
                    // Our own grant comes back through here. Saying "something widened the scope"
                    // about the thing the user just pressed a button for would teach them to ignore
                    // the notice that matters.
                    if (directory !== "" && granted.includes(directory)) return {};
                    emit({
                      kind: "notice",
                      text:
                        `${directory || "A directory"} was added to Claude Code's own working directories` +
                        `${hook.source === "slash_command" ? " by a command typed into the composer" : " by a request from outside this app"}. ` +
                        `This app's read boundary did not move: reads there are still stopped and asked about. ` +
                        `Answer one of those prompts with "Allow this folder" to open it for the session.`,
                    });
                    return {};
                  },
                ],
              },
            ],
            CwdChanged: [
              {
                hooks: [
                  async (input: unknown) => {
                    const hook = input as { old_cwd?: string; new_cwd?: string };
                    // The boundary is anchored to `request.cwd` and STAYS there. A relative path
                    // resolved against a moved working directory would quietly point somewhere else,
                    // and a boundary that follows the thing it is bounding is not one. Like
                    // `DirectoryAdded` above, this has no route from the pane today — the pane
                    // offers no way to move the cwd — so it is registered rather than demonstrated.
                    emit({
                      kind: "notice",
                      text:
                        `The session's working directory moved to ${hook.new_cwd ?? "somewhere else"}` +
                        `${hook.old_cwd ? ` (from ${hook.old_cwd})` : ""}. ` +
                        `What this session may read is still anchored to ${request.cwd} and did not move with it.`,
                    });
                    return {};
                  },
                ],
              },
            ],
          },
          canUseTool: async (tool: string, input: Record<string, unknown>, options: CanUseToolOptions) => {
            // ── A QUESTION IS NOT A PERMISSION REQUEST ───────────────────────
            // Branched on the TOOL NAME first, the way the hook checks `PANE_ASK_TOOLS` first, and
            // for a sharper reason: `decidePaneCall` would refuse this as a tool the session does
            // not offer, and even if it did not, "Claude wants to use a tool — Allow / Deny" is the
            // wrong sentence for "which of these three shapes do you want". A question reaches here
            // even when a rule would auto-approve it — by definition it needs a human, so it cannot
            // be configured away — and the decision still is not authored in this file: the branch
            // routes to `session-question.ts` exactly as the rest routes to `session-permission.ts`.
            if (tool === QUESTION_TOOL) return askQuestion(input, options);

            // The SAME engines the form path and the hook use, composed — not a second one.
            // `writable()` is the pane's write scope: empty until a create-* form is handed off,
            // and read fresh on every call so a form submitted mid-session reaches this and not the
            // list that existed when the pane opened. `decideWrite` still produces the refusal and
            // still produces its reason; `decidePaneCall` adds the branch where that refusal
            // becomes a question rather than the end of the matter.
            const verdict = decidePaneCall({
              tool,
              input,
              writable: writable(),
              directories: readable(),
              cwd: request.cwd,
            });

            if (verdict.outcome === "settled") {
              if (verdict.decision.behavior === "deny") {
                emit({
                  kind: "refusal",
                  tool,
                  target: targetPathOf(input),
                  reason: verdict.decision.message,
                  source: "write-scope",
                  decidedBy: null,
                });
                return verdict.decision;
              }
              // A silent allow, and possibly the first one inside a directory a form just opened —
              // in which case it is also the only chance to tell the CLI about that directory. See
              // `unannounced`: this is a lazy `addDirectories`, not a second grant surface, and
              // `destination: "session"` is what keeps it off the user's disk.
              const opened = announceWriteScope(targetPathOf(input));
              return opened.length === 0
                ? verdict.decision
                : {
                    behavior: "allow" as const,
                    updatedPermissions: opened.map((directory) => ({
                      type: "addDirectories" as const,
                      directories: [directory],
                      destination: "session" as const,
                    })),
                  };
            }

            // ── the ask ──────────────────────────────────────────────────────
            // Keyed on the SDK's own envelope id — see `askKey`, which the question branch above
            // shares, because both kinds of ask are parked in the one registry.
            const requestId = askKey(tool, options);
            const { fresh, answer } = permissions.request(requestId);
            if (fresh) {
              emit({
                kind: "permission",
                request: {
                  requestId,
                  toolUseId: options?.toolUseID ?? null,
                  tool,
                  agentId: options?.agentID ?? null,
                  // The path the SDK says triggered it, when it named one — it knows about reasons
                  // this app does not, such as a rule matching a path our own check waved through.
                  target: options?.blockedPath ?? verdict.target,
                  reason: permissionReason(verdict.reason, `${tool} needs your permission.`),
                  denyReason: permissionReason(
                    verdict.denyReason,
                    `The user did not allow this ${tool} call. Say what you needed it for instead.`
                  ),
                  decisionReason: options?.decisionReason ?? null,
                  title: options?.title ?? null,
                  detail: verdict.detail,
                  // WHAT COULD BE GRANTED, resolved here and published with the question. The
                  // renderer sends back a scope WORD; it never names a path, so this is also the
                  // only list a grant can be resolved against. `grantable` is false for writes and
                  // for the network tools, which is what keeps this from widening the wrong surface.
                  grants:
                    verdict.grantable && verdict.target
                      ? grantOptionsFor(verdict.target, isDirectory(verdict.target), readable())
                      : [],
                },
              });
            }

            const decision = await answer;
            emit({
              kind: "permission-resolved",
              requestId,
              outcome: decision.behavior === "allow" ? "allow" : decision.interrupt === true ? "stop" : "deny",
            });
            if (decision.behavior === "deny") {
              emit({
                kind: "refusal",
                tool,
                target: verdict.target,
                reason: decision.message,
                source: "user",
                decidedBy: null,
              });
            }
            return decision;
          },
          stderr: (chunk: string) => {
            const text = chunk.trim();
            if (text) emit({ kind: "notice", text });
          },
        },
      });
      query = q;
      if (closed) {
        q.close();
        return finish(null);
      }

      for await (const message of q) {
        if (message.type === "system" && message.subtype === "init") {
          // ONE INIT PER TURN, not one per session — measured, and it is why this branch assigns
          // rather than appends. What it is here for is the session id: it is the handle a Continue
          // resumes against, and on a resumed query it comes back UNCHANGED, which is the evidence
          // that continuing is the same conversation rather than a new one wearing its transcript.
          // On a FORKED resume (`025`) it comes back DIFFERENT, and that is the same evidence read
          // the other way: a new id is a new transcript, which is how the session the user started
          // in their terminal keeps its own.
          cliSessionId = message.session_id ?? cliSessionId;
          if (!announcedSettings) {
            announcedSettings = true;
            void announceSettings(message.model ?? null);
          }
          continue;
        }
        if (message.type === "assistant") {
          for (const event of assistantEvents(message.message?.content)) emit(event);
          // THE PACING BUDGET IS A MODEL PROPERTY AND NOTHING ADVERTISES IT. A model that will not
          // accept one answers every turn with a 400 and does no work at all, so this is checked on
          // the way past rather than waited for: the caller reopens the session without the budget,
          // and the conversation carries on.
          if (
            request.pacing !== false &&
            !pacingRejected &&
            paneTextOf(message.message?.content).some(isPacingUnsupported)
          ) {
            pacingRejected = true;
            request.onPacingRejected?.();
          }
          continue;
        }
        if (message.type === "system" && message.subtype === "permission_denied") {
          // THE OTHER DENIAL ROUTE, and it shares no code with the two above. The permission system
          // auto-denies some calls without ever reaching `canUseTool` — a deny RULE, or the mode —
          // and says so only here. Without this branch those calls are invisible: no prompt, no
          // refusal, and a tool that looks like it did nothing. `decision_reason_type` is the
          // discriminator naming which component decided, and the transcript shows it, because
          // "a rule refused this" and "the model's own classifier refused this" are different
          // things for the user to do something about.
          emit(autoRefusal(message));
          continue;
        }
        if (message.type === "result") {
          // A turn ended — NOT the session. A streaming-input query emits one result per turn and
          // keeps running, which is exactly why the pump above stays open.
          //
          // EXCEPT WHEN NOTHING RAN. Measured in the window: a `shouldQuery: false` append is
          // answered with a result of its own — `subtype: "success"`, `total_cost_usd: 0`, no
          // assistant message anywhere near it. Reporting that as a turn is wrong twice over: the
          // transcript claims something happened when a handoff seeded context, and the renderer
          // clears `busy` on it, so a Stop button can vanish while a real turn is still running.
          // A result with no outstanding user turn behind it and no cost is that receipt.
          const spent = message.total_cost_usd ?? null;
          if (awaitingTurns > 0) awaitingTurns--;
          else if (spent === 0 || spent === null) continue;

          // THE RUNNING FIGURE IS FED FROM HERE AND NOWHERE ELSE, behind the guard above, because
          // the guard is the only thing that knows an append cost nothing. `total_cost_usd` is
          // CUMULATIVE for the query rather than the price of this turn — measured; see
          // `accrueTurn`, which is why this is not a `+=`.
          // A CEILING IS NOT A FAILURE, and this is the one place that can tell the difference.
          const ceiling = ceilingOf(message.subtype);
          spend = accrueTurn(spend, spent);
          emit({
            kind: "turn",
            ok: message.subtype === "success" && !message.is_error,
            error: ceiling
              ? ceilingTurnNote(ceiling)
              : message.subtype === "success" && !message.is_error
                ? null
                : `The turn ended as ${message.subtype}.`,
            costUsd: spent,
          });
          emit({ kind: "spend", spend });

          if (ceiling) {
            ceilingHit = ceiling;
            // AND IT IS ACTED ON HERE, RATHER THAN WAITED OUT. MEASURED IN A WINDOW, and it is the
            // difference between a ceiling and a decoration: with a streaming-input pump the query
            // does NOT tear itself down after the budget result. The pump is still open, so the CLI
            // takes the next turn, answers it with another error result within milliseconds, and
            // goes on doing that forever — 12 turns in 1.6 seconds, none of which reached the
            // model. A latch that only fires where the stream ENDS therefore never fires at all:
            // the composer stays enabled and every turn after the ceiling is a silent no-op.
            // Leaving the loop is what makes the ending an ending. (The latch is still read in the
            // `catch` below, for the shape where the SDK throws instead of yielding a result.)
            break;
          }
        }
      }
      // The ceiling's exit leaves the SDK holding the child, where the stream's own end does not.
      // `finish` first, so the ending is on screen before anything can fail: closing is teardown of
      // a session that has already ended, not part of ending it.
      finish(null, ceilingHit ?? "closed");
      if (ceilingHit) {
        try {
          query?.close();
        } catch {
          /* already gone — the ending has been reported either way */
        }
      }
    } catch (err) {
      // The ceiling's own teardown arrives here as a throw — see `ceilingHit`. Reading the latch
      // first is what turns "the session crashed" back into "the session reached its ceiling".
      if (ceilingHit) return finish(null, ceilingHit);
      finish(err instanceof Error ? err.message : String(err), "error");
    }
  })();

  return {
    ended,
    say(text: string): boolean {
      if (closed) return false;
      awaitingTurns++;
      queue.push(humanTurn(text));
      wake?.(null);
      wake = null;
      return true;
    },
    seed(text: string): boolean {
      const context = String(text ?? "").trim();
      if (closed || context === "") return false;
      queue.push(contextTurn(context));
      wake?.(null);
      wake = null;
      return true;
    },
    answer(requestId: string, decision: PermissionAnswer): boolean {
      return permissions.answer(requestId, decision);
    },
    answerQuestion(requestId: string, choice: QuestionChoice): { ok: boolean; error: string | null } {
      const parked = asked.get(requestId);
      // Ordinary, not an error: a click that arrived after the session ended, or a second click on
      // a question already answered.
      if (!parked) return { ok: false, error: null };

      // THE VALIDATION, AGAINST THE CALL ITSELF. `parked.questions` was read out of the tool input
      // the SDK delivered, so a label that was not among the options offered is rejected here and
      // nothing is answered — the payload below is built entirely from strings the MODEL wrote,
      // plus which of them the user picked.
      const resolution = answerQuestions(parked.questions, choice);
      if (!resolution.ok) return { ok: false, error: resolution.error };

      // The call as it arrived, plus the answer. Merged rather than rebuilt: the tool reads its own
      // `questions` back out of the input, and reconstructing that array here would mean this app
      // deciding what the model asked.
      const updatedInput: Record<string, unknown> = { ...parked.input, answers: resolution.answers };
      // A FREEFORM REPLY IS AN ANSWER TOO, and it goes in `response` rather than in `answers`:
      // the tool then tells the model "The user responded: …" instead of a per-question list, which
      // is exactly right for a user who disagreed with every option on offer.
      if (resolution.response !== null) updatedInput.response = resolution.response;

      const answered = permissions.answer(requestId, { behavior: "allow", updatedInput });
      return { ok: answered, error: null };
    },
    allowWrites(paths: readonly string[]): string[] {
      const added: string[] = [];
      for (const raw of paths) {
        const resolved = path.resolve(request.cwd, String(raw ?? "").trim());
        if (resolved === "" || writes.includes(resolved)) continue;
        writes.push(resolved);
        // Queued for the CLI, which has no channel to be told right now — see `unannounced`.
        unannounced.add(resolved);
        added.push(resolved);
      }
      return added;
    },
    writable(): string[] {
      return writable();
    },
    grant(paths: readonly string[]): string[] {
      const added: string[] = [];
      for (const raw of paths) {
        const resolved = path.resolve(request.cwd, String(raw ?? "").trim());
        if (resolved === "" || granted.includes(resolved)) continue;
        granted.push(resolved);
        added.push(resolved);
      }
      return added;
    },
    revoke(target: string): boolean {
      const resolved = path.resolve(request.cwd, String(target ?? "").trim());
      const at = granted.indexOf(resolved);
      if (at < 0) return false;
      granted.splice(at, 1);
      return true;
    },
    granted(): string[] {
      return [...granted];
    },
    pendingPermissions(): string[] {
      return permissions.pending();
    },
    sessionId(): string | null {
      return cliSessionId;
    },
    spend(): SessionSpend {
      return { ...spend };
    },
    async setEffort(level: SessionEffort): Promise<boolean> {
      // `applyFlagSettings` writes into the flag layer the query's own options populate, so this is
      // the same setting arriving by a different door rather than a second notion of effort. It
      // takes effect from the next turn; the transcript is untouched.
      try {
        await query?.applyFlagSettings({ effortLevel: level });
        effort = level;
        void announceSettings(activeModel);
        return true;
      } catch {
        return false;
      }
    },
    async setModel(model: string | null): Promise<boolean> {
      try {
        // `undefined` — not `null` — is the SDK's "back to the session default".
        await query?.setModel(model ?? undefined);
        activeModel = model;
        void announceSettings(model);
        return true;
      } catch {
        return false;
      }
    },
    async models(): Promise<SessionModel[]> {
      try {
        return ((await query?.supportedModels()) ?? []).map((entry) => ({
          id: entry.value,
          label: entry.displayName ?? entry.value,
          description: entry.description ?? "",
          effortLevels: entry.supportsEffort === false ? [] : [...EFFORT_LEVELS],
        }));
      } catch {
        return [];
      }
    },
    async stop(): Promise<{ stillQueued: string[] }> {
      try {
        // THE RECEIPT IS READ, not discarded. On a CLI advertising `interrupt_receipt_v1` this
        // resolves with the uuids of queued user messages the interrupt did NOT reach — each of
        // which runs as its own turn immediately afterwards. Dropping it made Stop claim to have
        // stopped a session that was about to start talking again.
        const receipt = await query?.interrupt();
        return { stillQueued: receipt?.still_queued ?? [] };
      } catch {
        /* nothing in flight, or a CLI that does not answer — Stop still tears down above */
        return { stillQueued: [] };
      }
    },
    close(): void {
      closed = true;
      // BEFORE the query is closed, not after: a `canUseTool` promise parked on a prompt nobody is
      // left to answer holds the SDK's read loop open, and with it the detached child. This is the
      // window-close / project-switch / quit path, and it is the one with no user action to hang a
      // resolution off.
      releasePermissions(TEARDOWN_DENIAL);
      wake?.(null);
      wake = null;
      query?.close();
    },
  };
}

/** Just the text blocks of an assistant message — for reading what the API said, not for rendering. */
function paneTextOf(content: unknown): string[] {
  if (!Array.isArray(content)) return [];
  return (content as Array<Record<string, unknown>>)
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => String(block.text));
}

/** Assistant text and tool calls, as separate transcript entries rather than one rendered string. */
function assistantEvents(content: unknown): SessionEventBody[] {
  if (!Array.isArray(content)) return [];
  const events: SessionEventBody[] = [];
  for (const block of content as Array<Record<string, unknown>>) {
    if (block?.type === "text" && typeof block.text === "string" && block.text.trim()) {
      events.push({ kind: "assistant", text: block.text });
    }
    if (block?.type === "tool_use") {
      const input = (block.input ?? {}) as Record<string, unknown>;
      // The humanizer in the renderer renders `Tool(target)`; what counts as the target differs per
      // tool, and picking it here keeps the renderer from learning tool-input shapes.
      const target =
        targetPathOf(input) ??
        (typeof input.pattern === "string"
          ? input.pattern
          : typeof input.command === "string"
            ? input.command
            : typeof input.skill === "string"
              ? input.skill
              : null);
      events.push({ kind: "tool", tool: String(block.name), target });
    }
  }
  return events;
}

// ─────────────────────────────────────────────────────────────────────────────
// The settings cascade — what a run will ACTUALLY be configured with.
// ─────────────────────────────────────────────────────────────────────────────

/** The shape of a `permissions` block, normalised. Absent lists become empty ones, never undefined. */
function permissionsOf(settings: { permissions?: Record<string, unknown> } | undefined): SettingsPermissions {
  const p = settings?.permissions ?? {};
  const list = (key: string): string[] => (Array.isArray(p[key]) ? (p[key] as unknown[]).map(String) : []);
  const mode = p.defaultMode;
  return {
    additionalDirectories: list("additionalDirectories"),
    allow: list("allow"),
    deny: list("deny"),
    ask: list("ask"),
    defaultMode: typeof mode === "string" ? mode : null,
  };
}

/** The SDK's `ResolvedSettingSource` is our `SettingsTier` — asserted rather than assumed. */
function tierOf(source: string): SettingsTier | null {
  return source === "user" || source === "project" || source === "local" || source === "managed" || source === "flag"
    ? source
    : null;
}

/**
 * Resolve the settings a run in `cwd` would actually see, through the CLI's own merge engine.
 *
 * `resolveSettings` is the reason this disclosure can claim to be true rather than plausible. The
 * alternative was to read `~/.claude/settings.json` and the project's two files here and merge them
 * ourselves — a second implementation of a cascade the CLI owns, drifting silently the first time
 * a tier or a precedence rule changes. Same argument as `ccusage`: do not become a second reader of
 * someone else's format.
 *
 * Three things about the call are deliberate:
 *
 *   • **`settingSources` matches the session's**, and that is the whole reason this function has to
 *     be edited whenever `startAgentSession` is. It was left UNSET while a run was `claude -p`,
 *     because an unset value loads every tier and that is what such a run got. A run is now an SDK
 *     session configured entirely by this app, so `[]` is passed here for the same reason it is
 *     passed there: the disclosure describes the session that exists. Note what `[]` does NOT drop —
 *     the managed (administrator) policy tier is still read from disk, so an admin deny rule still
 *     appears, and still applies.
 *   • **`defaultMode` goes through `filterEscalatingDefaultMode`.** The raw cascade reports an
 *     escalating mode from a repo-committed file as though it applied; the CLI does not honour it
 *     without a trust check. Reporting the unfiltered value would overstate what a run can do.
 *   • **It spawns no `claude`.** It may shell out to `plutil`/`reg.exe` on a machine with MDM
 *     policy — which is why this lives in `agent-sdk.ts` behind a port, and not somewhere
 *     `claude-preview.ts` can import.
 */
export async function resolveEffectiveSettings(cwd: string): Promise<EffectiveSettingsSnapshot> {
  // Literal specifier, not AGENT_SDK_PACKAGE — see the note at the query above.
  const { resolveSettings, filterEscalatingDefaultMode } = await import("@anthropic-ai/claude-agent-sdk");
  const resolved = await resolveSettings({ cwd, settingSources: [] });

  const sources: SettingsSourceInfo[] = [];
  for (const entry of resolved.sources) {
    const tier = tierOf(entry.source);
    if (!tier) continue;
    sources.push({ tier, path: entry.path ?? null, permissions: permissionsOf(entry.settings) });
  }

  return {
    sources,
    effective: {
      ...permissionsOf(resolved.effective),
      defaultMode: permissionsOf(filterEscalatingDefaultMode(resolved)).defaultMode,
    },
  };
}

// ── The CLI's own session store, read (`025`) ─────────────────────────────────────────────
//
// A conversation someone started in their terminal is on disk, and so is every session this app has
// ever run — `024` passes `persistSession: true` explicitly. Reading that store is a THIRD reason
// this module exists, beside starting sessions and resolving settings, and it lands here for the
// same reason both of those did: the SDK is imported in exactly one file.
//
// NOT A SECOND READER OF SOMEONE ELSE'S FORMAT. The transcripts are JSONL under
// `~/.claude/projects/<slug>/`, and walking them here would be the `ccusage` mistake — a private
// layout, a slug encoding, and a summary-extraction rule, all re-derived and drifting in silence.
// `listSessions`/`getSessionMessages` are the CLI's own answer to both questions.
//
// NEITHER FUNCTION THROWS. A store that cannot be read is a picker with nothing in it, which is a
// state the pane already renders; it is not a reason to lose the pane.

/**
 * The conversations the store holds for one project directory, newest first.
 *
 * `includeWorktrees: false` is deliberate and is half of "sessions belonging to other projects are
 * not offered": a worktree is a different directory, its transcript's relative paths mean something
 * else there, and the pane's boundary is anchored to the open project. The other half is the `cwd`
 * equality check in `resumableFrom`, because the store's directory slug flattens every `/` to `-`
 * and cannot distinguish `/home/a-b` from `/home/a/b`.
 *
 * `includeProgrammatic` is left at its default (true) ON PURPOSE, and it is the one filtering
 * decision here worth arguing with. Passing false would mean parity with the terminal's own
 * `/resume`, which lists interactive sessions only — but it would also hide every session this app
 * has run, since an SDK session records a programmatic entrypoint, and "yesterday's pane
 * conversation" is exactly as resumable as yesterday's terminal one. Measured: with false, a
 * fixture project whose only sessions were SDK-started listed zero rows.
 */
export async function listStoredSessions(dir: string): Promise<StoredSession[]> {
  if (!dir) return [];
  try {
    // Literal specifier, not AGENT_SDK_PACKAGE — see the note at the query above.
    const { listSessions } = await import("@anthropic-ai/claude-agent-sdk");
    const rows = await listSessions({ dir, includeWorktrees: false });
    return Array.isArray(rows) ? (rows as StoredSession[]) : [];
  } catch {
    return [];
  }
}

/**
 * One stored transcript's messages, for the disclosure that has to be read before it is resumed.
 *
 * `includeSystemMessages: true` because the point is to account for what is ALREADY in front of the
 * model, and a compact boundary or an injected notice is part of that. What this cannot see is the
 * store's attachment records — files auto-loaded, pasted or `@`-mentioned — which is why
 * `readNote()` says so rather than letting the list imply completeness.
 */
export async function readStoredMessages(sessionId: string, dir: string): Promise<StoredMessage[]> {
  if (!sessionId) return [];
  try {
    // Literal specifier, not AGENT_SDK_PACKAGE — see the note at the query above.
    const { getSessionMessages } = await import("@anthropic-ai/claude-agent-sdk");
    const messages = await getSessionMessages(sessionId, { ...(dir ? { dir } : {}), includeSystemMessages: true });
    return Array.isArray(messages) ? (messages as unknown as StoredMessage[]) : [];
  } catch {
    return [];
  }
}

/**
 * The `SettingsPort` the composition root hands to the preview.
 *
 * A one-line factory rather than the function itself, so that what `src/main/ipc.ts` passes reads
 * the same as `nodeGit()` beside it: a capability being supplied, at the one place in the app that
 * is allowed to supply capabilities.
 */
export function nodeSettings(): SettingsPort {
  return { resolve: (cwd) => resolveEffectiveSettings(cwd) };
}
