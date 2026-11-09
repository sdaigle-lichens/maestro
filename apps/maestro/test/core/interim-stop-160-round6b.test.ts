// `160` QA probes, round six, second pass: the edges of the two fixes the implementer made after the first
// round-six run. (1) A SendMessage hand-back gate that needs an uppercase `HANDOFF:` token; (2) a repeat
// interim stop that keeps the marker's `moved_on` and `seen` flags. Same harness as round six: the REAL
// installed SubagentStart/SubagentStop scripts and maestro-task-status.cjs against a temp project, nothing
// mocked. A test that states a required behaviour and fails on the current tree is a real defect.

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

const SESS = "sess-160-r6b";
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
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-160-r6b-")));
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

const sessionFile = (root: string) => path.join(root, ".claude", "maestro_sessions", SESS, "session.json");
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
function writePayload(root: string, receiver: string, sender: string, n = 1) {
  fs.mkdirSync(path.dirname(payloadFile(root, receiver, sender, n)), { recursive: true });
  fs.writeFileSync(payloadFile(root, receiver, sender, n), "{}\n");
}

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

const interimTranscript = (ts = T1) =>
  userPrompt("P1", "implement it", ts) + assistantText("Build started in the background; waiting for it.", ts);

function stopWith(root: string, agent: string, id: string, body: string, name: string) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, body);
  return { ...subagentStop(root, agent, id, { agent_transcript_path: file }), file };
}

describe("round 6b probe 160: the lowercase and uppercase label edges", () => {
  it("lowercase label via SendMessage mid-run ('handoff: success', a progress note) is interim, not a hand-back", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "lc1");
    const body =
      userPrompt("P1", "implement it", T1) +
      assistantText("Working.", T1) +
      sendMessageCall("handoff: success once the build lands", T2) +
      toolResult("P1", T2);
    const stop = stopWith(root, "backend", "lc1", body, "r6b-lc1.jsonl");
    expect(stop.stdout).not.toContain("handoff problem");
    expect(pendingInterim(root).lc1).toBeDefined();
    expect(handoffIssues(root).stdout).toContain("no problems recorded");
  });

  it("lowercase label via SubagentHandback is still parsed and judged (unknown label flagged unrouted)", async () => {
    // HANDOFF_RE stays case-insensitive for SubagentHandback, so a lowercase label is judged, not interim.
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "lc2");
    const body =
      userPrompt("P1", "implement it", T1) +
      assistantText("Done.", T1) +
      handbackCall("Report.\nhandoff: bogus_label", T2) +
      toolResult("P1", T2);
    const stop = stopWith(root, "backend", "lc2", body, "r6b-lc2.jsonl");
    expect(stop.stdout).toContain("handoff problem");
    expect(pendingInterim(root).lc2).toBeUndefined();
  });

  it("lowercase label via SubagentHandback with a condition-free success is judged, not interim", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "lc3");
    writePayload(root, "test", "backend");
    const body =
      userPrompt("P1", "implement it", T1) +
      assistantText("Done.", T1) +
      handbackCall("Report.\nhandoff: success", T2) +
      toolResult("P1", T2);
    const stop = stopWith(root, "backend", "lc3", body, "r6b-lc3.jsonl");
    expect(stop.stdout).not.toContain("handoff problem");
    expect(pendingInterim(root).lc3).toBeUndefined();
  });

  it("lowercase label in last_assistant_message is judged at the stop, not deferred as interim", async () => {
    // parseHandoff is /gi, so last_assistant_message 'handoff: bogus_label' gives a label directly; the
    // transcript is never consulted, and an unknown label is flagged unrouted.
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "lc4");
    const file = path.join(tmp, "r6b-lc4.jsonl");
    fs.writeFileSync(file, interimTranscript());
    const stop = subagentStop(root, "backend", "lc4", {
      agent_transcript_path: file,
      last_assistant_message: "Done.\nhandoff: bogus_label",
    });
    expect(stop.stdout).toContain("handoff problem");
    expect(pendingInterim(root).lc4).toBeUndefined();
  });

  it("uppercase label via SendMessage (the contract's form) is still a hand-back and judged", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "uc1");
    const body =
      userPrompt("P1", "implement it", T1) +
      assistantText("Done.", T1) +
      sendMessageCall("HANDOFF: bogus_label", T2) +
      toolResult("P1", T2);
    const stop = stopWith(root, "backend", "uc1", body, "r6b-uc1.jsonl");
    expect(stop.stdout).toContain("handoff problem");
    expect(pendingInterim(root).uc1).toBeUndefined();
  });

  it("DEFECT (acceptance: an interim stop records no hand-off issue): an uppercase 'HANDOFF: success' inside a mid-run SendMessage sentence is not a hand-back", async () => {
    // The fix anchors the uppercase token only by `HANDOFF:` anywhere in the text. The implementer's own
    // constraint is a well-formed `HANDOFF: <label>` LINE. A progress note that mentions the label inside a
    // sentence, with work still running, is not a final report and must stay interim.
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "uc2");
    const body =
      userPrompt("P1", "implement it", T1) +
      assistantText("Working.", T1) +
      sendMessageCall("Still waiting on the build. I will end with HANDOFF: success once it lands.", T2) +
      toolResult("P1", T2);
    const stop = stopWith(root, "backend", "uc2", body, "r6b-uc2.jsonl");
    expect(stop.stdout).not.toContain("handoff problem");
    expect(pendingInterim(root).uc2).toBeDefined();
  });

  it("DEFECT-check: an uppercase label on a line of its own in a SendMessage is still a hand-back", async () => {
    // Positive control for the line rule: the same label on its own line is a final, so it is judged.
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "uc3");
    const body =
      userPrompt("P1", "implement it", T1) +
      assistantText("Done.", T1) +
      sendMessageCall("Build green.\nHANDOFF: bogus_label", T2) +
      toolResult("P1", T2);
    const stop = stopWith(root, "backend", "uc3", body, "r6b-uc3.jsonl");
    expect(stop.stdout).toContain("handoff problem");
  });

  it("DEFECT (acceptance: an interim stop records no hand-off issue): a mid-run SendMessage whose 'HANDOFF:' label wraps onto the next line is not a final", async () => {
    // The uppercase gate needs the label on the same line as HANDOFF: ([ \t]*), so the wrapped form misses it.
    // The malformed-line rule MALFORMED_HANDOFF_LINE_RE uses [\s] between HANDOFF and the label, so the newline
    // passes and the wrapped text reads as a whole malformed line ('HANDOFF:' then 'success'). The rule is
    // documented as one line, so the newline must not be a separator.
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "uc4");
    const body =
      userPrompt("P1", "implement it", T1) +
      assistantText("Working.", T1) +
      sendMessageCall("Build running.\nHANDOFF:\nsuccess", T2) +
      toolResult("P1", T2);
    const stop = stopWith(root, "backend", "uc4", body, "r6b-uc4.jsonl");
    expect(stop.stdout).not.toContain("handoff problem");
    expect(pendingInterim(root).uc4).toBeDefined();
  });

  it("PINS: a backticked label at the start of its own line is still a hand-back (the contract's form)", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "uc5");
    const body =
      userPrompt("P1", "implement it", T1) +
      assistantText("Done.", T1) +
      sendMessageCall("Build green.\n`HANDOFF: bogus_label`", T2) +
      toolResult("P1", T2);
    const stop = stopWith(root, "backend", "uc5", body, "r6b-uc5.jsonl");
    expect(stop.stdout).toContain("handoff problem");
    expect(pendingInterim(root).uc5).toBeUndefined();
  });
});

describe("round 6b probe 160: repeat interim stops keep their flags", () => {
  it("a repeat interim stop (no resume) keeps 'seen' from an earlier handoff-issues check, so it is flagged 'never resumed'", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "rs1");
    const file = stopWith(root, "backend", "rs1", interimTranscript(), "r6b-rs1a.jsonl").file;
    expect(handoffIssues(root).stdout).toContain("not flagged yet"); // marks seen
    subagentStop(root, "backend", "rs1", { agent_transcript_path: file }); // duplicate interim stop
    expect(handoffIssues(root).stdout).toContain("never resumed");
  });

  it("a resume clears the marker: a later interim stop of the same id starts fresh, not 'never resumed'", async () => {
    const root = await installed();
    activateFeatureWorkflow(root);
    subagentStart(root, "backend", "rs2");
    stopWith(root, "backend", "rs2", interimTranscript(), "r6b-rs2a.jsonl");
    subagentStart(root, "test", "t-rs2"); // another dispatch: rs2 moved on
    subagentStart(root, "backend", "rs2"); // resumed: its marker clears
    stopWith(root, "backend", "rs2", interimTranscript(T2), "r6b-rs2b.jsonl");
    expect(pendingInterim(root).rs2).toBeDefined();
    expect(pendingInterim(root).rs2.moved_on).toBeUndefined();
    const out = handoffIssues(root).stdout;
    expect(out).not.toContain("never resumed");
    expect(out).toContain("not flagged yet");
  });
});
