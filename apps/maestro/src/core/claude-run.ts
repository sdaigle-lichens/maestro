// Run — the only module in the app that starts a Claude process, and it will not start one
// without a token `claude-preview.ts` issued.
//
// The entry point takes a token and a sink for output. It does not take a prompt, an argv, a cwd,
// or any other way to influence what runs: those come out of the invocation the token names. A
// caller therefore cannot express "run this other thing", which is a stronger guarantee than
// validating that they didn't (see `claude-tokens.ts` for why the argument list is the design).
//
// It used to spawn `claude -p --permission-mode acceptEdits <prompt>` and read its stdout. It now
// drives an **Agent SDK session** (`startAgentSession` in `agent-sdk.ts`) over the same invocation.
// What that bought, and what it deliberately did not change:
//
//   • **The permission model.** `acceptEdits` was not decoration — a headless run has nobody to ask,
//     so without it the default mode turns every useful run into a refusal. But it granted writes to
//     anything anywhere under the working directory, which for a marketplace target is a whole
//     repository. The host process IS somebody to ask, so the session's `canUseTool` silently allows
//     writes to exactly the paths the confirmation displayed and denies everything else with a
//     reason the model can act on. Strictly narrower, and nothing the user notices.
//   • **The token is unchanged.** Preview builds the prompt and issues it; this module claims it and
//     nothing else. The guarantee was always about which prompt executes, never about which process
//     ran it.
//   • **The detached process group stays.** The SDK accepts a custom spawn function, and this module
//     supplies one, because Stop has to reach the CLI's own children. Trading a working teardown for
//     an unverified one is not a simplification.
//
// Two operational properties the UI depends on:
//
//   • **Output streams.** A create-a-skill run is tens of seconds and a task run is minutes. The
//     result is delivered as it arrives, not accumulated and handed over at the end, because a
//     window with nothing in it is indistinguishable from a window that has hung.
//   • **Cancel actually kills.** Closing the query, aborting a read loop and interrupting a turn are
//     three different things. Stop does the first — which releases the child the SDK knows about —
//     and then signals the whole process group, which is the part that reaches the grandchildren.

import { spawn, type ChildProcess, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { claimInvocation, TokenRefused } from "./claude-tokens.js";
import { claudeChildPath } from "./claude-cli.js";
import { startAgentSession, type AgentSession, type AgentSessionRequest, type SpawnOptions } from "./agent-sdk.js";
import type { ClaudeOutputChunk, ClaudeRunResult } from "./contracts.js";

export { TokenRefused };
export type { ClaudeOutputChunk, ClaudeRunResult };

/**
 * How much output is retained for the result. Streaming is unbounded — every chunk reaches the UI
 * as it arrives — but a run that prints a megabyte a second must not grow the main process's heap
 * without limit. The TAIL is kept: the end of a failing run is the part that says why.
 */
const RETAINED_OUTPUT_BYTES = 512 * 1024;

/** Grace between asking the process group to stop and insisting. */
const SIGKILL_AFTER_MS = 5000;

interface ActiveRun {
  /** Ends the session and releases the CLI the SDK is holding. */
  session: AgentSession;
  /** The child the spawn function below produced, so the whole GROUP can be signalled. */
  child: ChildProcess | null;
  /** Set by `cancelClaudeRun`, so the exit is reported as a cancellation and not as a crash. */
  cancelled: boolean;
  killTimer: ReturnType<typeof setTimeout> | null;
}

/** Keyed by the token that authorised the run — the id both sides of the IPC already hold. */
const active = new Map<string, ActiveRun>();

export interface ClaudeRunEvents {
  /** Called for every chunk, as it arrives. */
  output(chunk: ClaudeOutputChunk): void;
  /**
   * The bundled plugin's root, so the run can reach the create-\* skills the prompt names.
   *
   * Supplied by main, the composition root, for the same structural reason `GitPort` and
   * `SettingsPort` are: only it knows where the app's own files landed. Omitted, the session loads
   * no plugin and the prompt's facts are all the run has — thinner, never wrong.
   */
  pluginDir?: string | null;
}

/**
 * How a run is executed. Exists so the outcome mapping below can be tested without the real SDK,
 * a real `claude`, real tokens or real money — none of which say anything about whether a
 * `crashed` is distinguishable from a `failed`.
 *
 * The app never passes it. `test/core/claude.test.ts` does, and the spawn function it replaces is
 * tested directly and separately, because "the group really dies" is not a thing a fake can show.
 */
export interface ClaudeRunDeps {
  start(request: AgentSessionRequest): AgentSession;
}

/** Append with a cap, keeping the tail. */
function appendCapped(buffer: string, chunk: string): { text: string; truncated: boolean } {
  const text = buffer + chunk;
  if (text.length <= RETAINED_OUTPUT_BYTES) return { text, truncated: false };
  return { text: text.slice(text.length - RETAINED_OUTPUT_BYTES), truncated: true };
}

/**
 * Signal the whole process group.
 *
 * `detached: true` at spawn makes the child a group leader, so `process.kill(-pid)` reaches it and
 * everything it started. Falling back to the plain pid matters on platforms where the negative-pid
 * form isn't supported — a cancel that silently does nothing is worse than a noisy one.
 */
function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      /* already gone */
    }
  }
}

/**
 * Start the CLI the way this app needs it started, for the SDK to talk to.
 *
 * Exported because it carries the one property no fake session can demonstrate: the child is a
 * process GROUP leader, so `signalGroup` reaches the children the CLI spawns for itself. Left to
 * the SDK's own spawn, Stop would kill the process we started and leave its grandchildren running
 * against the user's repo — the exact failure `detached` has always existed to prevent here.
 *
 * `stdio` is three pipes rather than the old `["ignore", "pipe", "pipe"]`: the SDK speaks a control
 * protocol to the child over stdin/stdout, so closing stdin would close the conversation. The
 * return type says so too — `SpawnedProcess` requires a non-null `stdin`, which the plain
 * `ChildProcess` type cannot promise and this overload can.
 */
export function spawnClaudeChild(options: SpawnOptions): ChildProcessByStdio<Writable, Readable, Readable> {
  return spawn(options.command, options.args, {
    cwd: options.cwd,
    // The environment the SDK built (see `agentChildEnv`), plus the PATH this app resolved for
    // itself if that env somehow arrived without one — a GUI launch hands us a PATH that may not
    // contain `node`, and the CLI shells out.
    env: { ...options.env, PATH: options.env.PATH ?? claudeChildPath() },
    // Its own process group, so cancelling can reach the CLI's children too.
    detached: true,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * Ask a child's whole process group to stop, and insist after a grace.
 *
 * The escalation `cancelClaudeRun` performs, exported so the session pane's teardown is the same
 * teardown rather than a second one written from the same description. The pane holds no token —
 * its turns are typed, not previewed — so it cannot go through `cancelClaudeRun`, but the property
 * that matters is identical: closing the SDK query releases the child the SDK knows about and
 * reaches none of its grandchildren, so the group has to be signalled too.
 */
export function terminateChildGroup(child: ChildProcess): void {
  signalGroup(child, "SIGTERM");
  const timer = setTimeout(() => signalGroup(child, "SIGKILL"), SIGKILL_AFTER_MS);
  timer.unref?.();
}

/**
 * Run the invocation a token authorises, streaming its output, and resolve with how it ended.
 *
 * Throws `TokenRefused` — before anything is spawned — for a forged, replayed or expired token.
 * Every other failure is a resolved `ClaudeRunResult`: a session that errored and a CLI that could
 * not be executed are both outcomes the user needs reported with their output, not exceptions that
 * reach the UI as a bare string.
 */
export async function runPreviewedClaude(
  token: unknown,
  events: ClaudeRunEvents,
  deps: ClaudeRunDeps = { start: startAgentSession }
): Promise<ClaudeRunResult> {
  // `async`, but the claim is still the first thing that happens and still happens before any
  // spawn — a refused token rejects the returned promise rather than throwing at the call site,
  // which is what an `await` in an IPC handler can actually catch.
  // "claude": a token issued by the usage-stats preview names an `npx`/`ccusage` invocation, and
  // claiming it here would spawn that while every message on screen said Claude.
  const inv = claimInvocation(token, "claude");
  const startedAt = Date.now();

  let stdout = "";
  let stderr = "";
  let truncated = false;
  /** What the SDK actually asked to be spawned — reported instead of the argv the modal showed. */
  let argv: string[] = [inv.bin, ...inv.args];
  /** A spawn-level failure, kept so it can be reported as a crash naming the file. */
  let spawnError: string | null = null;

  const record = (chunk: ClaudeOutputChunk) => {
    if (chunk.stream === "stdout") {
      const next = appendCapped(stdout, chunk.chunk);
      stdout = next.text;
      truncated = truncated || next.truncated;
    } else {
      const next = appendCapped(stderr, chunk.chunk);
      stderr = next.text;
      truncated = truncated || next.truncated;
    }
    events.output(chunk);
  };

  // Declared before `session` so the spawn function can register the child on the entry the moment
  // it exists — the SDK spawns during `startAgentSession`, which is before it returns a handle.
  const entry: ActiveRun = { session: null as unknown as AgentSession, child: null, cancelled: false, killTimer: null };

  const session = deps.start({
    prompt: inv.prompt,
    cwd: inv.cwd,
    bin: inv.bin,
    // Off the invocation, so what the confirmation listed is what the callback allows. There is no
    // argument on this function by which a caller could widen it.
    writable: inv.writable,
    // Not off the invocation: this names a directory INSIDE THE APP, not one in the user's tree,
    // and it widens nothing — a loaded plugin contributes skills, and its hooks do not run.
    pluginDir: events.pluginDir ?? null,
    output: record,
    spawn: (options) => {
      argv = [options.command, ...options.args];
      const child = spawnClaudeChild(options);
      entry.child = child;
      // Spawn-level failure: the binary vanished between preview and Run, or is not executable.
      // Captured here and reported as a crash naming the path, never as a raw ENOENT — "spawn
      // ENOENT" tells a user nothing about which file was missing.
      child.on("error", (err: NodeJS.ErrnoException) => {
        spawnError =
          err.code === "ENOENT"
            ? `Could not run ${options.command} — the file is no longer there. It was found when the prompt was previewed.`
            : err.code === "EACCES"
              ? `Could not run ${options.command} — it is not executable.`
              : `Could not run ${options.command}: ${err.message}`;
      });
      return child;
    },
  });

  entry.session = session;
  active.set(inv.token, entry);

  try {
    const outcome = await session.result;
    // Everything the callback refused is already in `stderr` as it happened; the count is what the
    // outcome line can use without re-reading it.
    const denials = outcome.denied.length;

    if (entry.cancelled) {
      return finish("cancelled", { code: null, signal: "SIGTERM", error: null });
    }
    if (spawnError) {
      return finish("crashed", { code: null, signal: null, error: spawnError });
    }
    if (outcome.ok) {
      return finish("ok", { code: 0, signal: null, error: null });
    }
    return finish("failed", {
      code: null,
      signal: null,
      error:
        (outcome.error ?? "The session ended without saying why.") +
        (denials ? ` ${denials} tool call${denials === 1 ? " was" : "s were"} denied — see the output above.` : ""),
    });
  } finally {
    if (entry.killTimer) clearTimeout(entry.killTimer);
    active.delete(inv.token);
    // Belt and braces: a session that resolved on its own has already released the child, and a
    // second close is a no-op. A session that resolved because the read loop ended early has not.
    session.close();
  }

  function finish(
    outcome: ClaudeRunResult["outcome"],
    rest: { code: number | null; signal: string | null; error: string | null }
  ): ClaudeRunResult {
    return { outcome, ...rest, stdout, stderr, truncated, durationMs: Date.now() - startedAt, argv, cwd: inv.cwd };
  }
}

/**
 * Stop a run. Returns false when there is nothing running under that token.
 *
 * Three steps, and they are not interchangeable. `close()` ends the query and releases the child
 * the SDK is holding; SIGTERM to the process GROUP is what reaches the CLI's own children; SIGKILL
 * follows if anything is still there. A Stop button that leaves a process alive is the failure this
 * exists to prevent, so the escalation is not optional.
 */
export function cancelClaudeRun(token: string): boolean {
  const entry = active.get(token);
  if (!entry) return false;
  entry.cancelled = true;
  entry.session.close();
  if (entry.child) {
    signalGroup(entry.child, "SIGTERM");
    if (!entry.killTimer) {
      const child = entry.child;
      entry.killTimer = setTimeout(() => signalGroup(child, "SIGKILL"), SIGKILL_AFTER_MS);
      entry.killTimer.unref?.();
    }
  }
  return true;
}

/**
 * Kill every run in flight. Called when the app quits: a detached process group outlives its
 * parent by design, so without this a closed window leaves Claude running against the user's repo.
 */
export function disposeClaudeRuns(): void {
  for (const token of [...active.keys()]) cancelClaudeRun(token);
}
