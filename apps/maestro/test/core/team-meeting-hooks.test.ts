// Team meeting — the leak tests. A meeting resumes or dispatches the project's REAL configured
// agents, so every way a meeting turn could bleed into a later workflow run is driven here through
// the REAL scripts: the hooks the installer copies into `<project>/.claude/scripts/`, and the
// plugin-only CLIs (`maestro-team-meeting.cjs`, `maestro-post-mortem.js`) spawned from
// `plugins/maestro/scripts/`. Nothing is mocked.
//
// Every spawn pins HOME at this test's tmp dir and SETS or DELETES CLAUDE_CODE_SESSION_ID — never
// inherits it (`064`; see test-maestro's references/hook-script-tests.md).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { checkChannelWrite } from "../../src/core/channel-write-guard.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const REPO_ROOT = path.resolve(PLUGIN_ROOT, "..", "..");
const PLUGIN_SCRIPTS = path.join(PLUGIN_ROOT, "scripts");

const SESSION = "sess-meet-111";
const OTHER = "sess-other-222";

const succ = (from: string, to: string) =>
  ({ from, to, kind: "success", sourceHandle: "bottom", targetHandle: "top" }) as const;
const cond = (from: string, to: string, label: string) =>
  ({ from, to, kind: "condition", label, sourceHandle: "right", targetHandle: "top" }) as const;

/** build: backend → frontend → reviewer (reviewer loops back to frontend). docs: scribe. */
const CFG: MaestroConfigV3 = {
  version: 3,
  agents_available: ["backend", "frontend", "reviewer", "scribe"],
  skills_available: ["expressjs", "react"],
  workflow_instances: [
    { name: "backend", agent: "backend", loaded_skills: ["expressjs"], referenced_skills: [] },
    { name: "frontend", agent: "frontend", loaded_skills: ["react"], referenced_skills: [] },
    { name: "reviewer", agent: "reviewer", loaded_skills: [], referenced_skills: [] },
    { name: "scribe", agent: "scribe", loaded_skills: [], referenced_skills: [] },
  ],
  workflows: [
    {
      name: "build",
      nodes: [
        { id: "backend", type: "agent", instance: "backend", position: { x: 0, y: 100 } },
        { id: "frontend", type: "agent", instance: "frontend", position: { x: 0, y: 220 } },
        { id: "reviewer", type: "agent", instance: "reviewer", position: { x: 0, y: 340 } },
      ],
      edges: [
        succ("main-session", "backend"),
        succ("backend", "frontend"),
        succ("frontend", "reviewer"),
        cond("reviewer", "frontend", "changes requested"),
      ],
    },
    {
      name: "docs",
      nodes: [{ id: "scribe", type: "agent", instance: "scribe", position: { x: 0, y: 100 } }],
      edges: [succ("main-session", "scribe")],
    },
  ],
  rules: [],
  reports: { backend: { id: "backend-report" }, frontend: { id: "frontend-report" } },
} as unknown as MaestroConfigV3;

const PROTO_MARK = "PROTOCOL-BACKEND-TO-FRONTEND";
const REPORT_MARK = "REPORT-FORMAT-BACKEND";
const PAYLOAD = "PAYLOAD-FROM-BACKEND-MEETING";

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-meeting-hooks-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function installed(): Promise<string> {
  const root = path.join(tmp, "p");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeConfig(root, CFG);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  // installRuntime leaves the HANDOFFS region as its placeholder (the app renders on save), so
  // render once the way a configured project would have — otherwise `start` correctly refuses it
  // as stale.
  const rendered = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root], {
    encoding: "utf8",
    env: env(root, null),
  });
  expect(rendered.status, rendered.stderr).toBe(0);
  // A project-tier protocol and report, so a non-meeting control run provably carries both.
  fs.mkdirSync(path.join(root, ".claude", "handoffs", "backend"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "handoffs", "backend", "frontend.md"), `{ "${PROTO_MARK}": true }`);
  fs.mkdirSync(path.join(root, ".claude", "reports"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "reports", "backend-report.md"), REPORT_MARK);
  fs.writeFileSync(path.join(root, ".claude", "reports", "frontend-report.md"), "REPORT-FORMAT-FRONTEND");
  return root;
}

/** HOME pinned at this test's tmp; `sessionId: null` DELETES the variable — never inherited. */
function env(root: string, sessionId: string | null): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp };
  if (sessionId === null) delete e.CLAUDE_CODE_SESSION_ID;
  else e.CLAUDE_CODE_SESSION_ID = sessionId;
  return e;
}

function run(file: string, args: string[], root: string, sessionId: string | null, input?: unknown) {
  const r = spawnSync("node", [file, ...args], {
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: "utf8",
    env: env(root, sessionId),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const hook = (root: string, script: string, payload: unknown, sessionId: string | null = SESSION) =>
  run(path.join(root, ".claude", "scripts", script), [], root, sessionId, payload);
const projectCli = (root: string, script: string, args: string[], sessionId: string | null = SESSION) =>
  run(path.join(root, ".claude", "scripts", script), args, root, sessionId);
const pluginCli = (root: string, script: string, args: string[], sessionId: string | null = SESSION) =>
  run(path.join(PLUGIN_SCRIPTS, script), args, root, sessionId);

const meetingCli = (root: string, args: string[], sessionId: string | null = SESSION) =>
  pluginCli(root, "maestro-team-meeting.cjs", [...args, root], sessionId);

const sessDir = (root: string, id = SESSION) => path.join(root, ".claude", "maestro_sessions", id);
const statePath = (root: string, id = SESSION) => path.join(sessDir(root, id), "session.json");
const meetingDir = (root: string, id = SESSION) => path.join(sessDir(root, id), "meeting");
const readState = (root: string, id = SESSION) => JSON.parse(fs.readFileSync(statePath(root, id), "utf8"));
const lane = (root: string, receiver: string, sender: string) =>
  path.join(root, ".claude", "channels", receiver, `${sender}.1.md`);
const consumed = (root: string, receiver: string, sender: string) =>
  path.join(root, ".claude", "channels", ".consumed", receiver, `${sender}.1.md`);

function readLog(root: string, id = SESSION): Record<string, unknown>[] {
  const f = path.join(sessDir(root, id), "log.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

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

/** The additionalContext the inject hook returned, or "" when it printed nothing. */
function injected(r: { code: number; stdout: string; stderr: string }): string {
  expect(r.code, r.stderr).toBe(0);
  if (!r.stdout.trim()) return "";
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string;
}

function startMeetingFor(root: string, participants: string[]) {
  const r = meetingCli(root, ["start", "--mode", "review", "--participants", participants.join(",")]);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  const out = JSON.parse(r.stdout);
  expect(out.ok).toBe(true);
  return out.meeting as { id: string; dir: string; participants: string[] };
}

function endMeetingFor(root: string) {
  const r = meetingCli(root, ["end"]);
  expect(r.code, r.stdout + r.stderr).toBe(0);
  return JSON.parse(r.stdout) as { ok: boolean; ended: boolean };
}

/** Ensure a run_id exists in this session (the first run of any workflow does this). */
function setWorkflow(root: string, name = "build", sessionId: string | null = SESSION) {
  const r = projectCli(root, "maestro-set-session-workflow.cjs", [name], sessionId);
  expect(r.code, r.stderr).toBe(0);
  return r;
}

const ROUTING = /Handoff routing for the/;
const STAMP_RE = /^<!-- maestro:run_id=([^\s>]+) -->\n/;

// ── 1. inject hook: notice instead of routing / protocols / report ─────────

describe("leak 1 — SubagentStart gives a participant the notice and nothing workflow-shaped", () => {
  it("control: a workflow run of backend carries routing, the protocol and the report", async () => {
    const root = await installed();
    setWorkflow(root);
    const ctx = injected(hook(root, "maestro-inject-agent-context.cjs", start(root, "backend", "wf-1")));
    expect(ctx).toMatch(ROUTING);
    expect(ctx).toContain(PROTO_MARK);
    expect(ctx).toContain(REPORT_MARK);
    expect(ctx).not.toMatch(/team meeting/);
  });

  it("first run: notice, skills kept, no routing / protocol / report", async () => {
    const root = await installed();
    setWorkflow(root);
    const m = startMeetingFor(root, ["backend"]);
    const ctx = injected(hook(root, "maestro-inject-agent-context.cjs", start(root, "maestro:backend", "mt-1")));
    expect(ctx).toContain(`Maestro team meeting in progress (review, ${m.id})`);
    expect(ctx).toContain(meetingDir(root));
    expect(ctx).toMatch(/expressjs/); // the skills block stays on a first run
    expect(ctx).not.toMatch(ROUTING);
    expect(ctx).not.toMatch(/HANDOFF: success/);
    expect(ctx).not.toContain(PROTO_MARK);
    expect(ctx).not.toMatch(/write the shape for the route/);
    expect(ctx).not.toContain(REPORT_MARK);
    expect(ctx).not.toMatch(/Mandatory output format/);
  });

  it("resume of a workflow agent: notice again, no 'first run still applies' reminder, no routing / report", async () => {
    const root = await installed();
    setWorkflow(root);
    // backend completes a WORKFLOW run as wf-1 …
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "wf-1"));
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "wf-1"));
    // … then the meeting resumes that same agent.
    const m = startMeetingFor(root, ["backend"]);
    const ctx = injected(hook(root, "maestro-inject-agent-context.cjs", start(root, "backend", "wf-1")));
    expect(ctx).toContain(`Maestro team meeting in progress (review, ${m.id})`);
    expect(ctx).not.toMatch(/Resumed run — the skills, handoff routes and output format/);
    expect(ctx).not.toMatch(ROUTING);
    expect(ctx).not.toContain(PROTO_MARK);
    expect(ctx).not.toContain(REPORT_MARK);
  });

  it("a non-participant in the same meeting still gets full workflow injection", async () => {
    const root = await installed();
    setWorkflow(root);
    startMeetingFor(root, ["frontend"]);
    const ctx = injected(hook(root, "maestro-inject-agent-context.cjs", start(root, "backend", "wf-1")));
    expect(ctx).toMatch(ROUTING);
    expect(ctx).toContain(PROTO_MARK);
    expect(ctx).toContain(REPORT_MARK);
    expect(ctx).not.toMatch(/team meeting/);
  });

  it("another session's meeting does not affect this session", async () => {
    const root = await installed();
    setWorkflow(root);
    setWorkflow(root, "build", OTHER);
    startMeetingFor(root, ["backend"]); // meeting in SESSION only
    const ctx = injected(hook(root, "maestro-inject-agent-context.cjs", start(root, "backend", "x"), OTHER));
    expect(ctx).toMatch(ROUTING);
    expect(ctx).not.toMatch(/team meeting/);
  });
});

// ── 2. channel delivery skipped ────────────────────────────────────────────

describe("leak 2 — a same-run payload in a participant's lane is neither inlined nor retired", () => {
  it("participant frontend: payload stays in the lane, no channel_delivery entry", async () => {
    const root = await installed();
    setWorkflow(root);
    const runId = readState(root).run_id ?? null;
    // Mint the run id the way a workflow does, via backend's SubagentStop stamping its lane write.
    fs.mkdirSync(path.dirname(lane(root, "frontend", "backend")), { recursive: true });
    fs.writeFileSync(lane(root, "frontend", "backend"), PAYLOAD);
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "wf-1"));
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "wf-1"));
    const stamped = fs.readFileSync(lane(root, "frontend", "backend"), "utf8");
    const m = STAMP_RE.exec(stamped);
    expect(m, "control: the workflow run stamped its write").not.toBeNull();
    expect(m![1]).toBe(readState(root).run_id);
    expect(runId === null || runId === m![1]).toBe(true);

    startMeetingFor(root, ["frontend"]);
    const ctx = injected(hook(root, "maestro-inject-agent-context.cjs", start(root, "frontend", "mt-f")));
    expect(ctx).not.toContain(PAYLOAD);
    expect(ctx).not.toMatch(/Delivered to your channel/);
    expect(ctx).not.toMatch(/Waiting in your channel/);
    expect(fs.readFileSync(lane(root, "frontend", "backend"), "utf8")).toBe(stamped);
    expect(fs.existsSync(consumed(root, "frontend", "backend"))).toBe(false);
    expect(readLog(root).some((e) => e.kind === "channel_delivery")).toBe(false);

    // And once the meeting is over, the workflow step that payload was waiting for still gets it.
    endMeetingFor(root);
    const later = injected(hook(root, "maestro-inject-agent-context.cjs", start(root, "frontend", "wf-f")));
    expect(later).toMatch(/Delivered to your channel/);
    expect(later).toContain(PAYLOAD);
    expect(fs.existsSync(consumed(root, "frontend", "backend"))).toBe(true);
  });
});

// ── 3. log marks ───────────────────────────────────────────────────────────

describe("leak 3 — participant dispatch and handoff entries carry meeting: true", () => {
  it("marks the participant's entries and only theirs", async () => {
    const root = await installed();
    setWorkflow(root);
    startMeetingFor(root, ["backend"]);
    for (const [type, id] of [
      ["maestro:backend", "mt-b"],
      ["frontend", "wf-f"],
    ]) {
      expect(hook(root, "maestro-subagent-log.cjs", start(root, type, id)).code).toBe(0);
      expect(hook(root, "maestro-subagent-log.cjs", stop(root, type, id)).code).toBe(0);
    }
    const log = readLog(root);
    const b = log.filter((e) => e.agent_id === "mt-b");
    const f = log.filter((e) => e.agent_id === "wf-f");
    expect(b.map((e) => e.kind)).toEqual(["dispatch", "handoff"]);
    for (const e of b) expect(e.meeting).toBe(true);
    expect(b[0].log).toBe("→ maestro:backend (meeting)");
    expect(b[1].log).toBe("meeting turn");
    expect(f.map((e) => e.kind)).toEqual(["dispatch", "handoff"]);
    for (const e of f) expect("meeting" in e).toBe(false);
  });

  it("does not run the SendMessage transcript recovery for a participant", async () => {
    const root = await installed();
    setWorkflow(root);
    startMeetingFor(root, ["backend"]);
    const tp = path.join(tmp, "agent.jsonl");
    fs.writeFileSync(
      tp,
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "tool_use", name: "SendMessage", input: { message: "x\nHANDOFF: success" } }] },
      })
    );
    hook(root, "maestro-subagent-log.cjs", {
      ...stop(root, "backend", "mt-b", "wrote round-1/backend.json"),
      agent_transcript_path: tp,
    });
    const h = readLog(root).find((e) => e.kind === "handoff")!;
    expect(h.meeting).toBe(true);
    expect(h.status).not.toBe("success");
  });
});

// ── 4. no stamping, end to end ─────────────────────────────────────────────

describe("leak 4 — SubagentStop never stamps a participant's channel file", () => {
  it("meeting write → end → workflow set → frontend starts: not inlined, not retired, reported unstamped", async () => {
    const root = await installed();
    setWorkflow(root);
    startMeetingFor(root, ["backend", "frontend"]);

    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "mt-b"));
    // The participant gets a file into frontend's lane (e.g. through Bash, which the guard can't see).
    fs.mkdirSync(path.dirname(lane(root, "frontend", "backend")), { recursive: true });
    fs.writeFileSync(lane(root, "frontend", "backend"), PAYLOAD);
    expect(hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "mt-b")).code).toBe(0);
    expect(fs.readFileSync(lane(root, "frontend", "backend"), "utf8")).toBe(PAYLOAD);

    expect(endMeetingFor(root)).toEqual({ ok: true, ended: true });
    setWorkflow(root, "build");
    expect(readState(root).meeting).toBeUndefined();

    const ctx = injected(hook(root, "maestro-inject-agent-context.cjs", start(root, "frontend", "wf-f")));
    expect(ctx).not.toContain(PAYLOAD);
    expect(ctx).not.toMatch(/Delivered to your channel/);
    expect(ctx).toMatch(/Waiting in your channel but NOT from this run/);
    expect(ctx).toMatch(/from `backend`, [\d.]+d old \(unstamped\): `\.claude\/channels\/frontend\/backend\.1\.md`/);
    expect(fs.readFileSync(lane(root, "frontend", "backend"), "utf8")).toBe(PAYLOAD);
    expect(fs.existsSync(consumed(root, "frontend", "backend"))).toBe(false);
  });

  it("a non-participant's SubagentStop during the meeting still stamps (control)", async () => {
    const root = await installed();
    setWorkflow(root);
    startMeetingFor(root, ["frontend"]);
    fs.mkdirSync(path.dirname(lane(root, "frontend", "backend")), { recursive: true });
    fs.writeFileSync(lane(root, "frontend", "backend"), PAYLOAD);
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "wf-b"));
    expect(fs.readFileSync(lane(root, "frontend", "backend"), "utf8")).toMatch(STAMP_RE);
  });

  // Probe beyond the brief: the leftover unstamped meeting file is still keyed only on its SENDER.
  // If the participant's NEXT workflow run (same session, same run_id) ends without overwriting
  // that lane, its SubagentStop stamps the meeting leftover with the live run_id, and the receiver
  // then inlines it as this run's payload.
  it("the sender's next workflow SubagentStop does not adopt the meeting leftover", async () => {
    const root = await installed();
    setWorkflow(root);
    startMeetingFor(root, ["backend"]);
    fs.mkdirSync(path.dirname(lane(root, "frontend", "backend")), { recursive: true });
    fs.writeFileSync(lane(root, "frontend", "backend"), PAYLOAD);
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "mt-b"));
    endMeetingFor(root);
    setWorkflow(root, "build");

    // backend's workflow run writes nothing to frontend's lane this time.
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "wf-b"));
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "wf-b"));

    const ctx = injected(hook(root, "maestro-inject-agent-context.cjs", start(root, "frontend", "wf-f")));
    expect(ctx).not.toContain(PAYLOAD);
    expect(fs.readFileSync(lane(root, "frontend", "backend"), "utf8")).toBe(PAYLOAD);
    expect(readState(root).meeting_leftovers).toEqual([
      expect.objectContaining({ path: expect.stringMatching(/channels[\\/]frontend[\\/]backend\.1\.md$/) }),
    ]);
  });

  /** Meeting leaves an unstamped backend → frontend leftover, then ends. */
  function leftoverAfterMeeting(root: string): void {
    setWorkflow(root);
    startMeetingFor(root, ["backend"]);
    fs.mkdirSync(path.dirname(lane(root, "frontend", "backend")), { recursive: true });
    fs.writeFileSync(lane(root, "frontend", "backend"), PAYLOAD);
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "mt-b"));
    expect(endMeetingFor(root).ended).toBe(true);
    setWorkflow(root, "build");
    expect(readState(root).meeting_leftovers).toHaveLength(1);
  }

  /** The run_id is minted lazily (first SubagentStop), so read it after the stop under test. */
  const liveRunId = (root: string) => {
    const id = readState(root).run_id as string;
    expect(id).toBeTruthy();
    return id;
  };

  it("a leftover REWRITTEN later (size changed) is stamped normally and delivered", async () => {
    const root = await installed();
    leftoverAfterMeeting(root);
    const fresh = "FRESH-WORKFLOW-PAYLOAD-" + "x".repeat(40);
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "wf-b"));
    fs.writeFileSync(lane(root, "frontend", "backend"), fresh);
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "wf-b"));

    expect(fs.readFileSync(lane(root, "frontend", "backend"), "utf8")).toBe(
      `<!-- maestro:run_id=${liveRunId(root)} -->\n${fresh}`
    );
    const ctx = injected(hook(root, "maestro-inject-agent-context.cjs", start(root, "frontend", "wf-f")));
    expect(ctx).toMatch(/Delivered to your channel/);
    expect(ctx).toContain(fresh);
  });

  it("a leftover touched later (same size, mtime changed) is stamped normally", async () => {
    const root = await installed();
    leftoverAfterMeeting(root);
    const f = lane(root, "frontend", "backend");
    const later = new Date(fs.statSync(f).mtimeMs + 60_000);
    fs.utimesSync(f, later, later);
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "wf-b"));
    expect(fs.readFileSync(f, "utf8")).toBe(`<!-- maestro:run_id=${liveRunId(root)} -->\n${PAYLOAD}`);
  });

  it("a session that never had a meeting stamps exactly as before", async () => {
    const root = await installed();
    setWorkflow(root);
    fs.mkdirSync(path.dirname(lane(root, "frontend", "backend")), { recursive: true });
    fs.writeFileSync(lane(root, "frontend", "backend"), PAYLOAD);
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "wf-b"));
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "wf-b"));

    expect(fs.readFileSync(lane(root, "frontend", "backend"), "utf8")).toBe(
      `<!-- maestro:run_id=${liveRunId(root)} -->\n${PAYLOAD}`
    );
    expect(readState(root)).not.toHaveProperty("meeting_leftovers");
    expect(readState(root)).not.toHaveProperty("meeting");
    const ctx = injected(hook(root, "maestro-inject-agent-context.cjs", start(root, "frontend", "wf-f")));
    expect(ctx).toMatch(/Delivered to your channel/);
    expect(ctx).toContain(PAYLOAD);
    expect(fs.existsSync(consumed(root, "frontend", "backend"))).toBe(true);
  });
});

// ── 5. resume: an agent_id resumed into a meeting is never a resume target ─

describe("leak 5 — a workflow agent resumed into a post-mortem meeting is no longer a resume target", () => {
  const resumeCli = (root: string, agentType: string) => {
    const r = projectCli(root, "maestro-resume-target.cjs", [agentType]);
    expect(r.code, r.stderr).toBe(0);
    return r.stdout.trim();
  };

  it("control: backend's workflow run A1 is the resume target when no meeting touched it", async () => {
    const root = await installed();
    expect(fs.existsSync(path.join(root, ".claude", "scripts", "maestro-resume-target.cjs"))).toBe(true);
    setWorkflow(root);
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "A1"));
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "A1"));
    expect(resumeCli(root, "backend")).toBe("A1");
    expect(resumeCli(root, "maestro:backend")).toBe("A1");
  });

  it("workflow run A1 → post-mortem meeting turn on A1 → end: resume target is null", async () => {
    const root = await installed();
    setWorkflow(root);
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "A1"));
    expect(hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "A1")).code).toBe(0);

    const r = meetingCli(root, ["start", "--mode", "post-mortem", "--participants", "backend"]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "A1"));
    expect(hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "A1", "proposals written")).code).toBe(0);
    expect(endMeetingFor(root).ended).toBe(true);

    const handoffs = readLog(root).filter((e) => e.kind === "handoff" && e.agent_id === "A1");
    expect(handoffs.map((e) => e.meeting === true)).toEqual([false, true]);

    expect(resumeCli(root, "backend")).toBe("");
    // The same answer once a workflow is set again (the orchestrator's next loop-back).
    setWorkflow(root, "build");
    expect(resumeCli(root, "backend")).toBe("");
    expect(resumeCli(root, "maestro:backend")).toBe("");
  });

  it("a later fresh workflow run of backend is resumable again", async () => {
    const root = await installed();
    setWorkflow(root);
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "A1"));
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "A1"));
    meetingCli(root, ["start", "--mode", "post-mortem", "--participants", "backend"]);
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "A1"));
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "A1", "proposals written"));
    endMeetingFor(root);
    setWorkflow(root, "build");
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "A2"));
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "A2"));
    expect(resumeCli(root, "backend")).toBe("A2");
  });
});

// ── 6. write guard ─────────────────────────────────────────────────────────

describe("leak 6 — the write guard confines a participant to the meeting directory", () => {
  const guard = (root: string, agentType: string, file: string, tool = "Write", sessionId: string | null = SESSION) => {
    // Plugin-only hook (hooks.json registers it from the plugin root; it is never copied into a
    // project), so the plugin's own script is the real one.
    const r = run(path.join(PLUGIN_SCRIPTS, "maestro-channel-write-guard.js"), [], root, sessionId, {
      cwd: root,
      hook_event_name: "PreToolUse",
      agent_type: agentType,
      tool_name: tool,
      tool_input: tool === "NotebookEdit" ? { notebook_path: file } : { file_path: file },
    });
    expect(r.code, r.stderr).toBe(0);
    if (!r.stdout.trim()) return { allow: true as const, reason: "" };
    const out = JSON.parse(r.stdout).hookSpecificOutput;
    expect(out.permissionDecision).toBe("deny");
    return { allow: false as const, reason: out.permissionDecisionReason as string };
  };

  it("allows writes under meeting/, absolute or relative, and in a new round directory", async () => {
    const root = await installed();
    startMeetingFor(root, ["backend", "reviewer"]);
    expect(guard(root, "backend", path.join(meetingDir(root), "round-1", "backend.json")).allow).toBe(true);
    expect(
      guard(root, "maestro:backend", path.relative(root, path.join(meetingDir(root), "round-2", "backend.json"))).allow
    ).toBe(true);
    expect(guard(root, "reviewer", path.join(meetingDir(root), "round-1", "reviewer.json"), "Edit").allow).toBe(true);
    // Reads and non-write tools are never in scope.
    expect(guard(root, "backend", path.join(root, "src", "a.ts"), "Read").allow).toBe(true);
  });

  it("blocks channels, source, maestro.json, the meeting dir itself, and a .. path", async () => {
    const root = await installed();
    startMeetingFor(root, ["backend", "reviewer"]);
    const blocked: Array<[string, string, string?]> = [
      ["backend", ".claude/channels/frontend/backend.1.md"],
      ["reviewer", ".claude/channels/scribe/reviewer.1.md"], // even the reviewer's own lanes
      ["backend", path.join(root, "src", "a.ts")],
      ["backend", "src/a.ts", "MultiEdit"],
      ["backend", "nb.ipynb", "NotebookEdit"],
      ["backend", ".claude/maestro.json", "Edit"],
      ["backend", path.join(sessDir(root), "session.json")],
      ["backend", meetingDir(root)],
      // Raw strings: path.join would collapse the `..` before the guard ever saw it.
      ["backend", `${meetingDir(root)}/../session.json`],
      ["backend", `${meetingDir(root)}/round-1/../x.json`], // lands back inside — still refused
      ["backend", ".claude/maestro_sessions/" + SESSION + "/meeting/../../../channels/frontend/backend.1.md"],
      ["backend", path.join(sessDir(root, OTHER), "meeting", "x.json")],
      ["backend", ""],
    ];
    for (const [agent, file, tool] of blocked) {
      const v = guard(root, agent, file, tool);
      expect(v.allow, `${agent} ${tool ?? "Write"} ${file}`).toBe(false);
      expect(v.reason).toMatch(/team meeting is in progress/);
    }
  });

  it("blocks a symlinked meeting directory and a symlink inside it", async () => {
    const root = await installed();
    startMeetingFor(root, ["backend"]);
    // A symlink inside the meeting dir that points at a channel lane.
    fs.mkdirSync(path.join(root, ".claude", "channels", "frontend"), { recursive: true });
    fs.symlinkSync(path.join(root, ".claude", "channels", "frontend"), path.join(meetingDir(root), "evil"));
    expect(guard(root, "backend", path.join(meetingDir(root), "evil", "backend.1.md")).allow).toBe(false);

    // The meeting directory itself replaced by a symlink to somewhere outside.
    const outside = path.join(tmp, "outside", "meeting");
    fs.mkdirSync(outside, { recursive: true });
    fs.rmSync(meetingDir(root), { recursive: true });
    fs.symlinkSync(outside, meetingDir(root));
    expect(guard(root, "backend", path.join(meetingDir(root), "round-1", "backend.json")).allow).toBe(false);
  });

  it("blocks a meeting dir symlinked to ANOTHER session's meeting dir", async () => {
    const root = await installed();
    startMeetingFor(root, ["backend"]);
    const otherMeeting = meetingDir(root, OTHER);
    fs.mkdirSync(otherMeeting, { recursive: true });
    fs.rmSync(meetingDir(root), { recursive: true, force: true });
    fs.symlinkSync(otherMeeting, meetingDir(root));
    const v = guard(root, "backend", path.join(meetingDir(root), "round-1", "backend.json"));
    expect(v.allow).toBe(false);
    expect(v.reason).toMatch(/team meeting is in progress/);
    expect(fs.existsSync(path.join(otherMeeting, "round-1"))).toBe(false);
  });

  it("blocks a Write straight into another session's meeting dir", async () => {
    const root = await installed();
    startMeetingFor(root, ["backend"]);
    fs.mkdirSync(meetingDir(root, OTHER), { recursive: true });
    for (const f of [
      path.join(meetingDir(root, OTHER), "x.json"),
      `.claude/maestro_sessions/${OTHER}/meeting/x.json`,
    ]) {
      expect(guard(root, "backend", f).allow, f).toBe(false);
    }
  });

  it("blocks when the session dir itself is a symlink to another session's dir", async () => {
    const root = await installed();
    startMeetingFor(root, ["backend"]);
    // Move the real session (meeting flag and all) under OTHER's name, and point SESSION at it, so
    // the guard still finds an active meeting naming backend — only the path identity is wrong.
    fs.renameSync(sessDir(root), sessDir(root, OTHER));
    fs.symlinkSync(sessDir(root, OTHER), sessDir(root));
    expect(readState(root).meeting.participants).toContain("backend");
    for (const f of [
      path.join(meetingDir(root), "round-1", "backend.json"),
      path.join(meetingDir(root, OTHER), "round-1", "backend.json"),
    ]) {
      const v = guard(root, "backend", f);
      expect(v.allow, f).toBe(false);
      expect(v.reason).toMatch(/team meeting is in progress/);
    }
  });

  it("still allows the own meeting dir, whether it exists or has not been created yet", async () => {
    const root = await installed();
    startMeetingFor(root, ["backend"]);
    fs.mkdirSync(meetingDir(root), { recursive: true });
    expect(guard(root, "backend", path.join(meetingDir(root), "round-1", "backend.json")).allow).toBe(true);
    fs.rmSync(meetingDir(root), { recursive: true, force: true });
    expect(fs.existsSync(meetingDir(root))).toBe(false);
    expect(guard(root, "backend", path.join(meetingDir(root), "round-1", "backend.json")).allow).toBe(true);
    expect(guard(root, "backend", `.claude/maestro_sessions/${SESSION}/meeting/round-1/backend.json`).allow).toBe(true);
  });

  it("blocks a wrongly placed meeting directory (pure check — the hook always derives it)", async () => {
    const root = await installed();
    const wrong = path.join(root, "meeting");
    fs.mkdirSync(wrong, { recursive: true });
    const v = checkChannelWrite({
      cwd: root,
      agentType: "backend",
      toolName: "Write",
      toolInput: { file_path: path.join(wrong, "x.json") },
      meetingDir: wrong,
    });
    expect(v.allow).toBe(false);
    const wrongName = path.join(sessDir(root), "notmeeting");
    fs.mkdirSync(wrongName, { recursive: true });
    expect(
      checkChannelWrite({
        cwd: root,
        agentType: "backend",
        toolName: "Write",
        toolInput: { file_path: path.join(wrongName, "x.json") },
        meetingDir: wrongName,
      }).allow
    ).toBe(false);
  });

  it("non-participants keep today's rules during the meeting", async () => {
    const root = await installed();
    startMeetingFor(root, ["backend"]);
    // frontend is unrestricted; reviewer is channel-only; neither is confined to the meeting dir.
    expect(guard(root, "frontend", path.join(root, "src", "a.ts")).allow).toBe(true);
    expect(guard(root, "reviewer", ".claude/channels/scribe/reviewer.1.md").allow).toBe(true);
    const r = guard(root, "reviewer", path.join(root, "src", "a.ts"));
    expect(r.allow).toBe(false);
    expect(r.reason).not.toMatch(/team meeting/);
    expect(guard(root, "reviewer", path.join(meetingDir(root), "round-1", "reviewer.json")).allow).toBe(false);
  });

  it("the main session (no agent_type) is never confined", async () => {
    const root = await installed();
    startMeetingFor(root, ["backend"]);
    expect(guard(root, "", path.join(root, ".claude", "maestro.json")).allow).toBe(true);
  });

  it("after `end` every agent is back on today's rules", async () => {
    const root = await installed();
    startMeetingFor(root, ["backend", "reviewer"]);
    endMeetingFor(root);
    expect(guard(root, "backend", path.join(root, "src", "a.ts")).allow).toBe(true);
    expect(guard(root, "backend", ".claude/channels/frontend/backend.1.md").allow).toBe(true);
    expect(guard(root, "reviewer", ".claude/channels/scribe/reviewer.1.md").allow).toBe(true);
    const r = guard(root, "reviewer", path.join(root, "src", "a.ts"));
    expect(r.allow).toBe(false);
    expect(r.reason).not.toMatch(/team meeting/);
  });

  it("with no session id resolvable a participant falls back to today's rules", async () => {
    const root = await installed();
    startMeetingFor(root, ["backend"]);
    expect(guard(root, "backend", path.join(root, "src", "a.ts"), "Write", null).allow).toBe(true);
  });
});

// ── 7. set-session-workflow clears the flag ────────────────────────────────

describe("leak 7 — maestro-set-session-workflow removes `meeting` and keeps everything else", () => {
  it("drops meeting, keeps every other key, and leaves another session untouched", async () => {
    const root = await installed();
    setWorkflow(root, "build", OTHER);
    startMeetingFor(root, ["backend"]);
    // A meeting in the OTHER session too, so 'untouched' is meaningful.
    expect(meetingCli(root, ["start", "--mode", "review", "--participants", "frontend"], OTHER).code).toBe(0);
    const otherBefore = fs.readFileSync(statePath(root, OTHER), "utf8");

    const extra = {
      run_id: "run-xyz",
      worktree: { path: "/wt", branch: "b" },
      active_task: "001-a.md",
      unknown_key: [1],
    };
    fs.writeFileSync(statePath(root), JSON.stringify({ ...readState(root), ...extra }));
    const before = readState(root);
    expect(before.meeting).toBeDefined();

    const r = setWorkflow(root, "docs");
    expect(r.stdout).toMatch(/team meeting that was in progress has been ended/);
    const after = readState(root);
    expect("meeting" in after).toBe(false);
    const { meeting: _m, ...rest } = before;
    expect(after).toEqual({ ...rest, workflow: "docs", generated_instances: before.generated_instances ?? [] });
    expect(fs.readFileSync(statePath(root, OTHER), "utf8")).toBe(otherBefore);
    // The meeting transcript directory is not removed by starting a workflow.
    expect(fs.existsSync(meetingDir(root))).toBe(true);
  });

  it("says nothing about a meeting when none was running", async () => {
    const root = await installed();
    const r = setWorkflow(root, "build");
    expect(r.stdout).not.toMatch(/team meeting/);
  });
});

// ── 8. CLI start / end / refusals ──────────────────────────────────────────

describe("leak 8 — maestro-team-meeting.cjs start/end", () => {
  it("start and end keep run_id, worktree and unknown keys in session.json", async () => {
    const root = await installed();
    setWorkflow(root);
    const extra = { run_id: "run-keep", worktree: { path: "/wt", branch: "b", main_root: root }, future: { a: 1 } };
    fs.writeFileSync(statePath(root), JSON.stringify({ ...readState(root), ...extra }));
    const before = readState(root);

    const m = startMeetingFor(root, ["maestro:backend", "frontend"]);
    expect(m.participants).toEqual(["backend", "frontend"]);
    expect(m.dir).toBe(meetingDir(root));
    expect(readState(root)).toEqual({ ...before, meeting: m });

    expect(endMeetingFor(root)).toEqual({ ok: true, ended: true });
    expect(readState(root)).toEqual(before);
    expect(endMeetingFor(root)).toEqual({ ok: true, ended: false });
  });

  it("defaults participants: review → placed agents; post-mortem → agents with a non-meeting run", async () => {
    const root = await installed();
    setWorkflow(root);
    const review = meetingCli(root, ["start", "--mode", "review"]);
    expect(JSON.parse(review.stdout).meeting.participants.sort()).toEqual([
      "backend",
      "frontend",
      "reviewer",
      "scribe",
    ]);
    endMeetingFor(root);

    // Nothing ran yet → post-mortem refuses.
    const none = meetingCli(root, ["start", "--mode", "post-mortem"]);
    expect(none.code).toBe(1);
    expect(JSON.parse(none.stdout).ok).toBe(false);

    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "wf-b"));
    startMeetingFor(root, ["frontend"]);
    hook(root, "maestro-subagent-log.cjs", stop(root, "frontend", "mt-f")); // a meeting turn — not a run
    endMeetingFor(root);
    const pm = meetingCli(root, ["start", "--mode", "post-mortem"]);
    expect(JSON.parse(pm.stdout).meeting.participants).toEqual(["backend"]);
  });

  it("refuses a bad mode, a missing session id, and a missing install, writing nothing", async () => {
    const root = await installed();
    const bad = meetingCli(root, ["start", "--mode", "party", "--participants", "backend"]);
    expect(bad.code).toBe(1);
    expect(JSON.parse(bad.stdout).reason).toMatch(/--mode/);

    const noId = meetingCli(root, ["start", "--participants", "backend"], null);
    expect(noId.code).toBe(1);
    expect(JSON.parse(noId.stdout).reason).toMatch(/CLAUDE_CODE_SESSION_ID/);
    expect(fs.existsSync(path.join(root, ".claude", "maestro_sessions"))).toBe(false);

    const bare = path.join(tmp, "bare");
    fs.mkdirSync(bare);
    const missing = meetingCli(bare, ["start", "--participants", "backend"]);
    expect(missing.code).toBe(1);
    expect(JSON.parse(missing.stdout).reason).toMatch(/maestro-install/);
    expect(fs.existsSync(path.join(bare, ".claude", "maestro_sessions"))).toBe(false);
  });

  it("refuses when maestro.json exists but the runtime was never installed", async () => {
    const bare = path.join(tmp, "configonly");
    fs.mkdirSync(bare);
    writeConfig(bare, CFG);
    const r = meetingCli(bare, ["start", "--participants", "backend"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).ok).toBe(false);
    expect(fs.existsSync(path.join(bare, ".claude", "maestro_sessions"))).toBe(false);
  });

  it("refuses on a stale install whose copied hooks predate meeting mode", async () => {
    for (const name of ["maestro-inject-agent-context.cjs", "maestro-subagent-log.cjs"]) {
      const root = await installed();
      const f = path.join(root, ".claude", "scripts", name);
      fs.writeFileSync(f, fs.readFileSync(f, "utf8").replaceAll("meetingFor", "legacyName"));
      const r = meetingCli(root, ["start", "--participants", "backend"]);
      expect(r.code, name).toBe(1);
      const out = JSON.parse(r.stdout);
      expect(out.ok).toBe(false);
      expect(out.reason).toMatch(/maestro-update/);
      expect(fs.existsSync(statePath(root)) ? readState(root).meeting : undefined).toBeUndefined();
      fs.rmSync(path.join(tmp, "p"), { recursive: true, force: true });
    }
  });

  it("refuses on a stale install whose rendered HANDOFFS table no longer matches maestro.json", async () => {
    const root = await installed();
    const cfg = JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8"));
    cfg.workflows = cfg.workflows.filter((w: { name: string }) => w.name !== "docs");
    fs.writeFileSync(path.join(root, ".claude", "maestro.json"), JSON.stringify(cfg, null, 2));
    const r = meetingCli(root, ["start", "--participants", "backend"]);
    expect(r.code).toBe(1);
    expect(JSON.parse(r.stdout).reason).toMatch(/maestro-update/);
  });

  it("brief, conflicts and tally run against a started meeting and refuse without one", async () => {
    const root = await installed();
    expect(meetingCli(root, ["conflicts"]).code).toBe(1);
    setWorkflow(root);
    const m = startMeetingFor(root, ["backend", "frontend"]);

    const brief = meetingCli(root, ["brief"]);
    expect(brief.code, brief.stdout + brief.stderr).toBe(0);
    const b = JSON.parse(brief.stdout);
    expect(fs.readFileSync(b.brief, "utf8")).toContain(m.id);
    expect(Object.keys(b.slices).sort()).toEqual(["backend", "frontend"]);

    const r1 = path.join(m.dir, "round-1");
    fs.mkdirSync(r1, { recursive: true });
    fs.writeFileSync(
      path.join(r1, "backend.json"),
      JSON.stringify({
        agent: "backend",
        proposals: [{ kind: "skill.placement", target: "instance:backend#expressjs", change: "reference it" }],
      })
    );
    fs.writeFileSync(
      path.join(r1, "frontend.json"),
      JSON.stringify({
        agent: "frontend",
        proposals: [{ kind: "skill.placement", target: "instance:backend#expressjs", change: "drop it" }],
      })
    );
    fs.writeFileSync(path.join(r1, "scribe.json"), "{not json");
    const c = JSON.parse(meetingCli(root, ["conflicts"]).stdout);
    expect(c.conflicts.map((x: { target: string }) => x.target)).toEqual(["instance:backend#expressjs"]);
    expect(c.rebuttalAgents).toEqual(["backend", "frontend"]);
    expect(c.errors.join("\n")).toMatch(/scribe\.json: not valid JSON/);

    const t = JSON.parse(meetingCli(root, ["tally"]).stdout);
    expect(t.counts).toEqual({ auto: 0, approval: 2, blocked: 0 });
    expect(fs.existsSync(path.join(m.dir, "decision.md"))).toBe(true);
  });
});

// ── 9. post-mortem digest, workflow delete, bundle surface ─────────────────

describe("leak 9 — post-mortem digest, workflow delete, and the maestro-session bundle", () => {
  it("the digest leaves meeting runs out of the timeline and outcomes, and counts them apart", async () => {
    const root = await installed();
    setWorkflow(root);
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "wf-b"));
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "wf-b", "ok\nHANDOFF: success"));
    startMeetingFor(root, ["backend", "frontend"]);
    // backend RESUMED in the meeting under the same agent_id, plus a fresh frontend turn.
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "wf-b"));
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "wf-b", "MEETING-REPLY-B\nHANDOFF: failure"));
    hook(root, "maestro-subagent-log.cjs", start(root, "frontend", "mt-f"));
    hook(root, "maestro-subagent-log.cjs", stop(root, "frontend", "mt-f", "MEETING-REPLY-F"));

    const j = pluginCli(root, "maestro-post-mortem.js", [root, "--json"]);
    expect(j.code, j.stderr).toBe(0);
    const a = JSON.parse(j.stdout);
    expect(a.counts.dispatches).toBe(1);
    expect(a.counts.handoffs).toBe(1);
    expect(a.counts.meetingTurns).toBe(2);
    expect(a.meetingAgents.sort()).toEqual(["backend", "frontend"]);
    expect(JSON.stringify(a.outcomes)).not.toMatch(/failure/);
    expect(JSON.stringify(a.subagents)).not.toContain("MEETING-REPLY");
    expect(JSON.stringify(a.subagents)).not.toContain("mt-f");

    const md = pluginCli(root, "maestro-post-mortem.js", [root]);
    expect(md.code, md.stderr).toBe(0);
    expect(md.stdout).toMatch(/Team-meeting turns\*\* \(excluded from the timeline\): 2 \(/);
    expect(md.stdout).not.toContain("MEETING-REPLY");
  });

  it("the digest of a session with no meeting carries no meeting line", async () => {
    const root = await installed();
    setWorkflow(root);
    hook(root, "maestro-subagent-log.cjs", start(root, "backend", "wf-b"));
    hook(root, "maestro-subagent-log.cjs", stop(root, "backend", "wf-b"));
    const md = pluginCli(root, "maestro-post-mortem.js", [root]);
    expect(md.code).toBe(0);
    expect(md.stdout).not.toMatch(/Team-meeting turns/);
  });

  it("workflow delete removes one workflow, keeps the rest of maestro.json and re-renders", async () => {
    const root = await installed();
    const cfgPath = path.join(root, ".claude", "maestro.json");
    const before = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    const skill = path.join(root, ".claude", "skills", "maestro", "SKILL.md");
    expect(fs.readFileSync(skill, "utf8")).toMatch(/docs/);

    const r = projectCli(root, "maestro-workflow-spec.cjs", ["delete", "--name", "docs", root]);
    expect(r.code, r.stderr).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({ ok: true, mode: "delete", workflow: "docs", unplacedInstances: ["scribe"] });
    expect(out.render.ok).toBe(true);
    const after = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
    expect(after.workflows.map((w: { name: string }) => w.name)).toEqual(["build"]);
    expect({ ...after, workflows: before.workflows }).toEqual(before);
    expect(fs.readFileSync(cfgPath, "utf8").endsWith("\n")).toBe(false);
    const handoffs = /<!-- Maestro:HANDOFFS:START -->([\s\S]*?)<!-- Maestro:HANDOFFS:END -->/.exec(
      fs.readFileSync(skill, "utf8")
    )![1];
    expect(handoffs).toMatch(/build/);
    expect(handoffs).not.toMatch(/\bdocs\b/);
  });

  it("workflow delete refuses an unknown name and the last workflow, writing nothing", async () => {
    const root = await installed();
    const cfgPath = path.join(root, ".claude", "maestro.json");
    const unknown = projectCli(root, "maestro-workflow-spec.cjs", ["delete", "--name", "nope", root]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toMatch(/No workflow named "nope"/);
    expect(projectCli(root, "maestro-workflow-spec.cjs", ["delete", "--name", "docs", root]).code).toBe(0);
    const before = fs.readFileSync(cfgPath, "utf8");
    const last = projectCli(root, "maestro-workflow-spec.cjs", ["delete", "--name", "build", root]);
    expect(last.code).toBe(1);
    expect(last.stderr).toMatch(/only workflow/);
    expect(fs.readFileSync(cfgPath, "utf8")).toBe(before);
    const noName = projectCli(root, "maestro-workflow-spec.cjs", ["delete", root]);
    expect(noName.code).toBe(1);
  });

  it("maestro-session.cjs reaches no node:sqlite and keeps every export it had at HEAD", () => {
    const LIB = path.join(PLUGIN_SCRIPTS, "lib");
    const text = fs.readFileSync(path.join(LIB, "maestro-session.cjs"), "utf8");
    expect(text.match(/node:sqlite/g) ?? []).toHaveLength(0);

    const headText = execFileSync("git", ["show", "HEAD:plugins/maestro/scripts/lib/maestro-session.cjs"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    const headFile = path.join(tmp, "maestro-session.head.cjs");
    fs.writeFileSync(headFile, headText);
    const headExports = Object.keys(require(headFile));
    const nowExports = Object.keys(require(path.join(LIB, "maestro-session.cjs")));
    expect(headExports.length).toBeGreaterThan(0);
    expect(headExports.filter((n) => !nowExports.includes(n))).toEqual([]);
    for (const n of [
      "meetingFor",
      "meetingNotice",
      "meetingDirFor",
      "readMeeting",
      "startMeeting",
      "endMeeting",
      "withoutMeeting",
      "MEETING_DIR_NAME",
    ]) {
      expect(nowExports, n).toContain(n);
    }
  });

  it("maestro-team-meeting.cjs bundle reaches no node:sqlite and exports what the CLI requires", () => {
    const LIB = path.join(PLUGIN_SCRIPTS, "lib");
    const text = fs.readFileSync(path.join(LIB, "maestro-team-meeting.cjs"), "utf8");
    expect(text.match(/node:sqlite/g) ?? []).toHaveLength(0);
    const tm = require(path.join(LIB, "maestro-team-meeting.cjs"));
    const cli = fs.readFileSync(path.join(PLUGIN_SCRIPTS, "maestro-team-meeting.cjs"), "utf8");
    const used = [...new Set([...cli.matchAll(/\btm\.(\w+)/g)].map((m) => m[1]))];
    expect(used.length).toBeGreaterThan(0);
    for (const n of used) expect(typeof tm[n], n).not.toBe("undefined");
    const session = require(path.join(LIB, "maestro-session.cjs"));
    const destructured = /const \{([^}]+)\} = require\("\.\/lib\/maestro-session\.cjs"\)/.exec(cli)![1];
    for (const n of destructured
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)) {
      expect(typeof session[n], n).toBe("function");
    }
  });
});
