// `160` through the REAL SubagentStop script: an agent's interim stop (it stopped to wait on
// background work and is resumed later) must not record a hand-back issue, and the payload check
// measures from the start of the WHOLE agent run, across resumes. The sequences reproduce the two
// false modes seen in the code-graph repo (task 075): an interim stop flagged `missing`, and a final
// `success` whose payload was written before the latest resume flagged `missing_payload`.
// Temp projects, a temp HOME, nothing mocked.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { isInterimStop } from "../../src/core/handoff-label.js";
import { agentRunStartedAt, runStartedAt } from "../../src/core/handoff-payload.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

vi.setConfig({ testTimeout: 30_000 });

const SESS = "sess-160-aaaa";
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
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-160-")));
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
const readState = (root: string) => {
  const f = path.join(sessionDir(root), "session.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
};
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
const pendingIssues = (root: string): unknown[] => readState(root).handoff_issues ?? [];

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

const payloadFile = (root: string, receiver: string, sender: string) =>
  path.join(root, ".claude", "channels", SCOPE, receiver, `${sender}.1.md`);
function writePayload(root: string, receiver: string, sender: string) {
  fs.mkdirSync(path.dirname(payloadFile(root, receiver, sender)), { recursive: true });
  fs.writeFileSync(payloadFile(root, receiver, sender), "{}\n");
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── transcripts: dated far ahead so every entry reads as written after the hook's own dispatch ──────
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

/** A run that stopped to wait on background work: working text, no hand-back call. */
const interimTranscript = (ts = "2099-10-01T10:00:00.000Z") =>
  userPrompt("P1", "implement it", ts) + assistantText("Build started in the background; waiting for it.", ts);
/** A run that handed back. */
const finalTranscript = (report: string) =>
  interimTranscript() + handbackCall(report, "2099-10-01T10:30:00.000Z") + toolResult("P1", "2099-10-01T10:30:01.000Z");

const OK = '"verdict": "SUCCESS"\nHANDOFF: success';

function stopWith(root: string, agent: string, id: string, transcriptBody: string, name: string) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, transcriptBody);
  return subagentStop(root, agent, id, { agent_transcript_path: file });
}

describe("an interim stop records no hand-back issue (160)", () => {
  it("three interim stops with no HANDOFF line: nothing in session.json, nothing in the log, no systemMessage", async () => {
    const root = await installed();
    for (let i = 0; i < 3; i++) {
      subagentStart(root, "backend", "a7d80d9d");
      const r = stopWith(root, "backend", "a7d80d9d", interimTranscript(), `interim-${i}.jsonl`);
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).not.toContain("handoff problem");
    }
    expect(pendingIssues(root)).toEqual([]);
    const entries = handoffEntries(root, "a7d80d9d");
    expect(entries).toHaveLength(3);
    for (const e of entries) {
      expect(e.handoff_issue).toBeUndefined();
      expect(e.interim).toBe(true);
      expect(e.log).not.toContain("[missing");
    }
  }, 40_000);

  it("an interim stop that carries a last_assistant_message without a HANDOFF line is not flagged either", async () => {
    const root = await installed();
    subagentStart(root, "backend", "b1");
    const file = path.join(tmp, "interim-msg.jsonl");
    fs.writeFileSync(file, interimTranscript());
    const r = subagentStop(root, "backend", "b1", {
      agent_transcript_path: file,
      last_assistant_message: "Waiting for the background build to finish.",
    });
    expect(r.stdout).not.toContain("handoff problem");
    expect(pendingIssues(root)).toEqual([]);
    expect(handoffEntries(root, "b1")[0].handoff_issue).toBeUndefined();
  }, 20_000);

  it("the reviewer sequence: interim stop, then the resumed run finishes with success, and no issue ever exists", async () => {
    const root = await installed();
    subagentStart(root, "test", "a66e4858");
    expect(stopWith(root, "test", "a66e4858", interimTranscript(), "rev-1.jsonl").stdout).not.toContain("problem");
    subagentStart(root, "test", "a66e4858");
    const done = stopWith(root, "test", "a66e4858", finalTranscript(OK), "rev-2.jsonl");
    expect(done.stdout).not.toContain("problem");
    expect(pendingIssues(root)).toEqual([]);
    expect(handoffEntries(root, "a66e4858").map((e) => e.handoff_issue)).toEqual([undefined, undefined]);
  }, 40_000);

  it("the pure signal: no hand-back call in the current run is interim; a labelless call is not", () => {
    expect(isInterimStop(interimTranscript())).toBe(true);
    expect(isInterimStop(finalTranscript(OK))).toBe(false);
    expect(isInterimStop(finalTranscript("done, no line"))).toBe(false);
    // a resumed run whose resume prompt flushed but which has not handed back yet is interim,
    // even though the EARLIER run's hand-back is in the file
    const resumedBehind =
      finalTranscript(OK) +
      L({
        type: "user",
        promptId: "P2",
        isMeta: true,
        origin: { kind: "coordinator" },
        timestamp: "2099-10-01T11:00:00.000Z",
        message: { role: "user", content: "The coordinator sent a message while you were working: go on" },
      }) +
      assistantText("waiting on the build", "2099-10-01T11:00:05.000Z");
    expect(isInterimStop(resumedBehind)).toBe(true);
  });
});

describe("a FINAL stop is still judged (160)", () => {
  it("a final hand-back with no HANDOFF line is flagged missing", async () => {
    const root = await installed();
    subagentStart(root, "backend", "b1");
    const r = stopWith(root, "backend", "b1", finalTranscript("Implemented it, no label."), "final-nolabel.jsonl");
    expect(r.stdout).toContain("handoff problem (missing)");
    expect(handoffEntries(root, "b1")[0].handoff_issue).toMatchObject({ kind: "missing" });
    expect(pendingIssues(root)).toHaveLength(1);
  });

  it("a final message with no HANDOFF line and no transcript to read is still flagged missing", async () => {
    const root = await installed();
    subagentStart(root, "backend", "b1");
    const r = subagentStop(root, "backend", "b1", { last_assistant_message: "all done" });
    expect(r.stdout).toContain("handoff problem (missing)");
  });

  it("a FAIL verdict with HANDOFF: success is flagged as a contradiction", async () => {
    const root = await installed();
    subagentStart(root, "backend", "b1");
    const r = stopWith(
      root,
      "backend",
      "b1",
      finalTranscript('"verdict": "FAIL"\nHANDOFF: success'),
      "final-bad.jsonl"
    );
    expect(r.stdout).toContain("handoff problem (contradiction)");
  });

  it("an unknown route in the active workflow is flagged unrouted", async () => {
    const root = await installed();
    execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: home },
    });
    const set = projectScript(root, "maestro-set-session-workflow.cjs", ["feature"]);
    expect(set.code, set.stdout + set.stderr).toBe(0);
    subagentStart(root, "test", "t1");
    const r = stopWith(
      root,
      "test",
      "t1",
      finalTranscript('"verdict": "SUCCESS"\nHANDOFF: partial'),
      "final-route.jsonl"
    );
    expect(r.stdout).toContain("handoff problem (unrouted)");
  });

  it("a payload never written in the whole run (interim, resume, final success) is flagged missing_payload", async () => {
    const root = await installed();
    subagentStart(root, "backend", "b1");
    expect(stopWith(root, "backend", "b1", interimTranscript(), "np-1.jsonl").stdout).not.toContain("problem");
    subagentStart(root, "backend", "b1");
    const r = stopWith(root, "backend", "b1", finalTranscript(OK), "np-2.jsonl");
    expect(r.stdout).toContain("handoff problem (missing_payload)");
  }, 20_000);
});

describe("the payload check measures from the start of the whole run (160)", () => {
  it("a payload written before the latest resume counts for the final success", async () => {
    const root = await installed();
    subagentStart(root, "backend", "a7d80d9d"); // first dispatch
    writePayload(root, "test", "backend"); // written in the first stretch
    stopWith(root, "backend", "a7d80d9d", interimTranscript(), "w-1.jsonl"); // interim: judged in its own tests
    await sleep(1400); // past the 1 s mtime slack, so the file predates the resume's dispatch
    subagentStart(root, "backend", "a7d80d9d"); // the resume: a fresh dispatch entry, same agent id
    const r = stopWith(root, "backend", "a7d80d9d", finalTranscript(OK), "w-2.jsonl");
    expect(r.stdout).not.toContain("missing_payload");
    expect(pendingIssues(root)).toEqual([]);
  }, 30_000);

  it("a file left from BEFORE the agent's first dispatch still does not count", async () => {
    const root = await installed();
    writePayload(root, "test", "backend");
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(payloadFile(root, "test", "backend"), old, old);
    subagentStart(root, "backend", "b9");
    expect(stopWith(root, "backend", "b9", interimTranscript(), "o-1.jsonl").stdout).not.toContain("problem");
    subagentStart(root, "backend", "b9");
    const r = stopWith(root, "backend", "b9", finalTranscript(OK), "o-2.jsonl");
    expect(r.stdout).toContain("handoff problem (missing_payload)");
  }, 20_000);

  it("agentRunStartedAt is the FIRST dispatch of the agent id, runStartedAt the last", () => {
    const lines = [
      { kind: "dispatch", agent_id: "x", ts: "2026-11-07T10:00:00.000Z" },
      { kind: "dispatch", agent_id: "y", ts: "2026-11-07T10:30:00.000Z" },
      { kind: "handoff", agent_id: "x", ts: "2026-11-07T10:40:00.000Z" },
      { kind: "dispatch", agent_id: "x", ts: "2026-11-07T11:00:00.000Z" },
    ];
    expect(agentRunStartedAt(lines, "x")).toBe(Date.parse("2026-11-07T10:00:00.000Z"));
    expect(runStartedAt(lines, "x")).toBe(Date.parse("2026-11-07T11:00:00.000Z"));
    expect(agentRunStartedAt(lines, "nobody")).toBeNull();
    expect(agentRunStartedAt(lines, "")).toBeNull();
  });
});

// ── the deferred judgement: pending_interim, cleared by a resume, promoted when nothing resumed it ──
const handoffIssues = (root: string) => projectScript(root, "maestro-task-status.cjs", ["handoff-issues"]);
const pendingInterim = (root: string): Record<string, any> => readState(root).pending_interim ?? {};

describe("an interim stop is judged at the run's final stop (160)", () => {
  it("an interim stop is recorded as pending, with no issue and the interim marker on the log entry", async () => {
    const root = await installed();
    subagentStart(root, "backend", "a1");
    stopWith(root, "backend", "a1", interimTranscript(), "p-1.jsonl");
    expect(Object.keys(pendingInterim(root))).toEqual(["a1"]);
    expect(pendingIssues(root)).toEqual([]);
    expect(handoffEntries(root, "a1")[0]).toMatchObject({ interim: true });
  });

  it("a plain-text final with no hand-back call and no HANDOFF line is flagged missing once the orchestrator moves on", async () => {
    const root = await installed();
    subagentStart(root, "backend", "a1");
    stopWith(root, "backend", "a1", interimTranscript(), "p-2.jsonl");
    subagentStart(root, "test", "t1"); // the orchestrator dispatched the next agent
    const seen = handoffIssues(root);
    expect(seen.stdout).toContain("backend: NO HANDOFF line");
    expect(pendingInterim(root)).toEqual({});
    expect(handoffIssues(root).stdout).toContain("no problems recorded"); // read-and-clear
  });

  it("an agent that stops once and is never resumed is flagged on the second handoff check", async () => {
    const root = await installed();
    subagentStart(root, "backend", "a1");
    stopWith(root, "backend", "a1", interimTranscript(), "p-3.jsonl");
    const first = handoffIssues(root);
    expect(first.stdout).not.toContain("NO HANDOFF line");
    expect(first.stdout).toContain("not flagged yet");
    expect(handoffIssues(root).stdout).toContain("backend: NO HANDOFF line");
  });

  it("an interim stop that is resumed and finishes with a valid hand-back leaves no flag behind", async () => {
    const root = await installed();
    subagentStart(root, "backend", "a1");
    writePayload(root, "test", "backend");
    stopWith(root, "backend", "a1", interimTranscript(), "p-4.jsonl");
    subagentStart(root, "backend", "a1"); // the resume clears the marker
    expect(pendingInterim(root)).toEqual({});
    const r = stopWith(root, "backend", "a1", finalTranscript(OK), "p-5.jsonl");
    expect(r.stdout).not.toContain("problem");
    expect(pendingInterim(root)).toEqual({});
    const out = handoffIssues(root).stdout;
    expect(out).toContain("no problems recorded");
    expect(out).not.toContain("NO HANDOFF");
  });

  it("a resumed agent's repeated interim stops and later final all settle cleanly", async () => {
    const root = await installed();
    subagentStart(root, "backend", "a1");
    stopWith(root, "backend", "a1", interimTranscript(), "p-6.jsonl");
    subagentStart(root, "backend", "a1");
    stopWith(root, "backend", "a1", interimTranscript(), "p-7.jsonl");
    expect(Object.keys(pendingInterim(root))).toEqual(["a1"]);
    subagentStart(root, "backend", "a1");
    writePayload(root, "test", "backend");
    expect(stopWith(root, "backend", "a1", finalTranscript(OK), "p-8.jsonl").stdout).not.toContain("problem");
    expect(pendingInterim(root)).toEqual({});
  });

  it("a labelless SendMessage progress note is not a hand-back: the stop stays interim", async () => {
    const root = await installed();
    subagentStart(root, "backend", "a1");
    const note = L({
      type: "assistant",
      timestamp: "2099-10-01T10:10:00.000Z",
      message: {
        content: [{ type: "tool_use", id: "s", name: "SendMessage", input: { to: "lead", message: "build at 40%" } }],
      },
    });
    const r = stopWith(root, "backend", "a1", interimTranscript() + note, "p-9.jsonl");
    expect(r.stdout).not.toContain("handoff problem");
    expect(pendingInterim(root).a1).toBeDefined();
  });
});
