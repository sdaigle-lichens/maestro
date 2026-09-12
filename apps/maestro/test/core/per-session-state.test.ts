// `064` end-to-end: two Claude Code sessions running against ONE project keep wholly independent
// ephemeral state. Driven through the REAL scripts the installer copies into
// `<project>/.claude/scripts/`, fed the payloads Claude Code would send — nothing here is mocked
// and `session-paths.ts` is never stubbed. session-paths.test.ts owns the same rules at the module
// level; this file is the half that proves the installed runtime obeys them.
//
// ── THE TRAP THIS FILE EXISTS TO AVOID ─────────────────────────────────────────────────────────
//
// `CLAUDE_CODE_SESSION_ID` is set in the environment of a real Claude Code session, and every hook
// is spawned with `{ ...process.env }`. A test that neither set nor deleted it would inherit the
// DEVELOPER'S OWN session id: inside a session the hooks would write into
// `<tmp project>/.claude/maestro_sessions/<the dev's session>/`, and outside one they would write
// nothing at all. Either way the assertions would be looking somewhere the test didn't choose, and
// a green run would prove nothing. `hookEnv` below therefore always SETS the variable to a pinned
// id or DELETES it outright — no test in this file reads the ambient one.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

/** The two concurrent sessions every test in this file plays off against each other. */
const SESSION_A = "sess-aaa-111";
const SESSION_B = "sess-bbb-222";

let tmp: string;
let REPORTS_DB: string;
let PROJECT_TAGS_DB: string;
let HANDOFFS_DB: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-064-"));
  REPORTS_DB = path.join(tmp, "report-defaults.sqlite");
  PROJECT_TAGS_DB = path.join(tmp, "project-tags.sqlite");
  HANDOFFS_DB = path.join(tmp, "handoff-defaults.sqlite");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A git repo, because the install's .gitignore step resolves the repo root with `git rev-parse`. */
function makeProject(name: string): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

async function installed(name = "p"): Promise<string> {
  const root = makeProject(name);
  writeConfig(root, defaultish);
  await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
  return root;
}

/** `sessionId: null` deletes the variable — the "no id resolves" arm. HOME is this test's tmp. */
function hookEnv(root: string, sessionId: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp };
  if (sessionId === null) delete env.CLAUDE_CODE_SESSION_ID;
  else env.CLAUDE_CODE_SESSION_ID = sessionId;
  return env;
}

/** Run an installed hook on stdin. Returns stdout, exit code and stderr — never throws. */
function hook(root: string, script: string, payload: unknown, sessionId: string | null = SESSION_A) {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", script)], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: hookEnv(root, sessionId),
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

/** Run an installed CLI with argv (no stdin) — the scripts that resolve from the env var alone. */
function cli(root: string, script: string, args: string[], sessionId: string | null = SESSION_A) {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", script), ...args], {
    encoding: "utf8",
    env: hookEnv(root, sessionId),
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const sessionsRoot = (root: string) => path.join(root, ".claude", "maestro_sessions");
const sessionDir = (root: string, id: string) => path.join(sessionsRoot(root), id);
const logFile = (root: string, id: string) => path.join(sessionDir(root, id), "log.jsonl");
const stateFile = (root: string, id: string) => path.join(sessionDir(root, id), "session.json");
const tasksFile = (root: string, id: string) => path.join(sessionDir(root, id), "tasks.json");

function readLog(root: string, id: string): Record<string, unknown>[] {
  return fs
    .readFileSync(logFile(root, id), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const toolCall = (root: string, file: string) => ({
  cwd: root,
  hook_event_name: "PreToolUse",
  tool_name: "Read",
  tool_input: { file_path: file },
});

const subagentStop = (root: string, agentType: string, agentId: string) => ({
  cwd: root,
  hook_event_name: "SubagentStop",
  agent_type: agentType,
  agent_id: agentId,
  last_assistant_message: "HANDOFF: success",
});

// ── resolution ─────────────────────────────────────────────────────────────

describe("session-id resolution, through the installed hooks (064)", () => {
  it("prefers the payload's session_id over CLAUDE_CODE_SESSION_ID", async () => {
    const root = await installed();

    // The payload says A; the environment says B. A subagent's hook payload carries the MAIN
    // session's id, which is why the payload is the authoritative source.
    const run = hook(
      root,
      "maestro-session-log.cjs",
      { ...toolCall(root, "src/a.ts"), session_id: SESSION_A },
      SESSION_B
    );

    expect(run.code).toBe(0);
    expect(readLog(root, SESSION_A)).toHaveLength(1);
    expect(fs.existsSync(sessionDir(root, SESSION_B))).toBe(false);
  });

  it("uses CLAUDE_CODE_SESSION_ID when the payload carries no session_id", async () => {
    const root = await installed();

    const run = hook(root, "maestro-session-log.cjs", toolCall(root, "src/a.ts"), SESSION_B);

    expect(run.code).toBe(0);
    expect(readLog(root, SESSION_B)[0]).toMatchObject({ origin: "main_session", log: "Read(src/a.ts)" });
    expect(fs.existsSync(sessionDir(root, SESSION_A))).toBe(false);
  });

  it("writes nothing and throws nothing when neither source resolves an id", async () => {
    const root = await installed();

    const log = hook(root, "maestro-session-log.cjs", toolCall(root, "src/a.ts"), null);
    const stop = hook(root, "maestro-subagent-log.cjs", subagentStop(root, "backend", "a1"), null);
    const end = hook(root, "maestro-session-cleanup.cjs", { cwd: root }, null);

    for (const [label, run] of [
      ["PreToolUse", log],
      ["SubagentStop", stop],
      ["SessionEnd", end],
    ] as const) {
      expect(run.code, `${label} must exit 0`).toBe(0);
    }
    // Not even the sessions root: nothing attributable, nothing written.
    expect(fs.existsSync(sessionsRoot(root))).toBe(false);
  });

  // "Validated, never sanitised": a sanitised id could collide with a REAL session's directory,
  // which is worse than not writing. Each id below is handed in on the payload while the
  // environment holds a perfectly good one, so the assertion covers both halves at once — the bad
  // id creates nothing, AND it does not silently fall through to the environment's session.
  it.each([
    ["parent traversal", ".."],
    ["a posix separator", "sub/dir"],
    ["a windows separator", "sub\\dir"],
    ["an absolute path", "/etc/passwd"],
    ["the empty string", ""],
    ["over 128 characters", "a".repeat(129)],
  ])("rejects %s rather than sanitising it, creating nothing on disk", async (_label, badId) => {
    const root = await installed();

    const run = hook(root, "maestro-session-log.cjs", { ...toolCall(root, "src/a.ts"), session_id: badId }, SESSION_B);

    expect(run.code).toBe(0);
    expect(run.stderr).toBe("");
    expect(fs.existsSync(sessionsRoot(root))).toBe(false);
    // Nothing escaped the project either — the pattern excludes `.`, `/` and `\` outright, so no
    // path is ever built from a rejected id.
    expect(fs.existsSync(path.join(root, ".claude", "log.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(root, "log.jsonl"))).toBe(false);
  });
});

// ── independence ───────────────────────────────────────────────────────────

describe("two concurrent sessions against one project (064)", () => {
  it("keep independent logs, run_ids, active workflows and task coverage", async () => {
    const root = await installed();

    // Each session logs its own tool calls.
    hook(root, "maestro-session-log.cjs", toolCall(root, "a1.ts"), SESSION_A);
    hook(root, "maestro-session-log.cjs", toolCall(root, "b1.ts"), SESSION_B);
    hook(root, "maestro-session-log.cjs", toolCall(root, "a2.ts"), SESSION_A);

    expect(readLog(root, SESSION_A).map((e) => e.log)).toEqual(["Read(a1.ts)", "Read(a2.ts)"]);
    expect(readLog(root, SESSION_B).map((e) => e.log)).toEqual(["Read(b1.ts)"]);

    // Each session mints its OWN run_id — before `064` both stamped channel files with one shared
    // id, so a delivery from one run looked current to the other.
    hook(root, "maestro-subagent-log.cjs", subagentStop(root, "backend", "a1"), SESSION_A);
    hook(root, "maestro-subagent-log.cjs", subagentStop(root, "backend", "b1"), SESSION_B);
    const runA = JSON.parse(fs.readFileSync(stateFile(root, SESSION_A), "utf8")).run_id;
    const runB = JSON.parse(fs.readFileSync(stateFile(root, SESSION_B), "utf8")).run_id;
    expect(runA).toBeTruthy();
    expect(runB).toBeTruthy();
    expect(runA).not.toBe(runB);

    // Each session's active workflow is its own: B's set does not overwrite A's, which is what
    // used to make A's next SubagentStart inject B's workflow's skills.
    expect(cli(root, "maestro-set-session-workflow.cjs", ["default"], SESSION_A).code).toBe(0);
    expect(cli(root, "maestro-set-session-workflow.cjs", ["some-other-workflow"], SESSION_B).code).toBe(0);
    expect(JSON.parse(fs.readFileSync(stateFile(root, SESSION_A), "utf8")).workflow).toBe("default");
    expect(JSON.parse(fs.readFileSync(stateFile(root, SESSION_B), "utf8")).workflow).toBe("some-other-workflow");
    // ...and setting B's workflow did not disturb A's run_id either.
    expect(JSON.parse(fs.readFileSync(stateFile(root, SESSION_A), "utf8")).run_id).toBe(runA);
  });

  it("keep independent TaskCreate coverage ledgers", async () => {
    const root = await installed();

    // Both sessions run the same workflow — so the ONLY thing separating their ledgers is the
    // per-session routing. Sharing one tasks.json used to make A's coverage read as B's.
    for (const id of [SESSION_A, SESSION_B]) {
      expect(cli(root, "maestro-set-session-workflow.cjs", ["default"], id).code).toBe(0);
    }

    const taskCreate = (step: string) => ({
      cwd: root,
      hook_event_name: "PostToolUse",
      tool_name: "TaskCreate",
      tool_input: { subject: step, description: "", metadata: { maestro_step: step } },
    });

    expect(hook(root, "maestro-validate-tasks.cjs", taskCreate("@backend"), SESSION_A).code).toBe(0);
    expect(hook(root, "maestro-validate-tasks.cjs", taskCreate("@backend"), SESSION_B).code).toBe(0);
    expect(hook(root, "maestro-validate-tasks.cjs", taskCreate("@test"), SESSION_B).code).toBe(0);

    expect(JSON.parse(fs.readFileSync(tasksFile(root, SESSION_A), "utf8")).steps).toEqual(["@backend"]);
    expect(JSON.parse(fs.readFileSync(tasksFile(root, SESSION_B), "utf8")).steps).toEqual(["@backend", "@test"]);
  });

  it("SessionEnd for one session leaves its sibling entirely untouched", async () => {
    const root = await installed();

    hook(root, "maestro-session-log.cjs", toolCall(root, "a1.ts"), SESSION_A);
    hook(root, "maestro-subagent-log.cjs", subagentStop(root, "backend", "a1"), SESSION_A);
    hook(root, "maestro-session-log.cjs", toolCall(root, "b1.ts"), SESSION_B);
    hook(root, "maestro-subagent-log.cjs", subagentStop(root, "backend", "b1"), SESSION_B);
    const runB = JSON.parse(fs.readFileSync(stateFile(root, SESSION_B), "utf8")).run_id;

    const end = hook(root, "maestro-session-cleanup.cjs", { cwd: root, session_id: SESSION_A }, SESSION_B);
    expect(end.code).toBe(0);

    expect(fs.existsSync(sessionDir(root, SESSION_A))).toBe(false);
    // B's log is neither deleted nor truncated, and its run_id survives.
    expect(readLog(root, SESSION_B).map((e) => e.log)).toContain("Read(b1.ts)");
    expect(JSON.parse(fs.readFileSync(stateFile(root, SESSION_B), "utf8")).run_id).toBe(runB);
    // The user's config and the sessions root's own .gitignore survive too.
    expect(fs.existsSync(path.join(root, ".claude", "maestro.json"))).toBe(true);
    expect(fs.existsSync(path.join(sessionsRoot(root), ".gitignore"))).toBe(true);
  });

  it("SessionEnd also clears the three pre-064 flat files an older runtime left behind", async () => {
    const root = await installed();
    hook(root, "maestro-session-log.cjs", toolCall(root, "a1.ts"), SESSION_A);

    const legacy = ["maestro_session.json", "maestro_session.log.jsonl", "maestro_session_tasks.json"];
    for (const name of legacy) fs.writeFileSync(path.join(root, ".claude", name), "stale\n");

    expect(hook(root, "maestro-session-cleanup.cjs", { cwd: root }, SESSION_A).code).toBe(0);

    for (const name of legacy) expect(fs.existsSync(path.join(root, ".claude", name)), name).toBe(false);
  });

  // The bash twin, run from the PLUGIN — it is what fires for a project with no local install, and
  // it parses the payload with python3 rather than node. Both twins call the same
  // `removeSessionState`, so the thing worth pinning is that the .sh actually gets the id through:
  // a shell that dropped it would silently remove nothing (or, before `064`, everything).
  it("the plugin's SessionEnd shell twin also removes only the ending session's directory", async () => {
    const root = await installed();
    hook(root, "maestro-session-log.cjs", toolCall(root, "a1.ts"), SESSION_A);
    hook(root, "maestro-session-log.cjs", toolCall(root, "b1.ts"), SESSION_B);

    const res = spawnSync("bash", [path.join(PLUGIN_ROOT, "scripts", "maestro-session-cleanup.sh")], {
      input: JSON.stringify({ cwd: root, session_id: SESSION_A }),
      encoding: "utf8",
      env: hookEnv(root, SESSION_B),
    });

    expect(res.status).toBe(0);
    expect(fs.existsSync(sessionDir(root, SESSION_A))).toBe(false);
    expect(readLog(root, SESSION_B).map((e) => e.log)).toEqual(["Read(b1.ts)"]);
  });

  it("the plugin's SessionEnd shell twin removes nothing when no session id resolves", async () => {
    const root = await installed();
    hook(root, "maestro-session-log.cjs", toolCall(root, "a1.ts"), SESSION_A);

    const res = spawnSync("bash", [path.join(PLUGIN_ROOT, "scripts", "maestro-session-cleanup.sh")], {
      input: JSON.stringify({ cwd: root }),
      encoding: "utf8",
      env: hookEnv(root, null),
    });

    expect(res.status).toBe(0);
    expect(readLog(root, SESSION_A).map((e) => e.log)).toEqual(["Read(a1.ts)"]);
  });
});

// ── resume ─────────────────────────────────────────────────────────────────

describe("maestro-resume-target.cjs never crosses sessions (064)", () => {
  it("does not return a sibling session's agent_id for the same agent type", async () => {
    const root = await installed();

    // Session B completes a run of `backend`. Before `064` this entry sat in the ONE shared log,
    // so a condition-edge loop-back in session A would resolve it and `SendMessage` into a foreign
    // session's agent — corrupt and silent.
    hook(root, "maestro-subagent-log.cjs", subagentStop(root, "backend", "foreign-b1"), SESSION_B);
    expect(readLog(root, SESSION_B).some((e) => e.kind === "handoff")).toBe(true);

    // Session A has no completed run of its own: the only safe answer is nothing (a cold `Task`).
    const cold = cli(root, "maestro-resume-target.cjs", ["backend"], SESSION_A);
    expect(cold.code).toBe(0);
    expect(cold.stdout).toBe("");
    expect(cold.stdout).not.toContain("foreign-b1");

    // Once A completes its own run it resolves that one, and still never B's.
    hook(root, "maestro-subagent-log.cjs", subagentStop(root, "backend", "mine-a1"), SESSION_A);
    const warm = cli(root, "maestro-resume-target.cjs", ["backend"], SESSION_A);
    expect(warm.code).toBe(0);
    expect(warm.stdout.trim()).toBe("mine-a1");

    // ...and B still resolves only its own.
    expect(cli(root, "maestro-resume-target.cjs", ["backend"], SESSION_B).stdout.trim()).toBe("foreign-b1");
  });

  it("prints nothing and exits 0 when no session id resolves at all", async () => {
    const root = await installed();
    hook(root, "maestro-subagent-log.cjs", subagentStop(root, "backend", "a1"), SESSION_A);

    const run = cli(root, "maestro-resume-target.cjs", ["backend"], null);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("");
  });
});

// ── the two gate scripts ───────────────────────────────────────────────────
//
// These run via `!`command`` substitution inside the orchestrator skill body. An injected command
// that exits non-zero ABORTS the whole invocation, so the one-line-stdout / empty-stderr / exit-0
// contract is load-bearing and `064`'s new phase write must not have touched any clause of it.

describe("the Step 1 / Step 4 gate scripts keep their contract while writing a phase marker (064)", () => {
  const GATES = [
    ["maestro-step1-gates.cjs", "step1_gates"],
    ["maestro-step4-gate.cjs", "step4_task_routing"],
  ] as const;

  it.each(GATES)("%s prints exactly one line, says nothing on stderr and exits 0 with a session", async (script) => {
    const root = await installed();
    const run = cli(root, script, [], SESSION_A);

    expect(run.code).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout.endsWith("\n")).toBe(true);
    expect(run.stdout.trimEnd().split("\n")).toHaveLength(1);
  });

  it.each(GATES)("%s keeps that contract with NO session id resolvable, and writes nothing", async (script) => {
    const root = await installed();
    const run = cli(root, script, [], null);

    expect(run.code).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout.trimEnd().split("\n")).toHaveLength(1);
    // The marker is skipped, not written somewhere arbitrary — the previously accepted limitation,
    // now the fallback rather than the normal path.
    expect(fs.existsSync(sessionsRoot(root))).toBe(false);
  });

  it.each(GATES)('%s writes its kind:"phase" marker into the resolving session\'s log', async (script, phase) => {
    const root = await installed();

    expect(cli(root, script, [], SESSION_A).code).toBe(0);

    const marker = readLog(root, SESSION_A).find((e) => e.kind === "phase");
    expect(marker).toMatchObject({ origin: "main_session", kind: "phase", phase });
    // No ctx_pct/ctx_model: that needs transcript_path, which the env var cannot give.
    expect(marker).not.toHaveProperty("ctx_pct");
    expect(marker).not.toHaveProperty("ctx_model");
    // And nowhere else.
    expect(fs.existsSync(sessionDir(root, SESSION_B))).toBe(false);
  });

  it.each(GATES)("%s keeps the contract when maestro.json itself is missing", async (script) => {
    const root = await installed();
    fs.rmSync(path.join(root, ".claude", "maestro.json"));

    const run = cli(root, script, [], SESSION_A);
    expect(run.code).toBe(0);
    expect(run.stderr).toBe("");
    expect(run.stdout.trimEnd().split("\n")).toHaveLength(1);
  });
});

// ── the .gitignore mechanism ───────────────────────────────────────────────

describe("maestro_sessions/ is git-ignored without a re-install (064)", () => {
  /** `git check-ignore` exits 0 when the path is ignored — git's own answer, not a regex on ours. */
  function ignored(root: string, relPath: string): boolean {
    return spawnSync("git", ["check-ignore", "-q", "--", relPath], { cwd: root }).status === 0;
  }

  it("in a project installed BEFORE 064 that has not been re-installed since", async () => {
    const root = await installed();

    // Rewind the project to a pre-`064` install: the root .gitignore is only ever APPENDED to at
    // install time, so a project installed before this shipped has the three flat names and no
    // `maestro_sessions/` entry — and nothing would ever add one until someone re-installed.
    const gitignore = path.join(root, ".gitignore");
    const before = fs
      .readFileSync(gitignore, "utf8")
      .split("\n")
      .filter((l) => !l.includes("maestro_sessions"))
      .join("\n");
    fs.writeFileSync(gitignore, before);
    expect(before).not.toContain("maestro_sessions");
    expect(ignored(root, ".claude/maestro_sessions/x/log.jsonl")).toBe(false);

    // A hook fires. Creating the directory is what writes the `*` .gitignore inside it — no
    // re-install, no manifest entry, no appended root rule.
    expect(hook(root, "maestro-session-log.cjs", toolCall(root, "src/a.ts"), SESSION_A).code).toBe(0);

    expect(fs.readFileSync(path.join(sessionsRoot(root), ".gitignore"), "utf8")).toBe("*\n");
    expect(ignored(root, ".claude/maestro_sessions/" + SESSION_A + "/log.jsonl")).toBe(true);
    expect(ignored(root, ".claude/maestro_sessions/" + SESSION_A + "/session.json")).toBe(true);
    // `*` ignores the .gitignore itself, so the mechanism leaves no tracked file behind.
    expect(ignored(root, ".claude/maestro_sessions/.gitignore")).toBe(true);
    // The project's own .gitignore was not touched by the hook.
    expect(fs.readFileSync(gitignore, "utf8")).toBe(before);

    // git agrees there is nothing new to commit under .claude/.
    const status = spawnSync("git", ["status", "--porcelain", "--", ".claude"], { cwd: root, encoding: "utf8" });
    expect(status.stdout).not.toContain("maestro_sessions");
  });

  it("and in a project installed after it, from the manifest entry as well", async () => {
    const root = await installed();
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).toContain("**/.claude/maestro_sessions/");
    expect(ignored(root, ".claude/maestro_sessions/x/log.jsonl")).toBe(true);
  });
});
