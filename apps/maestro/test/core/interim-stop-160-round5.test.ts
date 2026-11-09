// `160` QA probes, round five. Targets the parts the earlier rounds did not reach: `judgeLandedHandback`
// in maestro-task-status.cjs (the late hand-back judged from a pending marker), the resume and
// re-verify-only shapes of that judgement, the whole-run payload measure on the late path, and the
// `MALFORMED_HANDOFF_LINE_RE` edges (handoff-label.ts) as they reach the SubagentStop hook.
// Same harness as interim-stop-160-recheck.test.ts: the REAL installed SubagentStart/SubagentStop scripts
// and maestro-task-status.cjs run against a temp project with a pinned HOME and session id. Nothing mocked.
//
// A test that expresses a stated behaviour and fails on the current tree is a real defect; it is left
// failing on purpose so the backend sees it.

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

vi.setConfig({ testTimeout: 90_000 });

const SESS = "sess-160-r5";
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
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-160-r5-")));
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
const sessionFile = (root: string) => path.join(sessionDir(root), "session.json");
const readState = (root: string): Record<string, any> => {
  const f = sessionFile(root);
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

/** Activate the `feature` workflow the way the on-time route test does, so the unrouted check runs. */
function activateFeatureWorkflow(root: string) {
  execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: home },
  });
  const set = projectScript(root, "maestro-set-session-workflow.cjs", ["feature"]);
  expect(set.code, set.stdout + set.stderr).toBe(0);
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
function writePayload(root: string, receiver: string, sender: string, n = 1, mtime?: Date) {
  fs.mkdirSync(path.dirname(payloadFile(root, receiver, sender, n)), { recursive: true });
  fs.writeFileSync(payloadFile(root, receiver, sender, n), "{}\n");
  if (mtime) fs.utimesSync(payloadFile(root, receiver, sender, n), mtime, mtime);
}

// Transcript builders. 2099 timestamps read as written after every dispatch; 2001 reads as an earlier run.
const L = (o: unknown) => JSON.stringify(o) + "\n";
const T1 = "2099-10-01T10:00:00.000Z";
const T2 = "2099-10-01T10:30:00.000Z";
const T3 = "2099-10-01T11:00:00.000Z";
const T4 = "2099-10-01T11:30:00.000Z";
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
const sendMessageCall = (message: string, ts: string) =>
  L({
    type: "assistant",
    timestamp: ts,
    message: {
      content: [{ type: "tool_use", id: "s", name: "SendMessage", input: { to: "orchestrator", message } }],
    },
  });
const editCall = (ts: string) =>
  L({
    type: "assistant",
    timestamp: ts,
    message: {
      content: [
        {
          type: "tool_use",
          id: "e",
          name: "Edit",
          input: { file_path: "probe-160.txt", old_string: "a", new_string: "b" },
        },
      ],
    },
  });
const toolResult = (promptId: string, ts: string) =>
  L({
    type: "user",
    promptId,
    timestamp: ts,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "h", content: "Delivered." }] },
  });
const subagentLabelled = (label: string) => `Done.\n"verdict": "SUCCESS"\nHANDOFF: ${label}`;
const OK = subagentLabelled("success");

/** A run that stopped to wait on background work: working text, no hand-back call. */
const interimTranscript = (ts = T1) =>
  userPrompt("P1", "implement it", ts) + assistantText("Build started in the background; waiting for it.", ts);

/** Write `body` to a fresh transcript file and stop the agent on it. */
function stopWith(root: string, agent: string, id: string, body: string, name: string) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, body);
  return { ...subagentStop(root, agent, id, { agent_transcript_path: file }), file };
}

/** A SendMessage final: the agent hands back by SendMessage with `message`. */
const sendFinal = (message: string) =>
  userPrompt("P1", "implement it", T1) +
  assistantText("Working.", T1) +
  sendMessageCall(message, T2) +
  toolResult("P1", T2);

describe("round 5 probe 160: the late judgement (judgeLandedHandback)", () => {
  it("a pre-change marker (no scope, no cwd): a late unknown route is still flagged", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "o1");
    const { file } = stopWith(root, "backend", "o1", interimTranscript(), "r5-o1.jsonl");
    const st = readState(root);
    delete st.pending_interim.o1.scope;
    delete st.pending_interim.o1.cwd;
    fs.writeFileSync(sessionFile(root), JSON.stringify(st));
    subagentStart(root, "test", "to1"); // the orchestrator moved on
    fs.appendFileSync(file, handbackCall(subagentLabelled("mystery"), T2) + toolResult("P1", T2));
    const out = handoffIssues(root).stdout;
    expect(out).toContain("NO ROUTE for HANDOFF: mystery");
  });

  it("a pre-change marker (no scope): a late valid success with no payload is not payload-checked (documented limit)", async () => {
    // notHandled: a marker recorded before this change has no scope, so the late path skips the payload
    // check. This pins that the limit holds, so a later change that starts checking it is noticed.
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "o2");
    const { file } = stopWith(root, "backend", "o2", interimTranscript(), "r5-o2.jsonl");
    const st = readState(root);
    delete st.pending_interim.o2.scope;
    fs.writeFileSync(sessionFile(root), JSON.stringify(st));
    subagentStart(root, "test", "to2");
    fs.appendFileSync(file, handbackCall(OK, T2) + toolResult("P1", T2));
    expect(handoffIssues(root).stdout).toContain("no problems recorded");
  });

  it("a re-verify-only resumed run: a late valid hand-back flags nothing and clears the marker", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "rv1");
    writePayload(root, "test", "backend");
    const run1 = stopWith(
      root,
      "backend",
      "rv1",
      userPrompt("P1", "implement it", T1) + handbackCall(OK, T1) + toolResult("P1", T1),
      "r5-rv1.jsonl"
    );
    expect(run1.stdout).not.toContain("handoff problem");
    subagentStart(root, "backend", "rv1"); // resumed
    fs.appendFileSync(
      run1.file,
      userPrompt("P2", "re-verify, change nothing", T3) + assistantText("Re-verified; nothing changed.", T3)
    );
    const stop2 = subagentStop(root, "backend", "rv1", { agent_transcript_path: run1.file });
    expect(stop2.stdout).not.toContain("handoff problem");
    expect(pendingInterim(root).rv1).toBeDefined();
    fs.appendFileSync(run1.file, handbackCall(OK, T4) + toolResult("P2", T4));
    const out = handoffIssues(root).stdout;
    expect(out).toContain("no problems recorded");
    expect(pendingInterim(root)).toEqual({});
  });

  it("a resumed run that edits a file and writes no payload: the late hand-back is flagged missing_payload", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "ed1");
    const run1 = stopWith(root, "backend", "ed1", interimTranscript(), "r5-ed1.jsonl");
    expect(run1.stdout).not.toContain("handoff problem");
    subagentStart(root, "backend", "ed1"); // resumed
    fs.appendFileSync(run1.file, userPrompt("P2", "fix it", T3) + editCall(T3));
    subagentStop(root, "backend", "ed1", { agent_transcript_path: run1.file }); // interim: no call yet
    fs.appendFileSync(run1.file, handbackCall(OK, T4) + toolResult("P2", T4));
    const out = handoffIssues(root).stdout;
    expect(out).toContain("NO PAYLOAD");
  });

  it("a payload written before the latest resume counts for a late hand-back (whole-run measure)", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "w1");
    writePayload(root, "test", "backend"); // written in the first stretch, after the first dispatch
    const run1 = stopWith(root, "backend", "w1", interimTranscript(), "r5-w1.jsonl");
    expect(run1.stdout).not.toContain("handoff problem");
    subagentStart(root, "backend", "w1"); // resumed: the latest dispatch is now later than the payload
    fs.appendFileSync(run1.file, userPrompt("P2", "finish", T3) + assistantText("Finishing.", T3));
    subagentStop(root, "backend", "w1", { agent_transcript_path: run1.file }); // interim again
    fs.appendFileSync(run1.file, handbackCall(OK, T4) + toolResult("P2", T4));
    expect(handoffIssues(root).stdout).toContain("no problems recorded");
  });

  it("a payload left by an earlier run (mtime before the first dispatch) does not count for a late hand-back", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "e1");
    writePayload(root, "test", "backend", 1, new Date("2001-01-01T00:00:00.000Z"));
    const run1 = stopWith(root, "backend", "e1", interimTranscript(), "r5-e1.jsonl");
    subagentStart(root, "test", "te1");
    fs.appendFileSync(run1.file, handbackCall(OK, T2) + toolResult("P1", T2));
    expect(handoffIssues(root).stdout).toContain("NO PAYLOAD");
  });

  it("no active workflow: a late unknown label is not route-checked, the same as on time", async () => {
    const root = await installed(); // no workflow activated
    subagentStart(root, "backend", "np-on");
    const onTime = stopWith(root, "backend", "np-on", finalTranscript(subagentLabelled("mystery")), "r5-np-on.jsonl");
    expect(onTime.stdout).not.toContain("unrouted");
    subagentStart(root, "backend", "np-late");
    const late = stopWith(root, "backend", "np-late", interimTranscript(), "r5-np-late.jsonl");
    expect(late.stdout).not.toContain("handoff problem");
    subagentStart(root, "test", "tnp");
    fs.appendFileSync(late.file, handbackCall(subagentLabelled("mystery"), T2) + toolResult("P1", T2));
    const out = handoffIssues(root).stdout;
    expect(out).not.toContain("NO ROUTE");
    expect(out).toContain("no problems recorded");
  });

  it("a marker cleared by a resume: the resumed run's own late flush is judged when it lands", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "g1");
    const run1 = stopWith(root, "backend", "g1", interimTranscript(), "r5-g1.jsonl");
    expect(pendingInterim(root).g1).toBeDefined();
    subagentStart(root, "backend", "g1"); // resume clears the marker
    expect(pendingInterim(root)).toEqual({});
    fs.appendFileSync(run1.file, userPrompt("P2", "continue", T3) + assistantText("Waiting again.", T3));
    subagentStop(root, "backend", "g1", { agent_transcript_path: run1.file }); // interim again, marker re-recorded
    expect(pendingInterim(root).g1).toBeDefined();
    fs.appendFileSync(run1.file, handbackCall(subagentLabelled("mystery"), T4) + toolResult("P2", T4));
    expect(handoffIssues(root).stdout).toContain("NO ROUTE for HANDOFF: mystery");
  });
});

// `finalTranscript` is defined in the recheck file; the same shape is built here.
function finalTranscript(report: string) {
  return interimTranscript() + handbackCall(report, T2) + toolResult("P1", T2);
}

describe("round 5 probe 160: MALFORMED_HANDOFF_LINE_RE edges as SendMessage finals and progress notes", () => {
  it("a progress note whose whole line is 'Handoff pending' is prose: the interim stop flags nothing", async () => {
    // The spec: prose that mentions the handoff is a progress note and counts for nothing. A one-word
    // progress line starting with the word HANDOFF has the shape of a malformed final ("HANDOFF success").
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "m-prose");
    const body =
      userPrompt("P1", "implement it", T1) +
      assistantText("Building.", T1) +
      sendMessageCall("Still building.\nHandoff pending", T1);
    const r = stopWith(root, "backend", "m-prose", body, "r5-m-prose.jsonl");
    expect(r.stdout).not.toContain("handoff problem");
    expect(handoffEntries(root, "m-prose")[0]?.interim).toBe(true);
    expect(pendingInterim(root)["m-prose"]).toBeDefined();
  });

  it("a progress note of several words starting 'Handoff ready for review' is prose: flags nothing", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "m-words");
    const body =
      userPrompt("P1", "implement it", T1) +
      assistantText("Building.", T1) +
      sendMessageCall("Handoff ready for review soon", T1);
    const r = stopWith(root, "backend", "m-words", body, "r5-m-words.jsonl");
    expect(r.stdout).not.toContain("handoff problem");
    expect(handoffEntries(root, "m-words")[0]?.interim).toBe(true);
  });

  it("a final SendMessage with a CRLF malformed line 'HANDOFF success' is flagged at the stop", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "m-crlf");
    const r = stopWith(root, "backend", "m-crlf", sendFinal("Done.\r\nHANDOFF success\r\n"), "r5-m-crlf.jsonl");
    expect(r.stdout).toContain("handoff problem (missing)");
  });

  it("a final SendMessage with a backticked or bold malformed line is flagged at the stop", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "m-tick");
    const a = stopWith(root, "backend", "m-tick", sendFinal("Done.\n`HANDOFF success`"), "r5-m-tick.jsonl");
    expect(a.stdout).toContain("handoff problem (missing)");
    subagentStart(root, "backend", "m-bold");
    const b = stopWith(root, "backend", "m-bold", sendFinal("Done.\n**HANDOFF success**"), "r5-m-bold.jsonl");
    expect(b.stdout).toContain("handoff problem (missing)");
  });

  it("a final SendMessage ending 'HANDOFF success.' (a trailing period) is flagged at the stop, not deferred", async () => {
    // The doc defines the malformed line as "HANDOFF, an optional colon and one word" and says it is
    // flagged missing at once. A trailing period is one word plus punctuation: the regex misses it, so the
    // stop reads as interim and waits for a second look.
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "m-dot");
    const r = stopWith(root, "backend", "m-dot", sendFinal("Done.\nHANDOFF success."), "r5-m-dot.jsonl");
    expect(r.stdout).toContain("handoff problem (missing)");
  });
});
