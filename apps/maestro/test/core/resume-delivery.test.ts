// `088` through the REAL installed scripts: a loop-back payload handed to a RESUMED agent by path
// (`maestro-resume-target.cjs` prints `deliver:` lines; SubagentStart on a resume neither inlines nor
// retires; the resumed run's own SubagentStop retires the file and logs `channel_delivery` with
// `via:"resume"`), and a loop-back whose expected payload is missing being printed as `missing:` and
// recorded as a `missing_payload` issue `handoff-issues` reports — resumed or cold. Temp projects, a
// temp HOME, nothing mocked; CLAUDE_CODE_SESSION_ID always pinned (never inherited).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { pinnedEnv } from "../helpers/env.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

vi.setConfig({ testTimeout: 30_000 });

const SESS = "sess-088-aaa";
/** `144`: SESS claims task 088 (see installed()), so its lanes live under `task-088`. */
const SCOPE = "task-088";
const BACKEND_LANE_FILE = `.claude/channels/${SCOPE}/backend/test.1.md`;

// main -> backend -> test -> scribe, and test -> backend on "tests failed" (the loop-back). Both
// backend/test and test/backend resolve a seeded protocol, so each expects a payload.
const cfg = {
  version: 3,
  agents_available: ["backend", "test", "scribe"],
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
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-088-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function script(root: string, name: string, args: string[], input?: unknown, sess = SESS) {
  const r = spawnSync("node", [path.join(root, ".claude", "scripts", name), ...args], {
    encoding: "utf8",
    env: pinnedEnv(home, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: sess }),
    ...(input !== undefined ? { input: JSON.stringify(input) } : {}),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const sessionDir = (root: string) => path.join(root, ".claude", "maestro_sessions", SESS);
const readState = (root: string) => JSON.parse(fs.readFileSync(path.join(sessionDir(root), "session.json"), "utf8"));
const readLog = (root: string): Record<string, any>[] => {
  const f = path.join(sessionDir(root), "log.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
};
const abs = (root: string, rel: string) => path.join(root, ...rel.split("/"));
const consumed = (root: string, receiver: string, file: string) =>
  path.join(root, ".claude", "channels", SCOPE, ".consumed", receiver, file);
function writePayload(root: string, receiver: string, sender: string, body: string, scope: string | null = SCOPE) {
  const f = path.join(root, ".claude", "channels", ...(scope ? [scope] : []), receiver, `${sender}.1.md`);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, body);
}

async function installed(): Promise<string> {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeConfig(root, cfg);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  claim(root, SESS, "088-loop-back.md");
  return root;
}

/** The orchestrator's run start: record the workflow and the claimed task (`144`). */
function claim(root: string, sess: string, task: string) {
  const r = script(root, "maestro-set-session-workflow.cjs", ["feature", "--task", task], undefined, sess);
  expect(r.code, r.stderr).toBe(0);
}

// Both SubagentStart hooks, in the order Claude Code registers them; returns the injected context.
function start(root: string, agent: string, id: string, sess = SESS): string {
  const payload = { cwd: root, session_id: sess, hook_event_name: "SubagentStart", agent_type: agent, agent_id: id };
  const log = script(root, "maestro-subagent-log.cjs", [], payload, sess);
  expect(log.code, log.stderr).toBe(0);
  const inj = script(root, "maestro-inject-agent-context.cjs", [], payload, sess);
  expect(inj.code, inj.stderr).toBe(0);
  return inj.stdout.trim() ? (JSON.parse(inj.stdout).hookSpecificOutput.additionalContext as string) : "";
}

function stop(root: string, agent: string, id: string, message: string, sess = SESS) {
  const r = script(
    root,
    "maestro-subagent-log.cjs",
    [],
    {
      cwd: root,
      session_id: sess,
      hook_event_name: "SubagentStop",
      agent_type: agent,
      agent_id: id,
      last_assistant_message: message,
    },
    sess
  );
  expect(r.code, r.stderr).toBe(0);
  return r;
}

const resumeTarget = (root: string, agent: string, sess = SESS) => {
  const r = script(root, "maestro-resume-target.cjs", [agent], undefined, sess);
  expect(r.code, r.stderr).toBe(0);
  return r.stdout.split("\n").filter(Boolean);
};
const handoffIssues = (root: string) => script(root, "maestro-task-status.cjs", ["handoff-issues"]).stdout;

/** backend b1 succeeds with its payload; test t1 (cold) fails back to backend, writing `testBody` if given. */
function runUpToLoopBack(root: string, testBody: string | null) {
  start(root, "backend", "b1");
  writePayload(root, "test", "backend", '{"behaviors_to_test":["x"]}\n');
  stop(root, "backend", "b1", '"verdict": "SUCCESS"\nHANDOFF: success');
  start(root, "test", "t1");
  if (testBody !== null) writePayload(root, "backend", "test", testBody);
  stop(root, "test", "t1", '"verdict": "FAIL"\nHANDOFF: tests failed');
}

describe("a loop-back payload is delivered to a RESUMED agent by path (088)", () => {
  it("resume-target prints deliver:, the file survives the resumed SubagentStart, and its SubagentStop retires and logs it", async () => {
    const root = await installed();
    runUpToLoopBack(root, '{"failures":["RESUME-PAYLOAD-BODY"]}\n');
    expect(fs.existsSync(abs(root, BACKEND_LANE_FILE))).toBe(true);

    // 1. The orchestrator asks whom to resume: the id, then the path to name in its SendMessage.
    const out = resumeTarget(root, "backend");
    expect(out).toEqual(["b1", `deliver: ${BACKEND_LANE_FILE}`]);
    expect(out.some((l) => l.startsWith("missing:"))).toBe(false);
    expect(readState(root).resume_deliveries).toEqual({
      b1: [{ file: BACKEND_LANE_FILE, sender: "test", run_id: readState(root).run_id }],
    });
    expect(readState(root).handoff_issues).toBeUndefined();

    // 2. The resume's SubagentStart: listed by path, never inlined, never retired, never logged.
    const deliveriesBefore = readLog(root).filter((e) => e.kind === "channel_delivery" && e.agent_id === "b1").length;
    const ctx = start(root, "backend", "b1");
    expect(ctx).toContain("Resumed run");
    expect(ctx).toContain(`\`${BACKEND_LANE_FILE}\``);
    expect(ctx).not.toContain("RESUME-PAYLOAD-BODY");
    expect(ctx).not.toContain("inlined verbatim");
    expect(fs.existsSync(abs(root, BACKEND_LANE_FILE))).toBe(true);
    expect(fs.existsSync(consumed(root, "backend", "test.1.md"))).toBe(false);
    expect(readLog(root).filter((e) => e.kind === "channel_delivery" && e.agent_id === "b1")).toHaveLength(
      deliveriesBefore
    );
    expect(readState(root).resume_deliveries?.b1).toHaveLength(1);

    // 3. The resumed run ends: retired to .consumed/, logged via:"resume" just before its handoff.
    writePayload(root, "test", "backend", '{"behaviors_to_test":["y"]}\n');
    stop(root, "backend", "b1", '"verdict": "SUCCESS"\nHANDOFF: success');
    expect(fs.existsSync(abs(root, BACKEND_LANE_FILE))).toBe(false);
    expect(fs.existsSync(consumed(root, "backend", "test.1.md"))).toBe(true);

    const log = readLog(root);
    const lastHandoff = log
      .map((e, i) => ({ e, i }))
      .filter(({ e }) => e.kind === "handoff" && e.agent_id === "b1")
      .pop()!;
    const prev = log[lastHandoff.i - 1];
    expect(prev).toMatchObject({
      origin: "main_session",
      kind: "channel_delivery",
      sender: "test",
      receiver: "backend",
      agent_id: "b1",
      via: "resume",
    });
    expect(prev.content).toContain("RESUME-PAYLOAD-BODY");
    expect(prev.content).not.toContain("maestro:run_id");
    expect(lastHandoff.e.status).toBe("success");
    expect(lastHandoff.e.handoff_issue).toBeUndefined();

    expect(readState(root).resume_deliveries).toBeUndefined();
    expect(handoffIssues(root)).toContain("no problems recorded");
  });

  it("a cold start still inlines and retires at SubagentStart, with no via on its delivery", async () => {
    const root = await installed();
    start(root, "backend", "b1");
    writePayload(root, "test", "backend", '{"behaviors_to_test":["COLD-BODY"]}\n');
    stop(root, "backend", "b1", "HANDOFF: success");
    const ctx = start(root, "test", "t1");
    expect(ctx).toContain("COLD-BODY");
    expect(fs.existsSync(consumed(root, "test", "backend.1.md"))).toBe(true);
    const d = readLog(root).find((e) => e.kind === "channel_delivery" && e.agent_id === "t1")!;
    expect(d).toBeDefined();
    expect("via" in d).toBe(false);
  });

  it("a resumed run with nothing recorded retires nothing and leaves an unrelated lane file alone", async () => {
    const root = await installed();
    runUpToLoopBack(root, '{"failures":["x"]}\n');
    // The resume happens without asking resume-target (no record): SubagentStop must not retire.
    start(root, "backend", "b1");
    writePayload(root, "test", "backend", "{}\n");
    stop(root, "backend", "b1", "HANDOFF: success");
    expect(fs.existsSync(abs(root, BACKEND_LANE_FILE))).toBe(true);
    expect(readLog(root).some((e) => e.kind === "channel_delivery" && e.via === "resume")).toBe(false);
  });
});

describe("a loop-back's missing payload is printed and recorded (088)", () => {
  it("resumed target: the file was removed before the resume (085's shape) — missing:, issue, reported once", async () => {
    const root = await installed();
    runUpToLoopBack(root, '{"failures":["x"]}\n');
    expect(handoffIssues(root)).toContain("no problems recorded"); // test DID write it — 087's stop check passes
    fs.rmSync(abs(root, BACKEND_LANE_FILE));

    const out = resumeTarget(root, "backend");
    expect(out).toEqual(["b1", `missing: ${BACKEND_LANE_FILE} (from test)`]);
    expect(readState(root).resume_deliveries).toBeUndefined();
    const issues = readState(root).handoff_issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      kind: "missing_payload",
      agent: "test",
      agent_id: "t1",
      label: "tests failed",
      files: [BACKEND_LANE_FILE],
    });

    // A repeat call prints it again but does not record it twice.
    expect(resumeTarget(root, "backend")).toEqual(["b1", `missing: ${BACKEND_LANE_FILE} (from test)`]);
    expect(readState(root).handoff_issues).toHaveLength(1);

    const seen = handoffIssues(root);
    expect(seen).toContain("1 problem(s)");
    expect(seen).toContain("test: NO PAYLOAD written for HANDOFF: tests failed (agent_id t1)");
    expect(seen).toContain(BACKEND_LANE_FILE);
    expect(readState(root).handoff_issues).toBeUndefined(); // read-and-cleared
  });

  it("cold target (no agent_id): only missing: is printed, and the issue is recorded and reported once", async () => {
    const root = await installed();
    // test runs with no prior backend run, so nothing to resume; it never writes its payload.
    start(root, "test", "t1");
    const r = stop(root, "test", "t1", '"verdict": "FAIL"\nHANDOFF: tests failed');
    expect(r.stdout).toContain("missing_payload"); // 087's stop-time check
    handoffIssues(root); // the orchestrator read (and cleared) that one, then routes anyway

    const out = resumeTarget(root, "backend");
    expect(out).toEqual([`missing: ${BACKEND_LANE_FILE} (from test)`]);
    expect(out[0]).not.toMatch(/^[\w-]+$/); // first line is not a bare id ⇒ cold Task
    expect(readState(root).handoff_issues).toHaveLength(1);
    expect(readState(root).handoff_issues[0]).toMatchObject({ kind: "missing_payload", agent_id: "t1" });

    resumeTarget(root, "backend");
    expect(readState(root).handoff_issues).toHaveLength(1);

    const seen = handoffIssues(root);
    expect(seen).toContain("1 problem(s)");
    expect(seen).toContain("test: NO PAYLOAD written for HANDOFF: tests failed (agent_id t1)");
  });

  it("a missing payload the sender writes afterwards is dropped on the next call, not reported", async () => {
    const root = await installed();
    runUpToLoopBack(root, '{"failures":["x"]}\n');
    handoffIssues(root);
    fs.rmSync(abs(root, BACKEND_LANE_FILE));
    expect(resumeTarget(root, "backend")).toEqual(["b1", `missing: ${BACKEND_LANE_FILE} (from test)`]);
    expect(readState(root).handoff_issues).toHaveLength(1);

    // The orchestrator resumes test to write it (its SubagentStop stamps the file), then asks again.
    start(root, "test", "t1");
    writePayload(root, "backend", "test", '{"failures":["x"]}\n');
    stop(root, "test", "t1", '"verdict": "FAIL"\nHANDOFF: tests failed');
    expect(resumeTarget(root, "backend")).toEqual(["b1", `deliver: ${BACKEND_LANE_FILE}`]);
    expect(readState(root).handoff_issues).toBeUndefined();
    expect(handoffIssues(root)).toContain("no problems recorded");
  });

  // `144`: the 045/048 collision on the resume path. A second session on another task writes the
  // same `test -> backend` lane file name in ITS scope; this session's resume never names it.
  it("another task's same-named payload is never delivered: this session sees missing:, not deliver:", async () => {
    const root = await installed();
    const OTHER = "sess-099-bbb";
    claim(root, OTHER, "099-other.md");
    runUpToLoopBack(root, '{"failures":["x"]}\n');
    handoffIssues(root);
    fs.rmSync(abs(root, BACKEND_LANE_FILE));

    // The other session runs the same pair and leaves a stamped, same-named file in task-099.
    start(root, "test", "o1", OTHER);
    writePayload(root, "backend", "test", '{"failures":["OTHER-TASK-BODY"]}\n', "task-099");
    stop(root, "test", "o1", '"verdict": "FAIL"\nHANDOFF: tests failed', OTHER);
    const otherFile = ".claude/channels/task-099/backend/test.1.md";
    expect(fs.readFileSync(abs(root, otherFile), "utf8")).toMatch(/^<!-- maestro:run_id=/);

    const mine = resumeTarget(root, "backend");
    expect(mine).toEqual(["b1", `missing: ${BACKEND_LANE_FILE} (from test)`]);
    expect(mine.join("\n")).not.toContain("task-099");

    // This session's resumed backend SubagentStart never inlines the other task's body, nor retires it.
    expect(start(root, "backend", "b1")).not.toContain("OTHER-TASK-BODY");
    expect(fs.existsSync(abs(root, otherFile))).toBe(true);

    // The other session's target is cold (it never ran a backend) and its file is present, so
    // resume-target prints nothing; its cold SubagentStart inlines its own file and retires it
    // into ITS scope's .consumed/.
    expect(resumeTarget(root, "backend", OTHER)).toEqual([]);
    expect(start(root, "backend", "o2", OTHER)).toContain("OTHER-TASK-BODY");
    expect(fs.existsSync(abs(root, otherFile))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude", "channels", "task-099", ".consumed", "backend", "test.1.md"))).toBe(
      true
    );
    expect(fs.existsSync(consumed(root, "backend", "test.1.md"))).toBe(false);
  });

  it("a legacy unscoped payload is never resumed, delivered or retired (144)", async () => {
    const root = await installed();
    runUpToLoopBack(root, '{"failures":["x"]}\n');
    handoffIssues(root);
    fs.rmSync(abs(root, BACKEND_LANE_FILE));
    // A pre-144 file at the old unscoped path, stamped with THIS run's id — still not delivered.
    const legacy = ".claude/channels/backend/test.1.md";
    writePayload(root, "backend", "test", `<!-- maestro:run_id=${readState(root).run_id} -->\nLEGACY-BODY\n`, null);

    const out = resumeTarget(root, "backend");
    expect(out).toEqual(["b1", `missing: ${BACKEND_LANE_FILE} (from test)`]);
    expect(out.join("\n")).not.toContain(`deliver: ${legacy}`);
    const ctx = start(root, "backend", "b1");
    expect(ctx).not.toContain("LEGACY-BODY");
    stop(root, "backend", "b1", "HANDOFF: success");
    expect(fs.existsSync(abs(root, legacy))).toBe(true);
    expect(fs.existsSync(path.join(root, ".claude", "channels", ".consumed", "backend", "test.1.md"))).toBe(false);
  });

  it("asking for a target the latest handoff did not route to records nothing", async () => {
    const root = await installed();
    start(root, "test", "t1");
    stop(root, "test", "t1", '"verdict": "FAIL"\nHANDOFF: tests failed');
    handoffIssues(root);
    expect(resumeTarget(root, "scribe")).toEqual([]);
    expect(readState(root).handoff_issues).toBeUndefined();
  });
});
