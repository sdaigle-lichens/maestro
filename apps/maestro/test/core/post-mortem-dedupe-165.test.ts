// 165 regression pass over the post-mortem digest's dispatch dedupe (one row per agent_id, first
// dispatch kept, last handoff wins). Part one drives the REAL SubagentStart, SubagentStop and
// handoff-issues scripts into a temp project and digests the log they wrote. Part two covers the
// dedupe's edges on fixture logs: two agents, repeated resumes, no-return, no agent_id, meetings.
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

const SESS = "sess-165-dd";

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
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-165-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── real hooks ────────────────────────────────────────────────────────────────────────────────────

function env(root: string): NodeJS.ProcessEnv {
  return { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: home, CLAUDE_CODE_SESSION_ID: SESS };
}

function projectScript(root: string, name: string, args: string[], input?: unknown) {
  const r = spawnSync("node", [path.join(root, ".claude", "scripts", name), ...args], {
    encoding: "utf8",
    env: env(root),
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

function stopWith(root: string, agent: string, id: string, transcriptBody: string, name: string) {
  const file = path.join(tmp, name);
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
const OK = '"verdict": "SUCCESS"\nHANDOFF: success';

function digestLog(root: string): Record<string, any> {
  const r = spawnSync("node", [DIGEST, root, "--session", SESS, "--json"], { encoding: "utf8", env: env(root) });
  expect(r.status, r.stderr).toBe(0);
  return JSON.parse(r.stdout);
}

function realLog(root: string): Record<string, any>[] {
  return fs
    .readFileSync(path.join(root, ".claude", "maestro_sessions", SESS, "log.jsonl"), "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

describe("the digest over the real hook scripts (165)", () => {
  it("a resumed run is one success: two real dispatch rows, one digest row", async () => {
    const root = await installed();
    expect(subagentStart(root, "backend", "a1").code).toBe(0);
    expect(stopWith(root, "backend", "a1", interimTranscript(), "r-1.jsonl").code).toBe(0);
    subagentStart(root, "backend", "a1"); // the resume: a second dispatch entry, same agent_id
    expect(stopWith(root, "backend", "a1", finalTranscript(OK), "r-2.jsonl").code).toBe(0);

    expect(realLog(root).filter((e) => e.kind === "dispatch" && e.agent_id === "a1")).toHaveLength(2);
    const a = digestLog(root);
    expect(a.outcomes).toEqual({ success: 1 });
    expect(a.subagents).toHaveLength(1);
    expect(a.counts.dispatches).toBe(1);
    expect(a.problems).toEqual([]);
  });

  it("a never-resumed interim stop settled by handoff-issues is still missing HANDOFF, and the log is untouched", async () => {
    const root = await installed();
    subagentStart(root, "test", "m1");
    expect(stopWith(root, "test", "m1", interimTranscript(), "m-1.jsonl").code).toBe(0);
    // 160's second handoff check settles the interim stop as missing in session.json only.
    expect(handoffIssues(root).stdout).toContain("not flagged yet");
    expect(handoffIssues(root).stdout).toContain("test: NO HANDOFF line");
    expect(handoffIssues(root).stdout).toContain("no problems recorded");

    const handoffs = realLog(root).filter((e) => e.kind === "handoff" && e.agent_id === "m1");
    expect(handoffs).toHaveLength(1);
    expect(handoffs[0]).toMatchObject({ interim: true });
    expect(handoffs[0].handoff_issue).toBeUndefined();

    const a = digestLog(root);
    expect(a.outcomes).toEqual({ "missing HANDOFF": 1 });
    expect(a.problems.map((p: { agent_id: string }) => p.agent_id)).toEqual(["m1"]);
  });

  it("one session with a resumed success, a never-resumed interim stop and a final stop with no label", async () => {
    const root = await installed();
    subagentStart(root, "backend", "a1");
    stopWith(root, "backend", "a1", interimTranscript(), "c-1.jsonl");
    subagentStart(root, "backend", "a1");
    stopWith(root, "backend", "a1", finalTranscript(OK), "c-2.jsonl");
    subagentStart(root, "test", "m1");
    stopWith(root, "test", "m1", interimTranscript(), "c-3.jsonl");
    subagentStart(root, "scribe", "f1");
    stopWith(root, "scribe", "f1", finalTranscript("Wrote the docs, no label."), "c-4.jsonl");

    const a = digestLog(root);
    expect(a.outcomes).toEqual({ success: 1, "missing HANDOFF": 2 });
    expect(a.subagents.map((s: { agent_id: string }) => s.agent_id).sort()).toEqual(["a1", "f1", "m1"]);
    expect(a.counts.dispatches).toBe(3);
  });
});

// ── fixture logs: the dedupe's edges ──────────────────────────────────────────────────────────────

type Entry = Record<string, unknown>;
const dispatch = (id: string | null, agent: string, input = "go"): Entry => ({
  kind: "dispatch",
  origin: "main_session",
  agent,
  input,
  ...(id === null ? {} : { agent_id: id }),
});
const handoff = (id: string | null, agent: string, label: string | null, extra: Entry = {}): Entry => ({
  kind: "handoff",
  origin: agent,
  ...(id === null ? {} : { agent_id: id }),
  status: label === null ? "unknown" : label === "success" ? "success" : "condition",
  label,
  output: "done",
  ...extra,
});
const interim = (id: string, agent: string): Entry =>
  handoff(id, agent, null, { interim: true, output: "waiting", log: "interim stop (no hand-back yet)" });

function fixtureDigest(entries: Entry[]): Record<string, any> {
  const root = fs.mkdtempSync(path.join(tmp, "fx-"));
  const dir = path.join(root, ".claude", "maestro_sessions", SESS);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "log.jsonl"), entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  fs.writeFileSync(path.join(dir, "session.json"), "{}");
  return digestLog(root);
}

describe("the dedupe's edges on fixture logs (165)", () => {
  it("two different agents, each resumed once, are two outcomes", () => {
    const a = fixtureDigest([
      dispatch("x1", "backend"),
      interim("x1", "backend"),
      dispatch("x1", "backend"),
      handoff("x1", "backend", "success"),
      dispatch("y1", "test", "second agent"),
      interim("y1", "test"),
      dispatch("y1", "test"),
      handoff("y1", "test", "fail"),
    ]);
    expect(a.outcomes).toEqual({ success: 1, fail: 1 });
    expect(a.subagents.map((s: { agent_id: string; label: string }) => [s.agent_id, s.label]).sort()).toEqual([
      ["x1", "success"],
      ["y1", "fail"],
    ]);
    expect(a.counts.dispatches).toBe(2);
    expect(a.counts.handoffs).toBe(4);
  });

  it("an agent resumed three times is one row, and its final stop decides", () => {
    const a = fixtureDigest([
      dispatch("r", "backend"),
      interim("r", "backend"),
      dispatch("r", "backend"),
      interim("r", "backend"),
      dispatch("r", "backend"),
      handoff("r", "backend", "success"),
    ]);
    expect(a.outcomes).toEqual({ success: 1 });
    expect(a.subagents).toHaveLength(1);
    expect(a.counts.dispatches).toBe(1);
    expect(a.counts.handoffs).toBe(3);
  });

  it("resumed, then stopped interim again with nothing after: one missing HANDOFF", () => {
    const a = fixtureDigest([
      dispatch("r", "backend"),
      interim("r", "backend"),
      dispatch("r", "backend"),
      interim("r", "backend"),
    ]);
    expect(a.outcomes).toEqual({ "missing HANDOFF": 1 });
    expect(a.subagents).toHaveLength(1);
    expect(a.subagents[0].interim).toBe(true);
  });

  it("a no-return agent that was dispatched twice is one no-return", () => {
    const a = fixtureDigest([dispatch("n", "reviewer"), dispatch("n", "reviewer")]);
    expect(a.outcomes).toEqual({ "no-return": 1 });
    expect(a.subagents).toHaveLength(1);
    expect(a.counts.dispatches).toBe(1);
  });

  it("the row keeps the FIRST dispatch's input, not the resume prompt", () => {
    const a = fixtureDigest([
      dispatch("f", "backend", "original task"),
      dispatch("f", "backend", "resume prompt"),
      handoff("f", "backend", "success"),
    ]);
    expect(a.subagents[0].input).toBe("original task");
  });

  it("dispatch entries with no agent_id are each kept, alongside a keyed agent", () => {
    const a = fixtureDigest([
      dispatch(null, "backend"),
      dispatch(null, "backend"),
      dispatch("k", "test"),
      dispatch("k", "test"),
      handoff("k", "test", "success"),
    ]);
    expect(a.subagents).toHaveLength(3);
    expect(a.counts.dispatches).toBe(3);
    expect(a.subagents.filter((s: { agent_id: string }) => s.agent_id === "")).toHaveLength(2);
  });

  it("a meeting turn with the same agent_id never overrides the workflow outcome", () => {
    const a = fixtureDigest([
      dispatch("m", "backend"),
      handoff("m", "backend", "fail"),
      handoff("m", "backend", "success", { meeting: true }),
    ]);
    expect(a.outcomes).toEqual({ fail: 1 });
    expect(a.counts.meetingTurns).toBe(1);
  });
});
