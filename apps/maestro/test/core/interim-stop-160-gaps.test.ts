// Round-2 QA probes for `160`: the gaps the previous round listed as not caught. Same harness as
// interim-stop-160-probe.test.ts and interim-stop-160-qa.test.ts: the REAL installed SubagentStart and
// SubagentStop scripts plus maestro-task-status.cjs, run against a temp project with a pinned HOME and
// session id. Nothing mocked. Each test names the sequence it drives and says whether it pins current
// behaviour (documented trade-off) or asserts the required outcome (a probe that may expose a defect).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot, runtimeAssets } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const REPO_ROOT = path.resolve(PLUGIN_ROOT, "..", "..");
const PRE_160_COMMIT = "ea0a2b0";

vi.setConfig({ testTimeout: 60_000 });

const SESS = "sess-160-gaps";
const SCOPE = "session-sess-160"; // session-<first 8 chars of the session id>

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
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-160-gaps-")));
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

/** The plugin tree as it was before 160, extracted from git (not from the working tree). */
function preChangePluginRoot(): string {
  const dir = path.join(tmp, "pre160");
  fs.mkdirSync(dir, { recursive: true });
  const tar = path.join(tmp, "pre160.tar");
  execFileSync("git", ["-C", REPO_ROOT, "archive", "--output", tar, PRE_160_COMMIT, "plugins/maestro"]);
  execFileSync("tar", ["-xf", tar, "-C", dir]);
  // Assets added after the old commit exist only in the working tree, but the install manifest
  // lists them: borrow them (they are not what this test probes).
  const old = path.join(dir, "plugins", "maestro");
  for (const asset of runtimeAssets(PLUGIN_ROOT)) {
    const to = path.join(old, ...asset.src.split("/"));
    if (!fs.existsSync(to)) fs.copyFileSync(path.join(PLUGIN_ROOT, ...asset.src.split("/")), to);
  }
  return old;
}

async function installed(pluginRoot: string = PLUGIN_ROOT): Promise<string> {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeConfig(root, cfg);
  await installRuntime(
    root,
    pluginRoot,
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

// ── transcript pieces: dated 2099 so each entry reads as after the hook's own dispatch ─────────────────
const L = (o: unknown) => JSON.stringify(o) + "\n";
const T1 = "2099-10-01T10:00:00.000Z";
const T2 = "2099-10-01T10:30:00.000Z";
const T3 = "2099-10-01T11:00:00.000Z";
const resumePrompt = (promptId: string, ts: string) =>
  L({
    type: "user",
    promptId,
    isMeta: true,
    origin: { kind: "coordinator" },
    timestamp: ts,
    message: { role: "user", content: "The coordinator sent a message while you were working: continue" },
  });
const userPrompt = (promptId: string, text: string, ts: string) =>
  L({ type: "user", promptId, timestamp: ts, message: { role: "user", content: text } });
const assistantText = (text: string, ts: string) =>
  L({ type: "assistant", timestamp: ts, message: { content: [{ type: "text", text }] } });
const toolUse = (name: string, input: unknown, ts: string) =>
  L({ type: "assistant", timestamp: ts, message: { content: [{ type: "tool_use", id: name, name, input }] } });
const handbackCall = (report: string, ts: string) => toolUse("SubagentHandback", { message: report }, ts);
const sendMessageCall = (message: string, ts: string) => toolUse("SendMessage", { to: "team-lead", message }, ts);
const toolResult = (promptId: string, ts: string) =>
  L({
    type: "user",
    promptId,
    timestamp: ts,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "h", content: "Delivered." }] },
  });
const writeFile = (ts: string) => toolUse("Write", { file_path: "notes.md", content: "x" }, ts);

/** Stretch 1 of a run: prompt P1, working text, no hand-back call. */
const stretch1 = (extra = "") =>
  userPrompt("P1", "implement it", T1) + extra + assistantText("Build started; waiting.", T1);
/** Stretch 2: a coordinator resume with its own promptId. */
const stretch2 = (extra = "") => resumePrompt("P2", T2) + extra + assistantText("Resumed; checking.", T2);
const subagentLabelled = (label: string) => `Done.\n"verdict": "SUCCESS"\nHANDOFF: ${label}`;

function stopWith(root: string, agent: string, id: string, body: string, name: string) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, body);
  return subagentStop(root, agent, id, { agent_transcript_path: file });
}

describe("probe 160 gap: a workflow agent started inside another run (documented limit)", () => {
  it("PINS the limit: a workflow agent dispatched while backend is interim counts as the orchestrator moving on, so backend is flagged on the first check", async () => {
    // A workflow agent started by another agent's run cannot be told from the orchestrator's own
    // dispatch (handoff-contract.md documents it). This pins that the marker is then promoted at once.
    const root = await installed();
    subagentStart(root, "backend", "g1");
    stopWith(root, "backend", "g1", stretch1(), "g1-a.jsonl");
    subagentStart(root, "test", "g2"); // a workflow agent, started inside backend's run
    const out = handoffIssues(root).stdout;
    expect(out).toContain("backend: NO HANDOFF line");
    expect(out).not.toContain("not flagged yet");
  });
});

describe("probe 160 gap: the seen path followed by a resume", () => {
  it("first check shows 'not flagged yet' (marker seen), a resume clears it, and the valid final leaves nothing behind", async () => {
    const root = await installed();
    writePayload(root, "test", "backend");
    subagentStart(root, "backend", "s1");
    stopWith(root, "backend", "s1", stretch1(), "s1-a.jsonl");
    const first = handoffIssues(root).stdout;
    expect(first).toContain("not flagged yet");
    expect(pendingInterim(root).s1.seen).toBe(true);

    subagentStart(root, "backend", "s1"); // resumed after the orchestrator looked once
    expect(pendingInterim(root)).toEqual({});
    const r = stopWith(
      root,
      "backend",
      "s1",
      stretch1() + stretch2() + handbackCall(subagentLabelled("success"), T3),
      "s1-b.jsonl"
    );
    expect(r.stdout).not.toContain("problem");
    const out = handoffIssues(root).stdout;
    expect(out).toContain("no problems recorded");
    expect(out).not.toContain("NO HANDOFF");
  });

  it("seen, resumed, a new interim stop, then never resumed: the new marker is first 'not flagged yet', then flagged; it is not flagged on the earlier seen", async () => {
    const root = await installed();
    subagentStart(root, "backend", "s2");
    stopWith(root, "backend", "s2", stretch1(), "s2-a.jsonl");
    expect(handoffIssues(root).stdout).toContain("not flagged yet");

    subagentStart(root, "backend", "s2");
    stopWith(root, "backend", "s2", stretch1() + stretch2(), "s2-b.jsonl"); // interim again, no hand-back
    const second = handoffIssues(root).stdout;
    expect(second).toContain("not flagged yet");
    expect(second).not.toContain("NO HANDOFF");
    const third = handoffIssues(root).stdout;
    expect(third).toMatch(/backend: NO HANDOFF line/);
    expect(third.match(/backend:/g)?.length).toBe(1);
    expect(pendingInterim(root)).toEqual({});
  });
});

describe("probe 160 gap: a malformed label inside a SendMessage (final stop)", () => {
  it("control: a labelled SendMessage final is a hand-back and raises no problem", async () => {
    const root = await installed();
    subagentStart(root, "backend", "m0");
    stopWith(root, "backend", "m0", stretch1(), "m0-a.jsonl");
    subagentStart(root, "backend", "m0");
    writePayload(root, "test", "backend");
    const r = stopWith(
      root,
      "backend",
      "m0",
      stretch1() + stretch2() + sendMessageCall(subagentLabelled("success"), T3) + toolResult("P2", T3),
      "m0-b.jsonl"
    );
    expect(r.stdout).not.toContain("problem");
    expect(handoffIssues(root).stdout).toContain("no problems recorded");
  });

  it("a resumed final that ends with SendMessage 'HANDOFF success' (no colon) is flagged missing at that stop, as the SubagentHandback form is", async () => {
    // The same malformed line through SubagentHandback is flagged at the stop (interim-stop-160-qa:
    // 'a malformed HANDOFF line on a resumed final'). Through SendMessage it has no colon, so the scan
    // reads it as a labelless progress note; the required outcome is still an immediate flag.
    const root = await installed();
    subagentStart(root, "backend", "m1");
    stopWith(root, "backend", "m1", stretch1(), "m1-a.jsonl");
    subagentStart(root, "backend", "m1");
    const r = stopWith(
      root,
      "backend",
      "m1",
      stretch1() + stretch2() + sendMessageCall('"verdict": "SUCCESS"\nHANDOFF success', T3),
      "m1-b.jsonl"
    );
    expect(r.stdout).toContain("handoff problem (missing)");
  });

  it("a first and only stop that ends with SendMessage 'HANDOFF success' (no colon, never resumed) is flagged at the stop, not deferred", async () => {
    const root = await installed();
    subagentStart(root, "backend", "m2");
    const r = stopWith(
      root,
      "backend",
      "m2",
      stretch1() + sendMessageCall('"verdict": "SUCCESS"\nHANDOFF success', T2),
      "m2-a.jsonl"
    );
    expect(r.stdout).toContain("handoff problem (missing)");
  });
});

describe("probe 160 gap: a hand-back that flushes after the 3 s wait", () => {
  it("a valid labelled final whose SubagentHandback lands after the stop's 3 s wait is not reported as 'NO HANDOFF line' by the later check", async () => {
    // The stop reads the transcript, waits 3 s, sees no hand-back call, and records the stop as interim.
    // The hand-back then lands (a late flush). Nothing re-reads the transcript after that, so the
    // never-resumed marker is promoted to a `missing` issue on the second check, for a run that did
    // hand back with a valid label. Required outcome: no false 'NO HANDOFF line'.
    const root = await installed();
    subagentStart(root, "backend", "f1");
    const transcript = path.join(tmp, "f1-a.jsonl");
    fs.writeFileSync(transcript, stretch1());
    const stop = subagentStop(root, "backend", "f1", { agent_transcript_path: transcript });
    expect(stop.stdout).not.toContain("problem");

    // The late flush: the hand-back and its tool result reach the transcript after the stop returned.
    fs.appendFileSync(transcript, handbackCall(subagentLabelled("success"), T2) + toolResult("P1", T2));

    const first = handoffIssues(root).stdout;
    expect(first).not.toContain("NO HANDOFF line");
    const second = handoffIssues(root).stdout;
    expect(second).not.toContain("NO HANDOFF line");
  });
});

describe("negative control: the pre-160 plugin (ea0a2b0) on the two defect sequences", () => {
  it("HEAD flags a malformed SendMessage final at its stop, so the deferral in the current tree is a regression", async () => {
    const root = await installed(preChangePluginRoot());
    subagentStart(root, "backend", "n1");
    stopWith(root, "backend", "n1", stretch1(), "n1-a.jsonl");
    subagentStart(root, "backend", "n1");
    const r = stopWith(
      root,
      "backend",
      "n1",
      stretch1() + stretch2() + sendMessageCall('"verdict": "SUCCESS"\nHANDOFF success', T3),
      "n1-b.jsonl"
    );
    expect(r.stdout).toContain("handoff problem (missing)");
  });

  it("HEAD flags a late-flush valid final at its stop, so that false flag predates 160 and is not fixed by it", async () => {
    const root = await installed(preChangePluginRoot());
    subagentStart(root, "backend", "n2");
    const transcript = path.join(tmp, "n2-a.jsonl");
    fs.writeFileSync(transcript, stretch1());
    const stop = subagentStop(root, "backend", "n2", { agent_transcript_path: transcript });
    expect(stop.stdout).toContain("handoff problem (missing)");
  });
});

describe("probe 160 gap: a loop-back whose second cycle writes no new payload (whole-run rule)", () => {
  it("PINS the trade-off: cycle 1's payload (already consumed by test) satisfies loop-back cycle 2, which edited a file and wrote none", async () => {
    // The whole-run rule measures from the first dispatch, so a loop-back resume (the same agent id, 039)
    // inherits cycle 1's payload. The spec's "across resumes" wording requires this; the cost is that a
    // stale payload the receiver already read can pass a cycle that did not rewrite it. Pinned, not a
    // defect under the stated rule: the judgement is for the user (see the report).
    const root = await installed();
    subagentStart(root, "backend", "lb1");
    writePayload(root, "test", "backend", 1);
    expect(
      stopWith(
        root,
        "backend",
        "lb1",
        stretch1() + handbackCall(subagentLabelled("success"), T2) + toolResult("P1", T2),
        "lb1-a.jsonl"
      ).stdout
    ).not.toContain("problem");

    // test receives backend.1.md, runs, and fails; the orchestrator loops back to backend.
    subagentStart(root, "test", "lb-t");
    subagentStart(root, "backend", "lb1");
    const cycle2 =
      stretch1() +
      handbackCall(subagentLabelled("success"), T2) +
      toolResult("P1", T2) +
      resumePrompt("P9", T3) +
      writeFile(T3) +
      handbackCall(subagentLabelled("success"), T3) +
      toolResult("P9", T3);
    const r = stopWith(root, "backend", "lb1", cycle2, "lb1-b.jsonl");
    expect(r.stdout).not.toContain("problem");
    expect(readState(root).handoff_issues ?? []).toEqual([]);
  });
});
