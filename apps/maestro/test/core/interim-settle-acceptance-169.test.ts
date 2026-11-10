// 169 acceptance, on the real hooks. Drives the real SubagentStart, SubagentStop and handoff-issues
// scripts (and the real post-mortem digest) into a temp project, no mocks. What it adds to the other
// 169/165 files: the late hand-back path end to end (the transcript gets its hand-back AFTER the stop),
// resume cycles around a settle record, the mid-session digest across each handoff-check state, a
// pre-169 log shape, and a handoff-issues run with no resolvable session. The unit edges of
// settleInterimStops/interimSettleEntry live in interim-settle-record-169.test.ts; the combined run and
// the single-settle dedupe live in post-mortem-dedupe-165.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const DIGEST = path.join(PLUGIN_ROOT, "scripts", "maestro-post-mortem.js");

vi.setConfig({ testTimeout: 30_000 });

const SESS = "sess-169-acc";
const INTERIM_NOTE = "inferred from the log: interim stop never followed by a final stop";

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
      ],
    },
  ],
  rules: [],
} as unknown as MaestroConfigV3;

let tmp: string;
let home: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-169-acc-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── real hooks ────────────────────────────────────────────────────────────────────────────────────

// HOME and CLAUDE_CODE_SESSION_ID are pinned per spawn, never inherited (064).
function env(root: string, withSession = true): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: home };
  if (withSession) e.CLAUDE_CODE_SESSION_ID = SESS;
  else delete e.CLAUDE_CODE_SESSION_ID;
  return e;
}

function projectScript(root: string, name: string, args: string[], input?: unknown, withSession = true) {
  const r = spawnSync("node", [path.join(root, ".claude", "scripts", name), ...args], {
    encoding: "utf8",
    env: env(root, withSession),
    ...(input !== undefined ? { input: JSON.stringify(input) } : {}),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
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
  return root;
}

const subagentStart = (root: string, agent: string, id: string) =>
  projectScript(root, "maestro-subagent-log.cjs", [], {
    cwd: root,
    session_id: SESS,
    hook_event_name: "SubagentStart",
    agent_type: agent,
    agent_id: id,
  });

// The transcript lives at a fixed path so a test can append a hand-back to it after the stop.
function transcriptPath(name: string): string {
  return path.join(tmp, name);
}

function stopWith(root: string, agent: string, id: string, transcriptBody: string, name: string) {
  const file = transcriptPath(name);
  fs.writeFileSync(file, transcriptBody);
  return projectScript(root, "maestro-subagent-log.cjs", [], {
    cwd: root,
    session_id: SESS,
    hook_event_name: "SubagentStop",
    agent_type: agent,
    agent_id: id,
    agent_transcript_path: file,
  });
}

const handoffIssues = (root: string) => projectScript(root, "maestro-task-status.cjs", ["handoff-issues"]);

const L = (o: unknown) => JSON.stringify(o) + "\n";
const userPrompt = (ts: string) =>
  L({ type: "user", promptId: "P1", timestamp: ts, message: { role: "user", content: "implement it" } });
const assistantText = (text: string, ts: string) =>
  L({ type: "assistant", timestamp: ts, message: { content: [{ type: "text", text }] } });
const handbackCall = (report: string, ts: string) =>
  L({
    type: "assistant",
    timestamp: ts,
    message: { content: [{ type: "tool_use", id: "h", name: "SubagentHandback", input: { message: report } }] },
  });
const toolResult = (ts: string) =>
  L({
    type: "user",
    promptId: "P1",
    timestamp: ts,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "h", content: "Delivered." }] },
  });
// Dated far ahead so every entry reads as written after the hook's own dispatch (see 153).
const interimTranscript = () =>
  userPrompt("2099-11-01T10:00:00.000Z") +
  assistantText("Build started in the background; waiting.", "2099-11-01T10:00:00.000Z");
const finalTranscript = (report: string) =>
  interimTranscript() + handbackCall(report, "2099-11-01T10:30:00.000Z") + toolResult("2099-11-01T10:30:01.000Z");
// A hand-back that reaches the transcript only after the stop was logged (the late case).
const appendLateHandback = (name: string, report: string) =>
  fs.appendFileSync(
    transcriptPath(name),
    handbackCall(report, "2099-11-01T10:30:00.000Z") + toolResult("2099-11-01T10:30:01.000Z")
  );
const OK = '"verdict": "SUCCESS"\nHANDOFF: success';
const BAD = '"verdict": "FAIL"\nHANDOFF: success';

function digestLog(root: string): Record<string, any> {
  const r = spawnSync("node", [DIGEST, root, "--session", SESS, "--json"], { encoding: "utf8", env: env(root) });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
}

function digestMarkdown(root: string): string {
  const r = spawnSync("node", [DIGEST, root, "--session", SESS], { encoding: "utf8", env: env(root) });
  expect(r.status, r.stderr).toBe(0);
  return r.stdout;
}

function logPath(root: string): string {
  return path.join(root, ".claude", "maestro_sessions", SESS, "log.jsonl");
}

function realLog(root: string): Record<string, any>[] {
  return fs
    .readFileSync(logPath(root), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

function writeLog(root: string, entries: Record<string, unknown>[]) {
  fs.writeFileSync(logPath(root), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
}

const settles = (root: string) => realLog(root).filter((e) => e.kind === "interim_settled");

describe("a late hand-back settles the stop as late_handback, once (169)", () => {
  it("a valid hand-back that lands after the interim stop is the run's outcome and writes one record", async () => {
    const root = await installed();
    subagentStart(root, "test", "L1");
    expect(stopWith(root, "test", "L1", interimTranscript(), "late-1.jsonl").code).toBe(0);
    // The hand-back reaches the transcript only now, after the stop was logged.
    appendLateHandback("late-1.jsonl", OK);

    // The first check already reads the landed hand-back (before its seen/moved-on logic): settled.
    expect(handoffIssues(root).stdout).toContain("no problems recorded");
    expect(handoffIssues(root).stdout).toContain("no problems recorded");
    expect(handoffIssues(root).stdout).toContain("no problems recorded");

    const s = settles(root);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ agent: "test", agent_id: "L1", settled_as: "late_handback", label: "success" });
    expect(s[0].handoff_issue).toBeUndefined();

    const a = digestLog(root);
    expect(a.outcomes).toEqual({ success: 1 });
    expect(a.problems).toEqual([]);
    expect(a.pending).toEqual([]);
    expect(a.subagents[0]).toMatchObject({ agent_id: "L1", settled: "late_handback", label: "success" });
    expect(a.subagents[0].settled_at).toBe(s[0].ts);
  });

  it("a late hand-back the handoff check rejects settles as late_handback carrying its issue, and is not recorded twice", async () => {
    const root = await installed();
    subagentStart(root, "test", "L2");
    stopWith(root, "test", "L2", interimTranscript(), "late-2.jsonl");
    appendLateHandback("late-2.jsonl", BAD);

    const first = handoffIssues(root);
    expect(first.stdout).toContain("test: verdict FAIL but HANDOFF: success");
    expect(handoffIssues(root).stdout).toContain("no problems recorded");

    const s = settles(root);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ agent_id: "L2", settled_as: "late_handback", label: "success" });
    expect(s[0].handoff_issue).toMatchObject({ kind: "contradiction" });

    // The digest's timeline names the judgement on the settled stop.
    expect(digestMarkdown(root)).toContain("judged contradiction");
    // The judged late hand-back is tallied under its issue kind and listed under Problems.
    const a = digestLog(root);
    expect(a.outcomes).toEqual({ contradiction: 1 });
    expect(a.problems.map((p: { agent_id: string }) => p.agent_id)).toEqual(["L2"]);
    expect(digestMarkdown(root)).toMatch(
      /`L2` → contradiction \(from the settle record: [^)]*\): The subagent's report verdict is FAIL/
    );
  });
});

describe("a judged issue on the final outcome is the run's outcome, on time or late (post-mortem)", () => {
  it("an on-time hand-back the stop hook judges a contradiction is tallied contradiction, not success", async () => {
    const root = await installed();
    subagentStart(root, "test", "J1");
    expect(stopWith(root, "test", "J1", finalTranscript(BAD), "j1.jsonl").code).toBe(0);
    const h = realLog(root).filter((e) => e.kind === "handoff");
    expect(h[0].handoff_issue).toMatchObject({ kind: "contradiction" });

    const a = digestLog(root);
    expect(a.outcomes).toEqual({ contradiction: 1 });
    expect(a.problems).toHaveLength(1);
    expect(a.subagents[0]).toMatchObject({ agent_id: "J1", label: "success", handoff_issue: "contradiction" });
    const md = digestMarkdown(root);
    expect(md).toMatch(/## Problems[\s\S]*`J1` → contradiction: The subagent's report verdict is FAIL/);
    expect(md).toContain("⚠️ judged contradiction");
    expect(md).toMatch(/Handoff outcomes\*\*: .*contradiction: 1/);
  });

  it("a judged stop resumed to a clean hand-back is superseded: only the final success counts", async () => {
    const root = await installed();
    subagentStart(root, "test", "J2");
    stopWith(root, "test", "J2", finalTranscript(BAD), "j2-a.jsonl");
    subagentStart(root, "test", "J2");
    expect(stopWith(root, "test", "J2", finalTranscript(OK), "j2-b.jsonl").code).toBe(0);

    const a = digestLog(root);
    expect(a.outcomes).toEqual({ success: 1 });
    expect(a.problems).toEqual([]);
    expect(a.subagents[0].handoff_issue).toBeUndefined();
  });

  it("a late judged hand-back the run resumes past cleanly is superseded by the final success", async () => {
    const root = await installed();
    subagentStart(root, "test", "L3");
    stopWith(root, "test", "L3", interimTranscript(), "l3-a.jsonl");
    appendLateHandback("l3-a.jsonl", BAD);
    handoffIssues(root);
    expect(settles(root)).toHaveLength(1);
    expect(settles(root)[0].handoff_issue).toMatchObject({ kind: "contradiction" });

    subagentStart(root, "test", "L3");
    expect(stopWith(root, "test", "L3", finalTranscript(OK), "l3-b.jsonl").code).toBe(0);

    const a = digestLog(root);
    expect(a.outcomes).toEqual({ success: 1 });
    expect(a.problems).toEqual([]);
    expect(a.subagents[0].handoff_issue).toBeUndefined();
    expect(digestMarkdown(root)).not.toContain("contradiction");
  });

  it("a late hand-back that no condition edge handles settles as unrouted, listed under Problems with its message", async () => {
    const root = await installed();
    // The route check needs an active workflow (160): render the orchestrator, then set the session's.
    execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: home },
    });
    const set = projectScript(root, "maestro-set-session-workflow.cjs", ["feature"]);
    expect(set.code, set.stdout + set.stderr).toBe(0);

    subagentStart(root, "test", "U1");
    stopWith(root, "test", "U1", interimTranscript(), "u1.jsonl");
    appendLateHandback("u1.jsonl", '"verdict": "SUCCESS"\nHANDOFF: partial');
    handoffIssues(root);

    const s = settles(root);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ agent_id: "U1", settled_as: "late_handback", label: "partial" });
    expect(s[0].handoff_issue).toMatchObject({ kind: "unrouted", label: "partial" });

    const a = digestLog(root);
    expect(a.outcomes).toEqual({ unrouted: 1 });
    expect(a.problems.map((p: { agent_id: string }) => p.agent_id)).toEqual(["U1"]);
    expect(digestMarkdown(root)).toMatch(
      /## Problems[\s\S]*`U1` → unrouted \(from the settle record: hand-back landed after the stop\): The subagent ended HANDOFF: partial, which no condition edge in workflow "feature" handles/
    );
  });

  it("an on-time success with its payload never written is tallied and listed as missing_payload", async () => {
    const root = await installed();
    subagentStart(root, "backend", "P9");
    // backend's success route to test expects a payload; none is written, so the stop hook judges it.
    expect(stopWith(root, "backend", "P9", finalTranscript(OK), "p9.jsonl").code).toBe(0);
    const h = realLog(root).filter((e) => e.kind === "handoff" && e.agent_id === "P9");
    expect(h[0].handoff_issue).toMatchObject({ kind: "missing_payload" });

    const a = digestLog(root);
    expect(a.outcomes).toEqual({ missing_payload: 1 });
    expect(a.problems.map((p: { agent_id: string }) => p.agent_id)).toEqual(["P9"]);
    expect(digestMarkdown(root)).toMatch(/`P9` → missing_payload: /);
  });
});

describe("a settle record is read only against the run's last stop (169)", () => {
  it("settled missing, then resumed and finished: the record is overtaken and the run is a success", async () => {
    const root = await installed();
    subagentStart(root, "test", "R1");
    stopWith(root, "test", "R1", interimTranscript(), "r1-a.jsonl");
    handoffIssues(root);
    handoffIssues(root);
    expect(settles(root)).toHaveLength(1);

    subagentStart(root, "test", "R1");
    expect(stopWith(root, "test", "R1", finalTranscript(OK), "r1-b.jsonl").code).toBe(0);

    expect(settles(root)).toHaveLength(1);
    const a = digestLog(root);
    expect(a.outcomes).toEqual({ success: 1 });
    expect(a.problems).toEqual([]);
    expect(a.subagents[0].settled).toBeNull();
  });

  it("settled missing, resumed and stopped interim again: pending until a second settle writes a second record", async () => {
    const root = await installed();
    subagentStart(root, "test", "R2");
    stopWith(root, "test", "R2", interimTranscript(), "r2-a.jsonl");
    handoffIssues(root);
    handoffIssues(root);
    expect(settles(root)).toHaveLength(1);

    subagentStart(root, "test", "R2");
    stopWith(root, "test", "R2", interimTranscript(), "r2-b.jsonl");
    // The first record is older than this stop, so the new stop is not settled and not missing.
    const mid = digestLog(root);
    expect(mid.outcomes).toEqual({ "interim stop, not settled yet": 1 });
    expect(mid.problems).toEqual([]);
    expect(mid.pending.map((p: { agent_id: string }) => p.agent_id)).toEqual(["R2"]);

    handoffIssues(root);
    handoffIssues(root);
    const s = settles(root);
    expect(s).toHaveLength(2);
    expect(s.map((e) => e.settled_as)).toEqual(["missing", "missing"]);
    expect(digestLog(root).outcomes).toEqual({ "missing HANDOFF": 1 });
  });
});

describe("the mid-session digest over the real hooks (169)", () => {
  it("a stamped interim stop with no settle record is pending, not missing, and no record is written", async () => {
    const root = await installed();
    subagentStart(root, "test", "P1");
    expect(stopWith(root, "test", "P1", interimTranscript(), "p1.jsonl").code).toBe(0);

    const md = digestMarkdown(root);
    expect(md).toContain("## Pending (interim stop, not settled yet)");
    expect(md).not.toContain("missing HANDOFF");
    const a = digestLog(root);
    expect(a.outcomes).toEqual({ "interim stop, not settled yet": 1 });
    expect(a.problems).toEqual([]);
    expect(a.pending.map((p: { agent_id: string }) => p.agent_id)).toEqual(["P1"]);
    expect(settles(root)).toHaveLength(0);
  });

  it("after one handoff check has only marked the stop seen, it is still pending and still has no record", async () => {
    const root = await installed();
    subagentStart(root, "test", "P2");
    stopWith(root, "test", "P2", interimTranscript(), "p2.jsonl");
    expect(handoffIssues(root).stdout).toContain("not flagged yet");

    expect(digestLog(root).outcomes).toEqual({ "interim stop, not settled yet": 1 });
    expect(settles(root)).toHaveLength(0);
  });

  it("a later final stop supersedes the pending stop: a success, no record", async () => {
    const root = await installed();
    subagentStart(root, "test", "P3");
    stopWith(root, "test", "P3", interimTranscript(), "p3-a.jsonl");
    handoffIssues(root);

    subagentStart(root, "test", "P3");
    expect(stopWith(root, "test", "P3", finalTranscript(OK), "p3-b.jsonl").code).toBe(0);

    const a = digestLog(root);
    expect(a.outcomes).toEqual({ success: 1 });
    expect(a.pending).toEqual([]);
    expect(a.problems).toEqual([]);
    expect(handoffIssues(root).stdout).toContain("no problems recorded");
    expect(settles(root)).toHaveLength(0);
  });
});

describe("a pre-169 log is read with the existing inference (169)", () => {
  it("unstamped interim stops and no settle records: the stop is inferred missing, a resumed run is unaffected", async () => {
    const root = await installed();
    subagentStart(root, "backend", "a1");
    stopWith(root, "backend", "a1", interimTranscript(), "pre-a1-1.jsonl");
    subagentStart(root, "backend", "a1");
    // backend's success route to test expects a payload: write it as a real run does, so the stop
    // hook judges no `missing_payload` (the digest tallies a judged run under its issue kind).
    const lane = path.join(root, ".claude", "channels", `session-${SESS.slice(0, 8)}`, "test");
    fs.mkdirSync(lane, { recursive: true });
    fs.writeFileSync(path.join(lane, "backend.1.md"), "{}\n");
    stopWith(root, "backend", "a1", finalTranscript(OK), "pre-a1-2.jsonl");
    subagentStart(root, "test", "m1");
    stopWith(root, "test", "m1", interimTranscript(), "pre-m1.jsonl");

    // Rewrite the log as the pre-169 writer left it: no `settles_in_log` stamp, no settle records.
    writeLog(
      root,
      realLog(root).map((e) => {
        const old = { ...e };
        delete old.settles_in_log;
        return old;
      })
    );
    expect(realLog(root).filter((e) => e.kind === "interim_settled")).toHaveLength(0);
    expect(realLog(root).some((e) => e.settles_in_log === true)).toBe(false);

    const a = digestLog(root);
    expect(a.outcomes).toEqual({ success: 1, "missing HANDOFF": 1 });
    expect(a.pending).toEqual([]);
    expect(a.problems.map((p: { agent_id: string }) => p.agent_id)).toEqual(["m1"]);
    expect(a.subagents.find((s: { agent_id: string }) => s.agent_id === "m1")).toMatchObject({ inferred: true });
    expect(digestMarkdown(root)).toContain(INTERIM_NOTE);
  });
});

describe("handoff-issues with no resolvable session (169)", () => {
  it("writes no settle record anywhere and does not fail", async () => {
    const root = await installed();
    subagentStart(root, "test", "N1");
    stopWith(root, "test", "N1", interimTranscript(), "n1.jsonl");
    const before = fs.readFileSync(logPath(root), "utf8");

    const r = projectScript(root, "maestro-task-status.cjs", ["handoff-issues"], undefined, false);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("no problems recorded");
    expect(fs.readFileSync(logPath(root), "utf8")).toBe(before);
    expect(settles(root)).toHaveLength(0);
  });
});
