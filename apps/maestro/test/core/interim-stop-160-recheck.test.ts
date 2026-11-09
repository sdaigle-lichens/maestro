// `160` QA probes, third round. The earlier rounds covered the three reported defects; these probe the
// new transcript re-read in `handoff-issues` (`settleInterimStops` + `landedHandback`), the SendMessage
// classification of a progress note that merely mentions HANDOFF, and the run boundary of the re-read.
// Same harness as interim-stop-160-probe.test.ts: the REAL installed SubagentStart/SubagentStop scripts
// and maestro-task-status.cjs run against a temp project with a pinned HOME and session id. Nothing mocked.
//
// Each `it` names its sequence. Tests that express a stated acceptance criterion and fail on the current
// tree are real defects; they are left failing on purpose so the backend sees them.

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

vi.setConfig({ testTimeout: 60_000 });

const SESS = "sess-160-recheck";
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
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-160-recheck-")));
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

// ── transcripts: 2099 so every entry reads as written after the hook's own dispatch; 2001 for an earlier run
const L = (o: unknown) => JSON.stringify(o) + "\n";
const T_OLD = "2001-01-01T00:00:00.000Z";
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

/** The same run, finished with a hand-back on time. */
const finalTranscript = (report: string) => interimTranscript() + handbackCall(report, T2) + toolResult("P1", T2);

/** Activate the `feature` workflow the way the on-time route test does, so the unrouted check runs. */
function activateFeatureWorkflow(root: string) {
  execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root], {
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: home },
  });
  const set = projectScript(root, "maestro-set-session-workflow.cjs", ["feature"]);
  expect(set.code, set.stdout + set.stderr).toBe(0);
}

describe("probe 160 recheck: the late hand-back re-read, valid and invalid", () => {
  it("control: a valid late hand-back settles a moved-on interim stop on the first check, with nothing flagged", async () => {
    const root = await installed();
    writePayload(root, "test", "backend");
    subagentStart(root, "backend", "c1");
    const { file } = stopWith(root, "backend", "c1", interimTranscript(), "rc-1.jsonl");
    subagentStart(root, "test", "t1"); // the orchestrator moved on
    fs.appendFileSync(file, handbackCall(OK, T2) + toolResult("P1", T2)); // the late flush
    const out = handoffIssues(root).stdout;
    expect(out).not.toContain("NO HANDOFF");
    expect(out).toContain("no problems recorded");
    expect(pendingInterim(root)).toEqual({});
  });

  it("a late FAIL hand-back that ends HANDOFF: success is recorded as a contradiction on the check", async () => {
    const root = await installed();
    subagentStart(root, "backend", "c2");
    const { file } = stopWith(root, "backend", "c2", interimTranscript(), "rc-2.jsonl");
    subagentStart(root, "test", "t2");
    fs.appendFileSync(file, handbackCall('"verdict": "FAIL"\nHANDOFF: success', T2) + toolResult("P1", T2));
    const out = handoffIssues(root).stdout;
    expect(out).toContain("which is invalid");
    expect(out).not.toContain("no problems recorded");
    expect(pendingInterim(root)).toEqual({});
  });

  it("a late labelless SubagentHandback is recorded as missing on the check", async () => {
    const root = await installed();
    subagentStart(root, "backend", "c3");
    const { file } = stopWith(root, "backend", "c3", interimTranscript(), "rc-3.jsonl");
    subagentStart(root, "test", "t3");
    fs.appendFileSync(file, handbackCall("All done, see the files.", T2) + toolResult("P1", T2));
    expect(handoffIssues(root).stdout).toContain("backend: NO HANDOFF line");
  });

  it("DEFECT (acceptance: an unknown route on a final stop is still flagged): a late hand-back with HANDOFF: mystery is flagged unrouted", async () => {
    // The stop's bounded wait missed the hand-back; the check re-reads it and judges only the HANDOFF
    // line. An unknown label is a final stop with an unknown route, so it must be flagged, not dropped.
    const root = await installed();
    activateFeatureWorkflow(root); // the unrouted check only runs against an active workflow
    writePayload(root, "test", "backend");
    subagentStart(root, "backend", "c4");
    const { file } = stopWith(root, "backend", "c4", interimTranscript(), "rc-4.jsonl");
    subagentStart(root, "test", "t4");
    fs.appendFileSync(file, handbackCall(subagentLabelled("mystery"), T2) + toolResult("P1", T2));
    const r = handoffIssues(root);
    expect(r.stdout).toContain("NO ROUTE for HANDOFF: mystery");
    expect(r.stdout).not.toContain("no problems recorded");
  });

  it("control for the unknown-route probe: the same label on time, with no late flush, is flagged unrouted by the stop", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "c4c");
    const r = stopWith(root, "backend", "c4c", finalTranscript(subagentLabelled("mystery")), "rc-4c.jsonl");
    expect(r.stdout).toContain("handoff problem (unrouted)");
  });

  it("DEFECT (acceptance: a payload never written in the whole run is still flagged): a late HANDOFF: success with no payload is flagged missing_payload", async () => {
    // No payload was ever written for test. The late success hand-back is a final stop; the re-read
    // judges the label only, so the unwritten payload that an on-time stop would flag goes unreported.
    const root = await installed();
    subagentStart(root, "backend", "c5");
    const { file } = stopWith(root, "backend", "c5", interimTranscript(), "rc-5.jsonl");
    subagentStart(root, "test", "t5");
    fs.appendFileSync(file, handbackCall(OK, T2) + toolResult("P1", T2));
    const out = handoffIssues(root).stdout;
    expect(out).toContain("NO PAYLOAD written for HANDOFF: success");
  });
});

describe("probe 160 recheck: the run boundary and unreadable or missing transcripts", () => {
  it("an earlier run's valid hand-back in the same transcript does not settle the current run's interim stop", async () => {
    const root = await installed();
    subagentStart(root, "backend", "r1");
    const earlier = userPrompt("P0", "first run", T_OLD) + handbackCall(OK, T_OLD) + toolResult("P0", T_OLD);
    stopWith(root, "backend", "r1", earlier + interimTranscript(), "rr-1.jsonl");
    const entry = handoffEntries(root, "r1").at(-1);
    expect(entry?.interim).toBe(true); // the stale hand-back is not this run's, so the stop is interim
    subagentStart(root, "test", "t6");
    expect(handoffIssues(root).stdout).toContain("backend: NO HANDOFF line");
  });

  it("a marker without transcript_path (hand-edited) is promoted to missing on the check, without a crash", async () => {
    const root = await installed();
    subagentStart(root, "backend", "m1");
    stopWith(root, "backend", "m1", interimTranscript(), "rm-1.jsonl");
    const st = readState(root);
    delete st.pending_interim.m1.transcript_path;
    st.pending_interim.m1.moved_on = true;
    fs.writeFileSync(sessionFile(root), JSON.stringify(st));
    const r = handoffIssues(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("backend: NO HANDOFF line");
    expect(pendingInterim(root)).toEqual({});
  });

  it("a transcript deleted before the check is promoted to missing (no readable hand-back), without a crash", async () => {
    const root = await installed();
    subagentStart(root, "backend", "m2");
    const { file } = stopWith(root, "backend", "m2", interimTranscript(), "rm-2.jsonl");
    subagentStart(root, "test", "t7");
    fs.rmSync(file);
    const r = handoffIssues(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("backend: NO HANDOFF line");
  });

  it("a transcript that became unreadable (a directory at its path) is promoted to missing, without a crash", async () => {
    const root = await installed();
    subagentStart(root, "backend", "m3");
    const { file } = stopWith(root, "backend", "m3", interimTranscript(), "rm-3.jsonl");
    subagentStart(root, "test", "t8");
    fs.rmSync(file);
    fs.mkdirSync(file);
    const r = handoffIssues(root);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("backend: NO HANDOFF line");
  });
});

describe("probe 160 recheck: a SendMessage progress note that mentions HANDOFF in prose", () => {
  it("DEFECT (acceptance: an interim stop records no hand-off issue): a progress note with lowercase 'handoff' in prose, then a wait, is interim", async () => {
    // Sequence: the agent sends a progress note mentioning a handoff in prose (no `HANDOFF:` label), then
    // stops to wait on background work. The task says a SendMessage with no HANDOFF text is an interim
    // progress note. The current check counts any input string containing "handoff" as a final.
    const root = await installed();
    subagentStart(root, "backend", "p1");
    const body =
      userPrompt("P1", "implement it", T1) +
      sendMessageCall("Waiting on the handoff from test before I continue.", T1) +
      assistantText("Build started in the background; waiting for it.", T1);
    const r = stopWith(root, "backend", "p1", body, "rp-1.jsonl");
    expect(r.stdout).not.toContain("problem");
    expect(handoffEntries(root, "p1").at(-1)?.interim).toBe(true);
    expect(pendingInterim(root).p1).toBeDefined();
  });

  it("DEFECT (same criterion): a progress note with an uppercase 'HANDOFF line' in prose and no label, then a wait, is interim", async () => {
    const root = await installed();
    subagentStart(root, "backend", "p2");
    const body =
      userPrompt("P1", "implement it", T1) +
      sendMessageCall("I will send the HANDOFF line once the build finishes.", T1) +
      assistantText("Build started in the background; waiting for it.", T1);
    const r = stopWith(root, "backend", "p2", body, "rp-2.jsonl");
    expect(r.stdout).not.toContain("problem");
    expect(handoffEntries(root, "p2").at(-1)?.interim).toBe(true);
  });

  it("control: a SendMessage with a labelled HANDOFF line IS a final hand-back and is judged at the stop", async () => {
    const root = await installed();
    subagentStart(root, "backend", "p3");
    const body =
      userPrompt("P1", "implement it", T1) + sendMessageCall(subagentLabelled("success"), T2) + toolResult("P1", T2);
    stopWith(root, "backend", "p3", body, "rp-3.jsonl");
    const entry = handoffEntries(root, "p3").at(-1);
    expect(entry?.interim).toBeUndefined();
    expect(entry?.label).toBe("success");
  });
});
