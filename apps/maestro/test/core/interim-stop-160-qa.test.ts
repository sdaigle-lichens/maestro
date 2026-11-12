// QA probes for `160` through the REAL installed SubagentStop script. Two groups:
//   1. negative control: the same two false modes against the PRE-change plugin (ea0a2b0), extracted
//      with `git archive`, so the reproduction is shown on the code that shipped the bug.
//   2. probes beyond the implementer's own tests: a real resume prompt boundary (promptId change),
//      a mid-run SendMessage, labelless / malformed / mismatched finals after an interim stop, unknown
//      route after resume, payload-window edges (an earlier run's file under a different agent id, a
//      payload written in the first stretch and not stamped at an interim stop), unreadable transcript.
// Temp projects, a temp HOME, real installed scripts, nothing mocked.

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

const SESS = "sess-qa160-bbbb";
const SCOPE = "session-sess-qa1";

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
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-qa160-")));
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

async function installedFrom(pluginRoot: string): Promise<string> {
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
const installed = () => installedFrom(PLUGIN_ROOT);

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
function writePayload(root: string, receiver: string, sender: string, body = "{}\n") {
  fs.mkdirSync(path.dirname(payloadFile(root, receiver, sender)), { recursive: true });
  fs.writeFileSync(payloadFile(root, receiver, sender), body);
}
function agePayload(root: string, receiver: string, sender: string) {
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(payloadFile(root, receiver, sender), old, old);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── transcript pieces. Dated 2099 so every entry reads as after the dispatch; `2001` = an earlier run. ──
const L = (o: unknown) => JSON.stringify(o) + "\n";
const T1 = "2099-10-01T10:00:00.000Z";
const T2 = "2099-10-01T10:30:00.000Z";
const T3 = "2099-10-01T11:00:00.000Z";
const userPrompt = (promptId: string, text: string, ts: string) =>
  L({ type: "user", promptId, timestamp: ts, message: { role: "user", content: text } });
/** The coordinator's resume prompt: a new promptId, isMeta, coordinator origin (the real boundary). */
const resumePrompt = (promptId: string, ts: string) =>
  L({
    type: "user",
    promptId,
    isMeta: true,
    origin: { kind: "coordinator" },
    timestamp: ts,
    message: { role: "user", content: "The coordinator sent a message while you were working: continue" },
  });
const assistantText = (text: string, ts: string) =>
  L({ type: "assistant", timestamp: ts, message: { content: [{ type: "text", text }] } });
const toolUse = (name: string, input: unknown, ts: string) =>
  L({ type: "assistant", timestamp: ts, message: { content: [{ type: "tool_use", id: name, name, input }] } });
const handbackCall = (report: string, ts: string) => toolUse("SubagentHandback", { message: report }, ts);
const toolResult = (promptId: string, ts: string) =>
  L({
    type: "user",
    promptId,
    timestamp: ts,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "h", content: "Delivered." }] },
  });
const writeFile = (ts: string) => toolUse("Write", { file_path: "notes.md", content: "x" }, ts);
const sendMessageNote = (ts: string) =>
  toolUse("SendMessage", { to: "team-lead", message: "progress: build at 40%" }, ts);

/** Stretch 1 of an agent run: prompt P1, working text, no hand-back. */
const stretch1 = (extra = "") =>
  userPrompt("P1", "implement it", T1) + extra + assistantText("Build started; waiting.", T1);
/** Stretch 2: a coordinator resume with its own promptId. */
const stretch2 = (extra = "") => resumePrompt("P2", T2) + extra + assistantText("Resumed; checking.", T2);
const OK = '"verdict": "SUCCESS"\nHANDOFF: success';

function stopWith(
  root: string,
  agent: string,
  id: string,
  body: string,
  name: string,
  extra: Record<string, unknown> = {}
) {
  const file = path.join(tmp, name);
  fs.writeFileSync(file, body);
  return subagentStop(root, agent, id, { agent_transcript_path: file, ...extra });
}

describe("negative control: the pre-160 hook reproduces both false modes (task 075)", () => {
  it("HEAD flags an interim stop with no HANDOFF line as missing", async () => {
    const root = await installedFrom(preChangePluginRoot());
    subagentStart(root, "backend", "a7d80d9d");
    const r = stopWith(root, "backend", "a7d80d9d", stretch1(), "head-interim.jsonl");
    expect(r.stdout).toContain("handoff problem (missing)");
  }, 40_000);

  it("HEAD flags a final success whose payload predates the latest resume as missing_payload", async () => {
    const root = await installedFrom(preChangePluginRoot());
    subagentStart(root, "backend", "a7d80d9d");
    writePayload(root, "test", "backend");
    stopWith(root, "backend", "a7d80d9d", stretch1(), "head-w1.jsonl");
    await sleep(1400);
    subagentStart(root, "backend", "a7d80d9d");
    const r = stopWith(root, "backend", "a7d80d9d", stretch1() + stretch2() + handbackCall(OK, T3), "head-w2.jsonl");
    expect(r.stdout).toContain("handoff problem (missing_payload)");
  }, 40_000);
});

describe("probes: resumed runs with a real coordinator boundary (promptId change)", () => {
  it("interim, then a coordinator resume that hands back success with the payload from stretch 1: no issue", async () => {
    const root = await installed();
    subagentStart(root, "backend", "r1");
    writePayload(root, "test", "backend");
    expect(stopWith(root, "backend", "r1", stretch1(), "r1-a.jsonl").stdout).not.toContain("problem");
    await sleep(1400);
    subagentStart(root, "backend", "r1");
    const r = stopWith(
      root,
      "backend",
      "r1",
      stretch1() + stretch2() + handbackCall(OK, T3) + toolResult("P2", T3),
      "r1-b.jsonl"
    );
    expect(r.stdout).not.toContain("problem");
    expect(pendingIssues(root)).toEqual([]);
    expect(handoffEntries(root, "r1").at(-1)).toMatchObject({ status: "success", label: "success" });
  }, 40_000);

  it("the resume prompt flushed but no new hand-back yet: still interim, no issue, no log tag", async () => {
    const root = await installed();
    subagentStart(root, "backend", "r2");
    stopWith(root, "backend", "r2", stretch1(), "r2-a.jsonl");
    subagentStart(root, "backend", "r2");
    const r = stopWith(root, "backend", "r2", stretch1() + stretch2(), "r2-b.jsonl");
    expect(r.stdout).not.toContain("problem");
    const last = handoffEntries(root, "r2").at(-1)!;
    expect(last.interim).toBe(true);
    expect(last.handoff_issue).toBeUndefined();
    expect(last.log).not.toContain("[missing");
  }, 40_000);

  it("a resumed final with a labelless SubagentHandback after an interim stop is flagged missing", async () => {
    const root = await installed();
    subagentStart(root, "backend", "r3");
    stopWith(root, "backend", "r3", stretch1(), "r3-a.jsonl");
    subagentStart(root, "backend", "r3");
    const r = stopWith(
      root,
      "backend",
      "r3",
      stretch1() + stretch2() + handbackCall("Done, no label.", T3),
      "r3-b.jsonl"
    );
    expect(r.stdout).toContain("handoff problem (missing)");
    expect(pendingIssues(root)).toHaveLength(1);
  }, 40_000);

  it("a resumed final whose hand-back says FAIL but ends HANDOFF: success after an interim stop is a contradiction", async () => {
    const root = await installed();
    subagentStart(root, "backend", "r4");
    stopWith(root, "backend", "r4", stretch1(), "r4-a.jsonl");
    subagentStart(root, "backend", "r4");
    const r = stopWith(
      root,
      "backend",
      "r4",
      stretch1() + stretch2() + handbackCall('"verdict": "FAIL"\nHANDOFF: success', T3),
      "r4-b.jsonl"
    );
    expect(r.stdout).toContain("handoff problem (contradiction)");
  }, 40_000);

  it("a resumed final whose label has no edge in the active workflow is flagged unrouted", async () => {
    const root = await installed();
    execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: home },
    });
    const set = projectScript(root, "maestro-set-session-workflow.cjs", ["feature"]);
    expect(set.code, set.stdout + set.stderr).toBe(0);
    subagentStart(root, "test", "t2");
    stopWith(root, "test", "t2", stretch1(), "t2-a.jsonl");
    subagentStart(root, "test", "t2");
    const r = stopWith(
      root,
      "test",
      "t2",
      stretch1() + stretch2() + handbackCall('"verdict": "SUCCESS"\nHANDOFF: partial', T3),
      "t2-b.jsonl"
    );
    expect(r.stdout).toContain("handoff problem (unrouted)");
  }, 40_000);

  it("a malformed HANDOFF line on a resumed final (no colon) is flagged missing, not success", async () => {
    const root = await installed();
    subagentStart(root, "backend", "r5");
    stopWith(root, "backend", "r5", stretch1(), "r5-a.jsonl");
    subagentStart(root, "backend", "r5");
    const r = stopWith(
      root,
      "backend",
      "r5",
      stretch1() + stretch2() + handbackCall('"verdict": "SUCCESS"\nHANDOFF success', T3),
      "r5-b.jsonl"
    );
    expect(r.stdout).toContain("handoff problem (missing)");
  }, 40_000);

  it("payload never written in the whole run, resumed run did write a non-payload file: missing_payload", async () => {
    const root = await installed();
    subagentStart(root, "backend", "r6");
    stopWith(root, "backend", "r6", stretch1(writeFile(T1)), "r6-a.jsonl");
    subagentStart(root, "backend", "r6");
    const r = stopWith(
      root,
      "backend",
      "r6",
      stretch1(writeFile(T1)) + stretch2(writeFile(T2)) + handbackCall(OK, T3),
      "r6-b.jsonl"
    );
    expect(r.stdout).toContain("handoff problem (missing_payload)");
  }, 40_000);

  it("resumed run that only re-verified (no writes) after a payload in stretch 1: not flagged (payload counts)", async () => {
    const root = await installed();
    subagentStart(root, "backend", "r7");
    writePayload(root, "test", "backend");
    stopWith(root, "backend", "r7", stretch1(writeFile(T1)), "r7-a.jsonl");
    await sleep(1400);
    subagentStart(root, "backend", "r7");
    const r = stopWith(
      root,
      "backend",
      "r7",
      stretch1(writeFile(T1)) + stretch2() + handbackCall(OK, T3),
      "r7-b.jsonl"
    );
    expect(r.stdout).not.toContain("problem");
  }, 40_000);
});

describe("probes: the payload window across runs and stamps", () => {
  it("a stale payload from an EARLIER run (different agent id, dispatched before this run) does not count after interim + resume", async () => {
    const root = await installed();
    subagentStart(root, "backend", "old1");
    writePayload(root, "test", "backend");
    const stopOld = stopWith(root, "backend", "old1", stretch1(), "old1-a.jsonl");
    expect(stopOld.stdout).not.toContain("problem");
    // the old run's hand-back (labelled, final) is what left the file behind
    stopWith(root, "backend", "old1", stretch1() + handbackCall(OK, T2), "old1-b.jsonl");
    agePayload(root, "test", "backend");
    subagentStart(root, "backend", "new1");
    expect(stopWith(root, "backend", "new1", stretch1(), "new1-a.jsonl").stdout).not.toContain("problem");
    subagentStart(root, "backend", "new1");
    const r = stopWith(root, "backend", "new1", stretch1() + stretch2() + handbackCall(OK, T3), "new1-b.jsonl");
    expect(r.stdout).toContain("handoff problem (missing_payload)");
  }, 60_000);

  it("a payload written in stretch 1 is still unstamped after the interim stop, and stamped by the final stop", async () => {
    const root = await installed();
    subagentStart(root, "backend", "s1");
    writePayload(root, "test", "backend", "{}\n");
    stopWith(root, "backend", "s1", stretch1(), "s1-a.jsonl");
    expect(fs.readFileSync(payloadFile(root, "test", "backend"), "utf8")).toBe("{}\n");
    await sleep(1400);
    subagentStart(root, "backend", "s1");
    const r = stopWith(root, "backend", "s1", stretch1() + stretch2() + handbackCall(OK, T3), "s1-b.jsonl");
    expect(r.stdout).not.toContain("problem");
    expect(fs.readFileSync(payloadFile(root, "test", "backend"), "utf8")).not.toBe("{}\n");
  }, 40_000);

  it("an interim stop touches no channel file mtime (a stale file is not refreshed into the window)", async () => {
    const root = await installed();
    writePayload(root, "test", "backend");
    agePayload(root, "test", "backend");
    const before = fs.statSync(payloadFile(root, "test", "backend")).mtimeMs;
    subagentStart(root, "backend", "m1");
    stopWith(root, "backend", "m1", stretch1(), "m1-a.jsonl");
    expect(fs.statSync(payloadFile(root, "test", "backend")).mtimeMs).toBe(before);
  }, 30_000);
});

describe("probes: interim stop edge cases", () => {
  it("interim stop after a non-final mid-run SendMessage progress note is still interim (no hand-back yet)", async () => {
    const root = await installed();
    subagentStart(root, "backend", "sm1");
    const body = stretch1(sendMessageNote(T1));
    const r = stopWith(root, "backend", "sm1", body, "sm1-a.jsonl");
    expect(r.stdout, "a progress SendMessage is not a hand-back").not.toContain("handoff problem");
  }, 30_000);

  it("interim stop after an earlier run's labelled hand-back (same agent id, resumed) is interim, not judged on the old label", async () => {
    const root = await installed();
    subagentStart(root, "backend", "e1");
    stopWith(root, "backend", "e1", stretch1() + handbackCall(OK, "2001-01-01T00:00:00.000Z"), "e1-a.jsonl");
    subagentStart(root, "backend", "e1");
    const r = stopWith(root, "backend", "e1", stretch1() + stretch2(), "e1-b.jsonl");
    expect(r.stdout).not.toContain("problem");
    expect(handoffEntries(root, "e1").at(-1)?.interim).toBe(true);
  }, 40_000);

  it("unreadable transcript path at a stop is judged as before, not treated as interim", async () => {
    const root = await installed();
    subagentStart(root, "backend", "u1");
    const r = subagentStop(root, "backend", "u1", {
      agent_transcript_path: path.join(tmp, "does-not-exist.jsonl"),
      last_assistant_message: "Still working on the build.",
    });
    expect(r.stdout).toContain("handoff problem (missing)");
  }, 30_000);

  it("a labelless final stop with no hand-back call and no transcript is still flagged (never interim by default)", async () => {
    const root = await installed();
    subagentStart(root, "backend", "u2");
    const r = subagentStop(root, "backend", "u2", { last_assistant_message: "all done" });
    expect(r.stdout).toContain("handoff problem (missing)");
  }, 30_000);
});
