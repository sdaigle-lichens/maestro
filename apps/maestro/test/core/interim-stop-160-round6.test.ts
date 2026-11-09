// `160` QA probes, round six. Gaps beyond the implementer's hints, derived from the ticket's acceptance
// criteria and from the code paths in maestro-subagent-log.js, interim-stop.ts, handoff-label.ts and
// handoff-payload.ts. Same harness as round five: the REAL installed SubagentStart/SubagentStop scripts and
// maestro-task-status.cjs run against a temp project with a pinned HOME and session id. Nothing mocked.
//
// A test that expresses a stated behaviour and fails on the current tree is a real defect; it is left
// failing on purpose. A test that pins a documented limit passes and names the limit.

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

const SESS = "sess-160-r6";
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
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-160-r6-")));
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

/** Activate the `feature` workflow so the unrouted check runs. */
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
const toolResult = (promptId: string, ts: string) =>
  L({
    type: "user",
    promptId,
    timestamp: ts,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "h", content: "Delivered." }] },
  });
const OK = `Done.\n"verdict": "SUCCESS"\nHANDOFF: success`;

/** A run that stopped to wait on background work: working text, no hand-back call. */
const interimTranscript = (ts = T1) =>
  userPrompt("P1", "implement it", ts) + assistantText("Build started in the background; waiting for it.", ts);

/** Write `body` to a fresh transcript file and stop the agent on it. */
function stopWith(root: string, agent: string, id: string, body: string, name: string) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, body);
  return { ...subagentStop(root, agent, id, { agent_transcript_path: file }), file };
}

describe("round 6 probe 160: gaps beyond the hints", () => {
  it("PINS a limit: a plain-text final whose last line is 'HANDOFF success' (no colon, no hand-back call) is deferred at the stop, not flagged there, then flagged on the second check", async () => {
    // The SendMessage form of this line is flagged at the stop (round five). The plain-text form is not
    // recognised by the stop's parseHandoff (it needs a colon), so the stop reads it as "no HANDOFF line"
    // with no hand-back call: an interim stop by design, deferred. This pins that it still ends flagged.
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "p1");
    const body = interimTranscript() + assistantText("Done.\nHANDOFF success", T2);
    const stop = stopWith(root, "backend", "p1", body, "r6-p1.jsonl");
    expect(stop.stdout).not.toContain("handoff problem");
    expect(pendingInterim(root).p1).toBeDefined();
    expect(handoffIssues(root).stdout).toContain("not flagged yet");
    const second = handoffIssues(root).stdout;
    expect(second).toContain("was never resumed");
    expect(second).toContain("backend");
  });

  it("DEFECT (acceptance: an interim stop records no hand-off issue): a mid-run SendMessage 'Handoff: waiting on the build' progress note is not a final hand-back", async () => {
    // Acceptance: an interim stop records no hand-off issue. The label matcher is case-insensitive (HANDOFF_RE
    // is /gi), so a colon-led progress note "Handoff: <status>" reads as a labelled hand-back. Then the stop
    // is judged, and an unknown label is flagged unrouted.
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "pn1");
    const body =
      userPrompt("P1", "implement it", T1) +
      assistantText("Working.", T1) +
      sendMessageCall("Handoff: waiting on the background build", T2) +
      toolResult("P1", T2);
    const stop = stopWith(root, "backend", "pn1", body, "r6-pn1.jsonl");
    expect(stop.stdout).not.toContain("handoff problem");
    expect(pendingInterim(root).pn1).toBeDefined();
    expect(handoffIssues(root).stdout).toContain("no problems recorded");
  });

  it("PINS a limit: with no dispatch entry for the agent id, the payload check has no start to measure from, so an earlier run's file counts", async () => {
    // `checkPayload` gets sinceMs = null when the log holds no dispatch for the agent id, and then the file
    // merely existing counts (handoff-payload.ts, the conservative direction). An earlier run's stale file
    // therefore passes a final success. This pins the limit, same at HEAD; a dispatch is needed to measure.
    const root = await installed();
    activateFeatureWorkflow(root);
    writePayload(root, "test", "backend", 1, new Date("2001-01-01T00:00:00Z"));
    const body =
      userPrompt("P1", "implement it", T1) + assistantText("Done.", T1) + handbackCall(OK, T2) + toolResult("P1", T2);
    const stop = stopWith(root, "backend", "nodispatch", body, "r6-nd.jsonl");
    expect(stop.stdout).not.toContain("handoff problem");
    expect(handoffIssues(root).stdout).toContain("no problems recorded");
  });

  it("DEFECT (acceptance: a final stop is still flagged): a repeated interim stop of the same agent id (no resume between) keeps the marker's moved-on flag, as interim-stop.ts documents", async () => {
    // interim-stop.ts recordInterimStop documents: "a repeat stop keeps the first marker's flags". The code
    // replaces the whole entry, so a moved_on set by another dispatch is lost on a duplicate stop, and the
    // agent is never flagged. The SubagentStop hook can fire twice for one run (handoff-issues comment).
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "d1");
    const file = stopWith(root, "backend", "d1", interimTranscript(), "r6-d1.jsonl").file;
    subagentStart(root, "test", "t-d1"); // the orchestrator moved on from d1
    subagentStop(root, "backend", "d1", { agent_transcript_path: file }); // duplicate interim stop, same id
    const out = handoffIssues(root).stdout;
    expect(out).toContain("never resumed");
  });

  it("PINS a limit: a SubagentHandback whose label is malformed ('HANDOFF success') is not judged when the final text before it carries a valid HANDOFF label", async () => {
    // The stop judges last_assistant_message whenever it names a label, so the recovered hand-back is ignored
    // (recovery runs only for status 'unknown'). Same at HEAD, not a 160 regression. This pins it so a change is noticed.
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "mx1");
    const body =
      userPrompt("P1", "implement it", T1) +
      assistantText(OK, T1) +
      handbackCall("HANDOFF success", T2) +
      toolResult("P1", T2);
    const file = path.join(tmp, "r6-mx1.jsonl");
    fs.writeFileSync(file, body);
    writePayload(root, "test", "backend"); // isolate the label question from the payload check
    const stop = subagentStop(root, "backend", "mx1", {
      agent_transcript_path: file,
      last_assistant_message: OK,
    });
    expect(stop.stdout).not.toContain("handoff problem");
  });
});
