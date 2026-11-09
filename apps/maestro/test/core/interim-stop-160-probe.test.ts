// `160` QA probes, beyond the backend's own tests. Same harness as interim-stop-160.test.ts: the
// REAL installed SubagentStart/SubagentStop scripts and maestro-task-status.cjs run against a temp
// project and a pinned HOME/session id. Nothing mocked. Each probe names the sequence it drives.

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

vi.setConfig({ testTimeout: 30_000 });

const SESS = "sess-160-probe";
const SCOPE = "session-sess-160";

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
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-160-probe-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function projectScript(root: string, name: string, args: string[], input?: unknown) {
  const e: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: home, CLAUDE_CODE_SESSION_ID: SESS };
  const r = spawnSync("node", [path.join(root, ".claude", "scripts", name), ...args], {
    encoding: "utf8",
    env: e,
    ...(input !== undefined ? { input: JSON.stringify(input) } : {}),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const sessionDir = (root: string) => path.join(root, ".claude", "maestro_sessions", SESS);
const readState = (root: string): Record<string, any> => {
  const f = path.join(sessionDir(root), "session.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
};
const pendingInterim = (root: string): Record<string, any> => readState(root).pending_interim ?? {};
const readLog = (root: string): Record<string, any>[] => {
  const f = path.join(sessionDir(root), "log.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
};
const handoffEntries = (root: string, id: string) =>
  readLog(root).filter((e) => e.kind === "handoff" && e.agent_id === id);

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

const subagentStop = (root: string, agent: string, id: string, extra: Record<string, unknown>) =>
  projectScript(root, "maestro-subagent-log.cjs", [], {
    cwd: root,
    session_id: SESS,
    hook_event_name: "SubagentStop",
    agent_type: agent,
    agent_id: id,
    ...extra,
  });

const handoffIssues = (root: string) => projectScript(root, "maestro-task-status.cjs", ["handoff-issues"]);

const payloadFile = (root: string, receiver: string, sender: string, n = 1) =>
  path.join(root, ".claude", "channels", SCOPE, receiver, `${sender}.${n}.md`);
function writePayload(root: string, receiver: string, sender: string, n = 1) {
  fs.mkdirSync(path.dirname(payloadFile(root, receiver, sender, n)), { recursive: true });
  fs.writeFileSync(payloadFile(root, receiver, sender, n), "{}\n");
}

// ── transcripts: dated in 2099 so every entry reads as written after the hook's own dispatch ─────────
const L = (o: unknown) => JSON.stringify(o) + "\n";
const userPrompt = (promptId: string, text: string, ts: string) =>
  L({ type: "user", promptId, timestamp: ts, message: { role: "user", content: text } });
const assistantText = (text: string, ts: string) =>
  L({ type: "assistant", timestamp: ts, message: { content: [{ type: "text", text }] } });
const handbackCall = (report: string, ts: string) =>
  L({
    type: "assistant",
    timestamp: ts,
    message: { content: [{ type: "tool_use", id: "h", name: "SubagentHandback", input: { message: report } }] },
  });
const toolResult = (promptId: string, ts: string) =>
  L({
    type: "user",
    promptId,
    timestamp: ts,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "h", content: "Delivered." }] },
  });
const editCall = (file: string, ts: string) =>
  L({
    type: "assistant",
    timestamp: ts,
    message: {
      content: [
        { type: "tool_use", id: "e", name: "Edit", input: { file_path: file, old_string: "a", new_string: "b" } },
      ],
    },
  });
const subagentLabelled = (label: string) => `Done.\n"verdict": "SUCCESS"\nHANDOFF: ${label}`;

/** A run that stopped to wait on background work: working text, no hand-back call. */
const interimTranscript = (ts = "2099-10-01T10:00:00.000Z") =>
  userPrompt("P1", "implement it", ts) + assistantText("Build started in the background; waiting for it.", ts);
/** The same run, finished with a hand-back. */
const finalTranscript = (report: string) =>
  interimTranscript() + handbackCall(report, "2099-10-01T10:30:00.000Z") + toolResult("P1", "2099-10-01T10:30:01.000Z");

function stopWith(root: string, agent: string, id: string, body: string, name: string) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, body);
  return subagentStop(root, agent, id, { agent_transcript_path: file });
}

describe("probe 160: pending_interim bookkeeping across several agents", () => {
  it("two agents pending: resuming one clears only its marker; the other is flagged on the second check, never the first", async () => {
    const root = await installed();
    subagentStart(root, "backend", "a1");
    stopWith(root, "backend", "a1", interimTranscript(), "q-1.jsonl");
    // No SubagentStart for test: a dispatch would correctly mark backend moved on (covered elsewhere).
    stopWith(root, "test", "t1", interimTranscript(), "q-2.jsonl");
    expect(Object.keys(pendingInterim(root)).sort()).toEqual(["a1", "t1"]);

    const first = handoffIssues(root).stdout;
    expect(first).not.toContain("NO HANDOFF line");
    expect(first).toContain("not flagged yet");

    subagentStart(root, "backend", "a1"); // resume backend only
    expect(Object.keys(pendingInterim(root))).toEqual(["t1"]);
    const second = handoffIssues(root).stdout;
    expect(second).toContain("test: NO HANDOFF line");
    expect(second).not.toContain("backend: NO HANDOFF line");
    expect(pendingInterim(root)).toEqual({});
  });

  it("a judged stop of another agent that was already running does not move an interim marker on", async () => {
    const root = await installed();
    subagentStart(root, "scribe", "s1"); // running before the backend stops interim
    subagentStart(root, "backend", "a1");
    stopWith(root, "backend", "a1", interimTranscript(), "q-3.jsonl");
    // scribe finishes with a labelled hand-back; no new dispatch happened in between.
    const scribeStop = stopWith(root, "scribe", "s1", finalTranscript(subagentLabelled("success")), "q-4.jsonl");
    expect(scribeStop.stdout).not.toContain("problem");
    expect(pendingInterim(root).a1).toBeDefined();
    const first = handoffIssues(root).stdout;
    expect(first).not.toContain("NO HANDOFF line");
  });

  it("a nested subagent dispatched inside another agent's run is not the orchestrator moving on", async () => {
    // The pending marker's `moved_on` is set by ANY SubagentStart, including a generic Explore subagent
    // that a still-running agent spawns. The first check should not flag an interim agent that the
    // orchestrator has not dispatched past.
    const root = await installed();
    subagentStart(root, "backend", "a1");
    stopWith(root, "backend", "a1", interimTranscript(), "q-5.jsonl");
    subagentStart(root, "Explore", "x1");
    const first = handoffIssues(root).stdout;
    expect(first).not.toContain("NO HANDOFF line");
  });
});

describe("probe 160: settle paths", () => {
  it("a promoted (moved-on) marker is reported once, and a later resume of that agent leaves nothing behind", async () => {
    const root = await installed();
    writePayload(root, "test", "backend");
    subagentStart(root, "backend", "a1");
    stopWith(root, "backend", "a1", interimTranscript(), "q-6.jsonl");
    subagentStart(root, "test", "t1");
    expect(handoffIssues(root).stdout).toContain("backend: NO HANDOFF line");
    expect(handoffIssues(root).stdout).toContain("no problems recorded");

    subagentStart(root, "backend", "a1");
    const r = stopWith(root, "backend", "a1", finalTranscript(subagentLabelled("success")), "q-7.jsonl");
    expect(r.stdout).not.toContain("problem");
    const out = handoffIssues(root).stdout;
    expect(out).toContain("no problems recorded");
    expect(out).not.toContain("NO HANDOFF");
  });

  it("a resumed agent whose final hand-back is malformed gets one problem, not a duplicate 'no HANDOFF' from its earlier interim stop", async () => {
    const root = await installed();
    subagentStart(root, "backend", "a1");
    stopWith(root, "backend", "a1", interimTranscript(), "q-8.jsonl");
    subagentStart(root, "backend", "a1");
    const bad = finalTranscript('"verdict": "SUCCESS"\nHANDOFF success'); // no colon
    const r = stopWith(root, "backend", "a1", bad, "q-9.jsonl");
    expect(r.stdout).toContain("handoff problem");
    expect(pendingInterim(root)).toEqual({});
    const out = handoffIssues(root).stdout;
    expect(out).toMatch(/1 problem\(s\)/); // malformed is judged `missing`, one entry, not a second from the interim stop
    expect(out.match(/backend:/g)?.length).toBe(1);
    expect(handoffIssues(root).stdout).toContain("no problems recorded");
  });

  it("a loop-back resume of an agent whose cycle 1 ended in a judged success counts cycle 1's payload for cycle 2 (whole-run rule; judgement to confirm)", async () => {
    // Cycle 1: payload written, judged success. The orchestrator then loops back to the SAME agent id
    // (a resume, 039). Cycle 2 edits a file and writes no payload of its own. The whole-run rule
    // measures from the first dispatch, so cycle 1's test.1.md still satisfies cycle 2. This pins the
    // current behaviour so a change to it is deliberate; see the report for whether it should differ.
    const root = await installed();
    subagentStart(root, "backend", "a1");
    writePayload(root, "test", "backend");
    expect(
      stopWith(root, "backend", "a1", finalTranscript(subagentLabelled("success")), "q-10.jsonl").stdout
    ).not.toContain("problem");

    subagentStart(root, "backend", "a1");
    const cycle2 =
      finalTranscript(subagentLabelled("success")) +
      userPrompt("P2", "fix the failing test", "2099-10-02T09:00:00.000Z") +
      editCall("/tmp/x.ts", "2099-10-02T09:00:01.000Z") +
      handbackCall(subagentLabelled("success"), "2099-10-02T09:01:00.000Z") +
      toolResult("P2", "2099-10-02T09:01:01.000Z");
    const r = stopWith(root, "backend", "a1", cycle2, "q-11.jsonl");
    expect(r.stdout).not.toContain("problem");
    expect(handoffEntries(root, "a1").at(-1)?.handoff_issue).toBeUndefined();
  });
});
