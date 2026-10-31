// `144` end to end through the REAL installed hooks: the 045/048 collision. Two concurrent sessions
// on different tasks run the same sender/receiver pair — session A in the main checkout on task 045,
// session B in a git worktree on task 048 that shares the main checkout's `.claude/channels/` — and
// neither ever injects, resumes, sweeps, lists as pending or gap-acknowledges the other's file.
// Also: legacy unscoped files are stranded (never delivered, resumed or acked, aged out at 14 days),
// both write guards on the scoped layout, and a lone session still works end to end.
// Real git repos under os.tmpdir(), a temp HOME, nothing mocked; HOME and CLAUDE_CODE_SESSION_ID
// pinned on every spawn via pinnedEnv.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { pendingLanes, CHANNEL_AGE_CAP_MS } from "../../src/core/handoff-channels.js";
import { pinnedEnv } from "../helpers/env.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

vi.setConfig({ testTimeout: 60_000 });

const A = "sess-045-aaa"; // main checkout, task 045
const B = "sess-048-bbb"; // git worktree, task 048
const A_TASK = "045-absorb.md";
const B_TASK = "048-deps-dir.md";
const A_SCOPE = "task-045";
const B_SCOPE = "task-048";
const DAY = 24 * 60 * 60 * 1000;

// main -> backend -> test -> scribe, test -> backend on "tests failed" (the loop-back).
const cfg = {
  version: 3,
  agents_available: ["backend", "test", "scribe", "reviewer"],
  skills_available: [],
  workflow_instances: [
    { name: "backend", agent: "backend", loaded_skills: [], referenced_skills: [] },
    { name: "test", agent: "test", loaded_skills: [], referenced_skills: [] },
    { name: "scribe", agent: "scribe", loaded_skills: [], referenced_skills: [] },
  ],
  workflows: [
    {
      name: "feature",
      nodes: [
        { id: "backend", type: "agent", instance: "backend", position: { x: 0, y: 100 } },
        { id: "test", type: "agent", instance: "test", position: { x: 0, y: 200 } },
        { id: "scribe", type: "agent", instance: "scribe", position: { x: 0, y: 300 } },
      ],
      edges: [
        { from: "main-session", to: "backend", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
        { from: "backend", to: "test", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
        { from: "test", to: "scribe", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
        {
          from: "test",
          to: "backend",
          kind: "condition",
          label: "tests failed",
          sourceHandle: "right",
          targetHandle: "top",
        },
      ],
    },
  ],
  rules: [],
} as unknown as MaestroConfigV3;

let tmp: string;
let home: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-144-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Every hook runs with the main checkout as its project dir: a worktree session's shell starts there (`104`). */
function script(root: string, sess: string, name: string, args: string[], input?: unknown) {
  const r = spawnSync("node", [path.join(root, ".claude", "scripts", name), ...args], {
    encoding: "utf8",
    env: pinnedEnv(home, {
      CLAUDE_PROJECT_DIR: root,
      CLAUDE_CODE_SESSION_ID: sess,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    }),
    ...(input !== undefined ? { input: JSON.stringify(input) } : {}),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function ok(r: { code: number; stderr: string }) {
  expect(r.code, r.stderr).toBe(0);
  return r;
}

/** The orchestrator's Step 2: record the workflow and the claimed task. */
function recordTask(root: string, sess: string, task: string) {
  ok(script(root, sess, "maestro-set-session-workflow.cjs", ["feature", "--task", task]));
}

function liveSession(root: string, id: string) {
  const dir = path.join(root, ".claude", "maestro_sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "log.jsonl"), '{"kind":"tool_call"}\n');
}

async function repo(tasks: string[]): Promise<string> {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeConfig(root, cfg);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  fs.writeFileSync(path.join(root, "app.txt"), "main\n");
  fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
  for (const f of tasks)
    fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", f), `# ${f}\n\n## Blocked by\n\nNone\n`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

/** A on 045 in the main checkout; B on 048 in its own git worktree. Returns both roots. */
async function twoSessions(): Promise<{ root: string; wt: string }> {
  const root = await repo([A_TASK, B_TASK]);
  liveSession(root, A);
  liveSession(root, B);
  ok(script(root, A, "maestro-task-status.cjs", ["claim", A_TASK]));
  ok(script(root, B, "maestro-task-status.cjs", ["claim", B_TASK]));
  ok(script(root, B, "maestro-task-status.cjs", ["worktree", B_TASK]));
  recordTask(root, A, A_TASK);
  recordTask(root, B, B_TASK);
  const wt = path.join(path.dirname(root), `${path.basename(root)}-task-048`);
  expect(fs.existsSync(wt)).toBe(true);
  return { root, wt };
}

/** Both SubagentStart hooks in registration order; returns the injected context. */
function start(root: string, sess: string, agent: string, id: string): string {
  const payload = { cwd: root, session_id: sess, hook_event_name: "SubagentStart", agent_type: agent, agent_id: id };
  ok(script(root, sess, "maestro-subagent-log.cjs", [], payload));
  const inj = ok(script(root, sess, "maestro-inject-agent-context.cjs", [], payload));
  return inj.stdout.trim() ? (JSON.parse(inj.stdout).hookSpecificOutput.additionalContext as string) : "";
}

function stop(root: string, sess: string, agent: string, id: string, message: string) {
  ok(
    script(root, sess, "maestro-subagent-log.cjs", [], {
      cwd: root,
      session_id: sess,
      hook_event_name: "SubagentStop",
      agent_type: agent,
      agent_id: id,
      last_assistant_message: message,
    })
  );
}

function sessionEnd(root: string, sess: string) {
  ok(
    script(root, sess, "maestro-session-cleanup.cjs", [], {
      cwd: root,
      session_id: sess,
      hook_event_name: "SessionEnd",
      reason: "clear",
    })
  );
}

const resumeTarget = (root: string, sess: string, agent: string) =>
  ok(script(root, sess, "maestro-resume-target.cjs", [agent]))
    .stdout.split("\n")
    .filter(Boolean);

/** A PreToolUse Write through the installed channel/worktree write guard; true when denied. */
function denied(root: string, sess: string, agent: string | null, filePath: string): boolean {
  const r = ok(
    script(root, sess, "maestro-channel-write-guard.cjs", [], {
      cwd: root,
      session_id: sess,
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      tool_input: { file_path: filePath, content: "x" },
      ...(agent ? { agent_type: agent, agent_id: `${agent}-1` } : {}),
    })
  );
  if (!r.stdout.trim()) return false;
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision === "deny";
}

const ch = (root: string, ...parts: string[]) => path.join(root, ".claude", "channels", ...parts);
function put(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}
const read = (f: string) => fs.readFileSync(f, "utf8");
/** The session's run_id; a worktree session's state lives in the worktree (`074` pointer), so pass `wt`. */
const runIdOf = (root: string, sess: string, wt?: string): string =>
  JSON.parse(read(path.join(wt ?? root, ".claude", "maestro_sessions", sess, "session.json"))).run_id;
const stampOf = (f: string) => /^<!-- maestro:run_id=([^\s>]+) -->/.exec(read(f))?.[1] ?? null;
function age(file: string, ms: number) {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(file, t, t);
}
const gapBody = (token: string) =>
  "Skill gap report.\n\n```json\n" +
  JSON.stringify({ skill_gaps: [{ skill: "code-graph", missing: token }] }, null, 2) +
  "\n```\n";

/** backend runs in `sess` and writes its payload for test to the scoped lane; SubagentStop stamps it. */
function backendHandsToTest(root: string, sess: string, scope: string, id: string, body: string) {
  start(root, sess, "backend", id);
  put(ch(root, scope, "test", "backend.1.md"), body);
  stop(root, sess, "backend", id, '"verdict": "SUCCESS"\nHANDOFF: success');
}

describe("the 045/048 collision: a main-checkout session and a worktree session, same pair (144)", () => {
  it("each session's scope is its own claimed task, worktree included", async () => {
    const { root } = await twoSessions();
    const ctxA = start(root, A, "backend", "a-b0");
    const ctxB = start(root, B, "backend", "b-b0");
    expect(ctxA).toContain(`.claude/channels/${A_SCOPE}/`);
    expect(ctxA).not.toContain(B_SCOPE);
    expect(ctxB).toContain(`${root}/.claude/channels/${B_SCOPE}/`); // the worktree block names the main checkout's lane
    expect(ctxB).not.toContain(A_SCOPE);
  });

  it("inject: each @test is inlined only its own task's backend payload, stamped by its own run, retired in its own scope", async () => {
    const { root, wt } = await twoSessions();
    backendHandsToTest(root, A, A_SCOPE, "a-b1", '{"behaviors_to_test":["PAYLOAD-045"]}\n');
    backendHandsToTest(root, B, B_SCOPE, "b-b1", '{"behaviors_to_test":["PAYLOAD-048"]}\n');

    // Each SubagentStop stamped only its own scope's file, with its own run_id.
    const runA = runIdOf(root, A);
    const runB = runIdOf(root, B, wt);
    expect(runA).toBeTruthy();
    expect(runB).toBeTruthy();
    expect(runA).not.toBe(runB);
    expect(stampOf(ch(root, A_SCOPE, "test", "backend.1.md"))).toBe(runA);
    expect(stampOf(ch(root, B_SCOPE, "test", "backend.1.md"))).toBe(runB);

    // B's @test starts first (048 was the victim): it gets 048's payload, never 045's.
    const ctxB = start(root, B, "test", "b-t1");
    expect(ctxB).toContain("PAYLOAD-048");
    expect(ctxB).not.toContain("PAYLOAD-045");
    expect(fs.existsSync(ch(root, B_SCOPE, ".consumed", "test", "backend.1.md"))).toBe(true);
    // 045's payload is untouched by B's delivery.
    expect(fs.existsSync(ch(root, A_SCOPE, "test", "backend.1.md"))).toBe(true);

    const ctxA = start(root, A, "test", "a-t1");
    expect(ctxA).toContain("PAYLOAD-045");
    expect(ctxA).not.toContain("PAYLOAD-048");
    expect(fs.existsSync(ch(root, A_SCOPE, ".consumed", "test", "backend.1.md"))).toBe(true);
  });

  it("resume delivery: resume-target names only the asking session's own loop-back file", async () => {
    const { root } = await twoSessions();
    for (const [sess, scope, tag] of [
      [A, A_SCOPE, "045"],
      [B, B_SCOPE, "048"],
    ] as const) {
      backendHandsToTest(root, sess, scope, `${tag}-b1`, "{}\n");
      start(root, sess, "test", `${tag}-t1`);
      put(ch(root, scope, "backend", "test.1.md"), `{"failures":["FAIL-${tag}"]}\n`);
      stop(root, sess, "test", `${tag}-t1`, '"verdict": "FAIL"\nHANDOFF: tests failed');
    }

    expect(resumeTarget(root, A, "backend")).toEqual([
      "045-b1",
      `deliver: .claude/channels/${A_SCOPE}/backend/test.1.md`,
    ]);
    expect(resumeTarget(root, B, "backend")).toEqual([
      "048-b1",
      `deliver: .claude/channels/${B_SCOPE}/backend/test.1.md`,
    ]);

    // B's resumed backend ends: it retires only B's file; A's loop-back file is still waiting.
    start(root, B, "backend", "048-b1");
    stop(root, B, "backend", "048-b1", '"verdict": "SUCCESS"\nHANDOFF: success');
    expect(fs.existsSync(ch(root, B_SCOPE, ".consumed", "backend", "test.1.md"))).toBe(true);
    expect(fs.existsSync(ch(root, A_SCOPE, "backend", "test.1.md"))).toBe(true);
    expect(read(ch(root, A_SCOPE, "backend", "test.1.md"))).toContain("FAIL-045");
  });

  it("gap acknowledgement: each scribe sees only its task's gap, and an ack retires only its own", async () => {
    const { root } = await twoSessions();
    for (const [sess, scope, tag] of [
      [A, A_SCOPE, "045"],
      [B, B_SCOPE, "048"],
    ] as const) {
      start(root, sess, "backend", `${tag}-b1`);
      put(ch(root, scope, "scribe", "backend.1.md"), gapBody(`GAP-${tag}`));
      stop(root, sess, "backend", `${tag}-b1`, '"verdict": "SUCCESS"\nHANDOFF: success');
    }
    const gapFile = (scope: string) =>
      fs.readdirSync(ch(root, scope, "scribe")).find((f) => read(ch(root, scope, "scribe", f)).includes("GAP-"))!;
    const gapA = gapFile(A_SCOPE);
    const gapB = gapFile(B_SCOPE);

    const ctxB = start(root, B, "scribe", "048-s1");
    expect(ctxB).toContain("GAP-048");
    expect(ctxB).not.toContain("GAP-045");

    // B acknowledges — even naming the file A's gap also carries (same pair, same name).
    expect(gapA).toBe(gapB);
    stop(root, B, "scribe", "048-s1", `SKILL_GAPS_HANDLED: ${gapB}\nHANDOFF: success`);
    expect(fs.existsSync(ch(root, B_SCOPE, "scribe", gapB))).toBe(false);
    expect(fs.existsSync(ch(root, B_SCOPE, ".consumed", "scribe", gapB))).toBe(true);
    expect(fs.existsSync(ch(root, A_SCOPE, "scribe", gapA))).toBe(true);

    const ctxA = start(root, A, "scribe", "045-s1");
    expect(ctxA).toContain("GAP-045");
    expect(ctxA).not.toContain("GAP-048");
  });

  it("sweep: one session's SessionEnd retires only its own scope's .consumed; the other's in-flight lanes survive", async () => {
    const { root } = await twoSessions();
    backendHandsToTest(root, A, A_SCOPE, "a-b1", '{"x":"A"}\n');
    backendHandsToTest(root, B, B_SCOPE, "b-b1", '{"x":"B"}\n');
    start(root, A, "test", "a-t1");
    start(root, B, "test", "b-t1");
    // B's backend has already handed the next payload on, still unread.
    put(ch(root, B_SCOPE, "reviewer", "test.1.md"), "{}\n");

    sessionEnd(root, A);
    expect(fs.existsSync(ch(root, A_SCOPE, ".consumed", "test", "backend.1.md"))).toBe(false);
    expect(fs.existsSync(ch(root, B_SCOPE, ".consumed", "test", "backend.1.md"))).toBe(true);
    expect(fs.existsSync(ch(root, B_SCOPE, "reviewer", "test.1.md"))).toBe(true);
  });

  it("pending lanes: each scope lists only its own backlog; unfiltered lists both, each with its scope", async () => {
    const { root } = await twoSessions();
    backendHandsToTest(root, A, A_SCOPE, "a-b1", "{}\n");
    backendHandsToTest(root, B, B_SCOPE, "b-b1", "{}\n");

    const a = pendingLanes(root, Date.now(), { scope: A_SCOPE });
    expect(a).toEqual([
      expect.objectContaining({ scope: A_SCOPE, receiver: "test", count: 1, current: 1, stranded: 0 }),
    ]);
    const b = pendingLanes(root, Date.now(), { scope: B_SCOPE });
    expect(b).toEqual([expect.objectContaining({ scope: B_SCOPE, receiver: "test", count: 1, current: 1 })]);
    const all = pendingLanes(root)
      .map((l) => `${l.scope}/${l.receiver}`)
      .sort();
    expect(all).toEqual([`${A_SCOPE}/test`, `${B_SCOPE}/test`]);
  });
});

describe("legacy unscoped files are stranded (144)", () => {
  it("a this-run-stamped legacy payload is never inlined, resumed or retired, and is reported stranded", async () => {
    const root = await repo([A_TASK]);
    recordTask(root, A, A_TASK);
    start(root, A, "backend", "b0"); // mints the run_id
    const runId = runIdOf(root, A);
    const legacyTest = ch(root, "test", "backend.1.md");
    const legacyBackend = ch(root, "backend", "test.1.md");
    put(legacyTest, `<!-- maestro:run_id=${runId} -->\n{"x":"LEGACY-TEST"}\n`);
    put(legacyBackend, `<!-- maestro:run_id=${runId} -->\n{"x":"LEGACY-LOOP"}\n`);

    stop(root, A, "backend", "b0", "HANDOFF: success");
    const ctx = start(root, A, "test", "t1");
    expect(ctx).not.toContain("LEGACY-TEST");
    stop(root, A, "test", "t1", '"verdict": "FAIL"\nHANDOFF: tests failed');
    const out = resumeTarget(root, A, "backend");
    expect(out.join("\n")).not.toContain("LEGACY");
    expect(out.some((l) => l.startsWith("deliver:"))).toBe(false);
    expect(out).toContain(`missing: .claude/channels/${A_SCOPE}/backend/test.1.md (from test)`);

    expect(read(legacyTest)).toContain("LEGACY-TEST");
    expect(read(legacyBackend)).toContain("LEGACY-LOOP");
    expect(fs.existsSync(ch(root, ".consumed"))).toBe(false);

    const legacy = pendingLanes(root).filter((l) => l.scope === null);
    expect(legacy.map((l) => l.receiver).sort()).toEqual(["backend", "test"]);
    for (const l of legacy) expect(l).toMatchObject({ current: 0, stranded: l.count });
    expect(pendingLanes(root, Date.now(), { scope: A_SCOPE }).some((l) => l.scope === null)).toBe(false);
  });

  it("a legacy scribe gap is never inlined or acknowledged", async () => {
    const root = await repo([A_TASK]);
    recordTask(root, A, A_TASK);
    const legacyGap = ch(root, "scribe", "backend.1.md");
    put(legacyGap, gapBody("LEGACY-GAP"));
    const ctx = start(root, A, "scribe", "s1");
    expect(ctx).not.toContain("LEGACY-GAP");
    stop(root, A, "scribe", "s1", "SKILL_GAPS_HANDLED: backend.1.md\nHANDOFF: success");
    expect(read(legacyGap)).toContain("LEGACY-GAP");
    expect(fs.existsSync(ch(root, ".consumed", "scribe", "backend.1.md"))).toBe(false);
  });

  it("SessionEnd keeps legacy lane and .consumed files inside 14 days and ages both out past it", async () => {
    const root = await repo([A_TASK]);
    recordTask(root, A, A_TASK);
    const young = ch(root, "test", "young.1.md");
    const old = ch(root, "test", "backend.1.md");
    const youngConsumed = ch(root, ".consumed", "test", "young.1.md");
    const oldConsumed = ch(root, ".consumed", "test", "backend.1.md");
    for (const f of [young, old, youngConsumed, oldConsumed]) put(f, "{}\n");
    age(young, CHANNEL_AGE_CAP_MS - DAY);
    age(youngConsumed, CHANNEL_AGE_CAP_MS - DAY);
    age(old, CHANNEL_AGE_CAP_MS + DAY);
    age(oldConsumed, CHANNEL_AGE_CAP_MS + DAY);
    expect(CHANNEL_AGE_CAP_MS).toBe(14 * DAY);

    sessionEnd(root, A);
    expect(fs.existsSync(young)).toBe(true);
    expect(fs.existsSync(youngConsumed)).toBe(true); // no session owns the legacy .consumed outright
    expect(fs.existsSync(old)).toBe(false);
    expect(fs.existsSync(oldConsumed)).toBe(false);
  });
});

describe("write guards on the scoped layout (144)", () => {
  it("channel write guard (main checkout): the reviewer may write only its own scope", async () => {
    const root = await repo([A_TASK]);
    recordTask(root, A, A_TASK);
    expect(denied(root, A, "reviewer", ch(root, A_SCOPE, "refactor", "reviewer.1.md"))).toBe(false);
    expect(denied(root, A, "reviewer", `.claude/channels/${A_SCOPE}/backend/reviewer.1.md`)).toBe(false);
    expect(denied(root, A, "reviewer", ch(root, B_SCOPE, "refactor", "reviewer.1.md"))).toBe(true);
    expect(denied(root, A, "reviewer", ch(root, "session-sess-045", "refactor", "reviewer.1.md"))).toBe(true);
    expect(denied(root, A, "reviewer", ch(root, "refactor", "reviewer.1.md"))).toBe(true); // legacy root
    expect(denied(root, A, "reviewer", ch(root, "reviewer.1.md"))).toBe(true);
    expect(denied(root, A, "reviewer", path.join(root, "app.txt"))).toBe(true);
    expect(denied(root, A, "reviewer", path.join(tmp, "elsewhere.md"))).toBe(true);
  });

  it("channel write guard follows the worktree pointer: a worktree reviewer's own scope is its claimed task", async () => {
    const { root, wt } = await twoSessions();
    expect(denied(root, B, "reviewer", ch(root, B_SCOPE, "refactor", "reviewer.1.md"))).toBe(false);
    expect(denied(root, B, "reviewer", ch(root, A_SCOPE, "refactor", "reviewer.1.md"))).toBe(true);
    expect(denied(root, B, "reviewer", ch(root, "refactor", "reviewer.1.md"))).toBe(true);
    expect(denied(root, B, "reviewer", path.join(wt, "app.txt"))).toBe(true);
    // A's reviewer, conversely, may not write into 048's scope.
    expect(denied(root, A, "reviewer", ch(root, B_SCOPE, "refactor", "reviewer.1.md"))).toBe(true);
  });

  it("worktree write guard: a worktree backend may write its own scoped lane and the worktree, never main-checkout source", async () => {
    const { root, wt } = await twoSessions();
    expect(denied(root, B, "backend", ch(root, B_SCOPE, "test", "backend.1.md"))).toBe(false);
    expect(denied(root, B, null, ch(root, B_SCOPE, "test", "backend.1.md"))).toBe(false); // the orchestrator writing it (104)
    expect(denied(root, B, "backend", path.join(wt, "app.txt"))).toBe(false);
    expect(denied(root, B, "backend", path.join(root, "app.txt"))).toBe(true);
    expect(denied(root, B, "backend", path.join(root, ".claude", "scripts", "x.cjs"))).toBe(true);
    // A, in the main checkout, has no worktree: the guard never narrows it.
    expect(denied(root, A, "backend", path.join(root, "app.txt"))).toBe(false);
  });
});

describe("a single session with no peers still works end to end (144)", () => {
  it("no claimed task: session-<id8> scope; handoff, loop-back resume, run_id freshness and the 14-day sweep", async () => {
    const SOLO = "solo1234-uuid";
    const SCOPE = "session-solo1234";
    const root = await repo([]);
    ok(script(root, SOLO, "maestro-set-session-workflow.cjs", ["feature"]));

    // Handoff: backend -> test, inlined cold and retired in the session scope.
    const ctx0 = start(root, SOLO, "backend", "b1");
    expect(ctx0).toContain(`.claude/channels/${SCOPE}/`);
    put(ch(root, SCOPE, "test", "backend.1.md"), '{"x":"SOLO-PAYLOAD"}\n');
    stop(root, SOLO, "backend", "b1", '"verdict": "SUCCESS"\nHANDOFF: success');
    const runId = runIdOf(root, SOLO);
    expect(stampOf(ch(root, SCOPE, "test", "backend.1.md"))).toBe(runId);
    expect(start(root, SOLO, "test", "t1")).toContain("SOLO-PAYLOAD");
    expect(fs.existsSync(ch(root, SCOPE, ".consumed", "test", "backend.1.md"))).toBe(true);

    // run_id freshness: a stale-run file in the loop-back lane is not delivered on resume.
    put(ch(root, SCOPE, "backend", "test.1.md"), '<!-- maestro:run_id=run-OLD -->\n{"x":"STALE"}\n');
    stop(root, SOLO, "test", "t1", '"verdict": "FAIL"\nHANDOFF: tests failed');
    expect(resumeTarget(root, SOLO, "backend")).not.toContain(`deliver: .claude/channels/${SCOPE}/backend/test.1.md`);

    // A fresh this-run payload is.
    put(ch(root, SCOPE, "backend", "test.1.md"), '{"failures":["FRESH"]}\n');
    start(root, SOLO, "test", "t2");
    stop(root, SOLO, "test", "t2", '"verdict": "FAIL"\nHANDOFF: tests failed');
    expect(stampOf(ch(root, SCOPE, "backend", "test.1.md"))).toBe(runId);
    expect(resumeTarget(root, SOLO, "backend")).toEqual(["b1", `deliver: .claude/channels/${SCOPE}/backend/test.1.md`]);
    start(root, SOLO, "backend", "b1");
    stop(root, SOLO, "backend", "b1", '"verdict": "SUCCESS"\nHANDOFF: success');
    expect(fs.existsSync(ch(root, SCOPE, ".consumed", "backend", "test.1.md"))).toBe(true);

    // Sweep: own .consumed retired outright; an unread lane file kept in-cap and aged out past 14 days.
    const unread = ch(root, SCOPE, "scribe", "backend.1.md");
    const stale = ch(root, SCOPE, "reviewer", "test.1.md");
    put(unread, gapBody("SOLO-GAP"));
    put(stale, "{}\n");
    age(unread, CHANNEL_AGE_CAP_MS - DAY);
    age(stale, CHANNEL_AGE_CAP_MS + DAY);
    sessionEnd(root, SOLO);
    expect(fs.existsSync(ch(root, SCOPE, ".consumed", "test", "backend.1.md"))).toBe(false);
    expect(fs.existsSync(ch(root, SCOPE, ".consumed", "backend", "test.1.md"))).toBe(false);
    expect(fs.existsSync(unread)).toBe(true);
    expect(fs.existsSync(stale)).toBe(false);
  });
});
