// Team meeting owner runs (081, Part 3). After a meeting closes, its owner runs are dispatched with
// the plain Agent tool under the session's RECORDED workflow. Block 1 pins what the hooks do to such
// a run TODAY (routing + payload instructions + stamping + resume target). Block 2 is written for
// the contract of the fix and is expected to FAIL until it lands.
//
// Real scripts only: the plugin's hooks and CLIs from `plugins/maestro/scripts/` spawned against a
// temp project. HOME is pinned and CLAUDE_CODE_SESSION_ID is set per spawn, never inherited (`064`).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { agentRunsFromLog, resumeTarget } from "../../src/core/agent-runs.js";
import type { DecisionRecord, TallyRow } from "../../src/core/team-meeting.js";
import type { MaestroConfigV3, MaestroSession } from "../../src/core/types.js";

const PLUGIN_ROOT = findUpPluginRoot(path.dirname(new URL(import.meta.url).pathname))!;
const PLUGIN_SCRIPTS = path.join(PLUGIN_ROOT, "scripts");
const SESSION = "sess-owner-1";

const succ = (from: string, to: string) =>
  ({ from, to, kind: "success", sourceHandle: "bottom", targetHandle: "top" }) as const;
const cond = (from: string, to: string, label: string) =>
  ({ from, to, kind: "condition", label, sourceHandle: "right", targetHandle: "top" }) as const;

/** build: backend -> test (test loops back to backend on failure). */
const CFG = {
  version: 3,
  agents_available: ["backend", "test"],
  skills_available: ["expressjs"],
  workflow_instances: [
    { name: "backend", agent: "backend", loaded_skills: ["expressjs"], referenced_skills: [] },
    { name: "test", agent: "test", loaded_skills: [], referenced_skills: [] },
  ],
  workflows: [
    {
      name: "build",
      nodes: [
        { id: "backend", type: "agent", instance: "backend", position: { x: 0, y: 100 } },
        { id: "test", type: "agent", instance: "test", position: { x: 0, y: 220 } },
      ],
      edges: [succ("main-session", "backend"), succ("backend", "test"), cond("test", "backend", "tests failed")],
    },
  ],
  rules: [],
} as unknown as MaestroConfigV3;

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-owner-runs-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sessDir = (root: string) => path.join(root, ".claude", "maestro_sessions", SESSION);
const statePath = (root: string) => path.join(sessDir(root), "session.json");
const readState = (root: string) => JSON.parse(fs.readFileSync(statePath(root), "utf8"));
const lane = (root: string, receiver: string, sender: string) =>
  path.join(root, ".claude", "channels", receiver, `${sender}.1.md`);

function readLog(root: string): Record<string, unknown>[] {
  const f = path.join(sessDir(root), "log.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function spawn(script: string, args: string[], root: string, input?: unknown) {
  const e: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp, CLAUDE_CODE_SESSION_ID: SESSION };
  const r = spawnSync("node", [path.join(PLUGIN_SCRIPTS, script), ...args], {
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: "utf8",
    env: e,
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const hook = (root: string, script: string, payload: unknown) => spawn(script, [], root, payload);
const meetingCli = (root: string, args: string[]) => spawn("maestro-team-meeting.cjs", [...args, root], root);

const start = (root: string, agentType: string, agentId: string) => ({
  cwd: root,
  hook_event_name: "SubagentStart",
  agent_type: agentType,
  agent_id: agentId,
});
const stop = (root: string, agentType: string, agentId: string, msg = "done\nHANDOFF: success") => ({
  cwd: root,
  hook_event_name: "SubagentStop",
  agent_type: agentType,
  agent_id: agentId,
  last_assistant_message: msg,
});

function injected(r: { code: number; stdout: string; stderr: string }): string {
  expect(r.code, r.stderr).toBe(0);
  if (!r.stdout.trim()) return "";
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string;
}

const row = (id: string, kind: string, target: string): TallyRow => ({
  id,
  agent: id.split("-")[0],
  supporters: [],
  kind,
  target,
  tier: "approval",
  change: "c",
  rationale: "r",
});

/**
 * A project after a workflow ran and a meeting closed: maestro.json, a session whose workflow is
 * set (run_id minted), NO `meeting` key, and a persisted decision.json with one approved row that
 * produces an owner run for backend.
 */
function project(): string {
  const root = path.join(tmp, "p");
  fs.mkdirSync(root, { recursive: true });
  writeConfig(root, CFG);
  const set = spawn("maestro-set-session-workflow.cjs", ["build"], root);
  expect(set.code, set.stderr).toBe(0);
  const dir = path.join(sessDir(root), "meeting");
  fs.mkdirSync(dir, { recursive: true });
  const record: DecisionRecord = {
    meetingId: "m-1",
    conflictTargets: [],
    rows: [row("backend-1", "agent.edit", "agent:backend")],
  };
  fs.writeFileSync(path.join(dir, "decision.json"), JSON.stringify(record));
  // As after a workflow ran: the run_id a first SubagentStop would have minted is already there.
  fs.writeFileSync(statePath(root), JSON.stringify({ ...readState(root), run_id: "run-prior-1" }));
  const state = readState(root);
  expect(state.workflow).toBe("build");
  expect(state.run_id).toBe("run-prior-1");
  expect(state.meeting).toBeUndefined();
  return root;
}

const STAMP_RE = /^<!-- maestro:run_id=([^\s>]+) -->\n/;
const PAYLOAD = "OWNER-PAYLOAD-MARKER";

describe("owner runs under a recorded workflow (current behaviour)", () => {
  it("gives an owner run the workflow's handoff routing and payload instructions", () => {
    const root = project();
    const ctx = injected(hook(root, "maestro-inject-agent-context.js", start(root, "backend", "own-1")));
    expect(ctx).toMatch(/Handoff routing/);
    expect(ctx).toContain("HANDOFF: success");
    expect(ctx).toContain("write this to `.claude/channels/test/backend.1.md`");
    expect(ctx).not.toMatch(/team meeting/i);
  });

  it("stamps the payload an owner leaves in its lane, so the next workflow step receives it", () => {
    const root = project();
    const runId = readState(root).run_id as string;
    hook(root, "maestro-subagent-log.js", start(root, "backend", "own-1"));
    const f = lane(root, "test", "backend");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `{ "note": "${PAYLOAD}" }\n`);

    expect(hook(root, "maestro-subagent-log.js", stop(root, "backend", "own-1")).code).toBe(0);

    const text = fs.readFileSync(f, "utf8");
    const m = STAMP_RE.exec(text);
    expect(m, text).not.toBeNull();
    expect(m![1]).toBe(runId);
    expect(text.split("\n")[0]).toBe(`<!-- maestro:run_id=${runId} -->`);

    // A later workflow step inlines it as a delivered channel payload.
    const ctx = injected(hook(root, "maestro-inject-agent-context.js", start(root, "test", "wf-test-1")));
    expect(ctx).toContain(PAYLOAD);
  });

  it("logs the owner's stop as a kind:handoff entry that is a resume target for backend", () => {
    const root = project();
    hook(root, "maestro-subagent-log.js", start(root, "backend", "own-1"));
    hook(root, "maestro-subagent-log.js", stop(root, "backend", "own-1"));

    const log = readLog(root);
    const handoff = log.find((e) => e.kind === "handoff" && e.agent_id === "own-1");
    expect(handoff).toBeDefined();
    expect(handoff!.origin).toBe("backend");
    expect(handoff!.owner_run).toBeUndefined();
    expect(handoff!.meeting).toBeUndefined();

    expect(agentRunsFromLog(log).map((r) => [r.agentType, r.agentId])).toEqual([["backend", "own-1"]]);
    const session = readState(root) as MaestroSession;
    expect(resumeTarget(log, CFG, session, "backend")).toBe("own-1");
  });
});

// ── Written for the 081 contract; EXPECTED TO FAIL until it is implemented. ──────────────────

describe("owner runs after the fix (081)", () => {
  /** Flag the owner run through the real CLI, exactly as the moderator would after the meeting. */
  function flagged(): string {
    const root = project();
    const r = meetingCli(root, ["owner-runs", "--approved", "backend-1"]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(JSON.parse(r.stdout).runs.map((x: { agent: string }) => x.agent)).toEqual(["backend"]);
    return root;
  }

  /** A stamped payload waiting for backend (test -> backend loop-back lane). */
  function waitingForBackend(root: string): string {
    const f = lane(root, "backend", "test");
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, `<!-- maestro:run_id=${readState(root).run_id} -->\n{ "fix": "WAITING-FOR-BACKEND" }\n`);
    return f;
  }

  it("owner-runs writes owner_runs { meeting_id, agents, started_at } into session.json", () => {
    const root = flagged();
    const flag = readState(root).owner_runs;
    expect(flag).toBeDefined();
    expect(flag.meeting_id).toBe("m-1");
    expect(flag.agents).toEqual(["backend"]);
    expect(typeof flag.started_at).toBe("string");
    expect(Number.isNaN(Date.parse(flag.started_at))).toBe(false);
    expect(readState(root).workflow).toBe("build"); // other keys kept
  });

  for (const type of ["backend", "maestro:backend"]) {
    it(`SubagentStart for ${type}: no routing, no payload instructions, no delivery; skills and an owner-run notice stay`, () => {
      const root = flagged();
      const waiting = waitingForBackend(root);
      const before = fs.readFileSync(waiting, "utf8");

      const ctx = injected(hook(root, "maestro-inject-agent-context.js", start(root, type, "own-1")));
      expect(ctx).not.toMatch(/Handoff routing/);
      expect(ctx).not.toMatch(/write this to/);
      expect(ctx).not.toMatch(/HANDOFF: success/);
      expect(ctx).not.toContain("WAITING-FOR-BACKEND");
      expect(ctx).not.toContain(".claude/channels/backend/");
      expect(ctx).toMatch(/expressjs/);
      expect(ctx).toMatch(/owner run/i);

      // the waiting file is neither retired nor touched
      expect(fs.existsSync(waiting)).toBe(true);
      expect(fs.readFileSync(waiting, "utf8")).toBe(before);
      expect(fs.existsSync(path.join(root, ".claude", "channels", ".consumed", "backend", "test.1.md"))).toBe(false);
    });
  }

  it("SubagentStop: dispatch and handoff entries carry owner_run, nothing is stamped, never a resume target", () => {
    const root = flagged();
    const pre = lane(root, "test", "backend");
    fs.mkdirSync(path.dirname(pre), { recursive: true });
    fs.writeFileSync(pre, `{ "note": "${PAYLOAD}" }\n`);

    hook(root, "maestro-subagent-log.js", start(root, "backend", "own-1"));
    hook(root, "maestro-subagent-log.js", stop(root, "backend", "own-1"));

    const log = readLog(root);
    const dispatch = log.find((e) => e.kind === "dispatch" && e.agent_id === "own-1");
    const handoff = log.find((e) => e.kind === "handoff" && e.agent_id === "own-1");
    expect(dispatch?.owner_run).toBe(true);
    expect(handoff?.owner_run).toBe(true);

    expect(STAMP_RE.test(fs.readFileSync(pre, "utf8"))).toBe(false);
    expect(fs.readFileSync(pre, "utf8")).toBe(`{ "note": "${PAYLOAD}" }\n`);

    expect(agentRunsFromLog(log)).toEqual([]);
    expect(resumeTarget(log, CFG, readState(root) as MaestroSession, "backend")).toBeNull();

    // so a later 'test' step has no delivered payload from it
    const ctx = injected(hook(root, "maestro-inject-agent-context.js", start(root, "test", "wf-test-1")));
    expect(ctx).not.toContain(PAYLOAD);
  });

  it("other agents are unaffected while the flag is set", () => {
    const root = flagged();
    const ctx = injected(hook(root, "maestro-inject-agent-context.js", start(root, "test", "wf-test-1")));
    expect(ctx).toMatch(/Handoff routing/);
    expect(ctx).not.toMatch(/owner run/i);

    hook(root, "maestro-subagent-log.js", start(root, "test", "wf-test-1"));
    hook(root, "maestro-subagent-log.js", stop(root, "test", "wf-test-1"));
    const h = readLog(root).find((e) => e.kind === "handoff" && e.agent_id === "wf-test-1");
    expect(h).toBeDefined();
    expect(h!.owner_run).toBeUndefined();
    expect(agentRunsFromLog(readLog(root)).map((r) => r.agentId)).toEqual(["wf-test-1"]);
  });

  it("owner-runs-done removes the flag, records unstamped lane files as owner_run_leftovers, and backend is normal again", () => {
    const root = flagged();
    const pre = lane(root, "test", "backend");
    fs.mkdirSync(path.dirname(pre), { recursive: true });
    fs.writeFileSync(pre, `{ "note": "${PAYLOAD}" }\n`);

    const done = meetingCli(root, ["owner-runs-done"]);
    expect(done.code, done.stdout + done.stderr).toBe(0);
    const state = readState(root);
    expect(state.owner_runs).toBeUndefined();
    expect(state.workflow).toBe("build");
    expect(state.owner_run_leftovers).toEqual([
      expect.objectContaining({ path: expect.stringContaining("test/backend.1.md"), size: expect.any(Number), mtimeMs: expect.any(Number) }),
    ]);

    // the recorded leftover is not adopted by a later backend run, which is otherwise normal
    const ctx = injected(hook(root, "maestro-inject-agent-context.js", start(root, "backend", "wf-b-1")));
    expect(ctx).toMatch(/Handoff routing/);
    expect(ctx).toMatch(/write this to/);
    expect(ctx).not.toMatch(/owner run/i);
    hook(root, "maestro-subagent-log.js", start(root, "backend", "wf-b-1"));
    hook(root, "maestro-subagent-log.js", stop(root, "backend", "wf-b-1"));
    expect(STAMP_RE.test(fs.readFileSync(pre, "utf8"))).toBe(false);
    const h = readLog(root).find((e) => e.kind === "handoff" && e.agent_id === "wf-b-1");
    expect(h?.owner_run).toBeUndefined();
    expect(agentRunsFromLog(readLog(root)).map((r) => r.agentId)).toEqual(["wf-b-1"]);
  });

  it("maestro-set-session-workflow.cjs also removes the flag", () => {
    const root = flagged();
    expect(readState(root).owner_runs).toBeDefined();
    const r = spawn("maestro-set-session-workflow.cjs", ["build"], root);
    expect(r.code, r.stderr).toBe(0);
    expect(readState(root).owner_runs).toBeUndefined();
    const ctx = injected(hook(root, "maestro-inject-agent-context.js", start(root, "backend", "wf-b-2")));
    expect(ctx).toMatch(/Handoff routing/);
  });
});
