// `087` through the REAL scripts: the readiness check's semantic version compare (and the app's
// refreshStaleRuntime reaching the same verdict), /maestro-update's installer refusing a downgrade,
// the SubagentStop hook's third issue (`missing_payload`), the required-payload instruction on a
// first run / cold re-run / resume, and the `SubagentHandback` hand-back recovery behind 084's false
// missing-HANDOFF flags. Temp projects, a temp HOME, nothing mocked. HOME pinned and
// CLAUDE_CODE_SESSION_ID always set or deleted (never inherited).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  installRuntime,
  installStatus,
  findUpPluginRoot,
  refreshStaleRuntime,
  shippedRuntimeVersion,
} from "../../src/core/install.js";
import { writeConfig, readConfig } from "../../src/core/config.js";
import { compareRuntimeVersions, runtimeNeedsRefresh } from "../../src/core/runtime-version.js";
import { checkPayload } from "../../src/core/handoff-check.js";
import { handbackHandoff } from "../../src/core/handoff-label.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const PLUGIN_SCRIPTS = path.join(PLUGIN_ROOT, "scripts");

vi.setConfig({ testTimeout: 30_000 });

const SESS = "sess-087-aaa";

// main -> backend -> test -> scribe, and test -> backend on "tests failed".
// backend/test and test/backend resolve a seeded protocol (a payload is expected); test/scribe
// resolves none anywhere (no payload expected).
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
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-087-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function env(root: string, sessionId: string | null): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: home };
  if (sessionId === null) delete e.CLAUDE_CODE_SESSION_ID;
  else e.CLAUDE_CODE_SESSION_ID = sessionId;
  return e;
}

function run(file: string, args: string[], root: string, sessionId: string | null, input?: unknown) {
  const r = spawnSync("node", [file, ...args], {
    encoding: "utf8",
    env: env(root, sessionId),
    ...(input !== undefined ? { input: JSON.stringify(input) } : {}),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const projectScript = (root: string, name: string, args: string[], input?: unknown, sessionId: string | null = SESS) =>
  run(path.join(root, ".claude", "scripts", name), args, root, sessionId, input);

const sessionDir = (root: string) => path.join(root, ".claude", "maestro_sessions", SESS);
const readState = (root: string) => JSON.parse(fs.readFileSync(path.join(sessionDir(root), "session.json"), "utf8"));
const readLog = (root: string): Record<string, any>[] => {
  const f = path.join(sessionDir(root), "log.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
};
const lane = (root: string, receiver: string, sender: string) =>
  path.join(root, ".claude", "channels", receiver, `${sender}.1.md`);
function writePayload(root: string, receiver: string, sender: string, body = "{}\n") {
  fs.mkdirSync(path.dirname(lane(root, receiver, sender)), { recursive: true });
  fs.writeFileSync(lane(root, receiver, sender), body);
}

async function installed(name = "repo"): Promise<string> {
  const root = path.join(tmp, name);
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

function inject(root: string, agent: string, id: string): string {
  const r = projectScript(root, "maestro-inject-agent-context.cjs", [], {
    cwd: root,
    session_id: SESS,
    hook_event_name: "SubagentStart",
    agent_type: agent,
    agent_id: id,
  });
  expect(r.code, r.stderr).toBe(0);
  if (!r.stdout.trim()) return "";
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string;
}

// A meeting needs a ready project (its start runs the readiness check), so render first.
function startMeeting(root: string) {
  execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root], {
    env: env(root, null),
  });
  const m = run(
    path.join(PLUGIN_SCRIPTS, "maestro-team-meeting.cjs"),
    ["start", "--mode", "review", "--participants", "backend", root],
    root,
    SESS
  );
  expect(m.code, m.stdout + m.stderr).toBe(0);
}

const handoffEntry = (root: string, id: string) =>
  readLog(root)
    .filter((e) => e.kind === "handoff" && e.agent_id === id)
    .pop()!;

// ── 1. the readiness check: older / equal / newer ──────────────────────────────────────────────────

describe("readiness check compares versions semantically (087 item 1)", () => {
  function writeInstalledPlugins(version: string) {
    const dir = path.join(home, ".claude", "plugins");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "installed_plugins.json"),
      JSON.stringify({
        version: 1,
        plugins: {
          "maestro@maestro": [
            { scope: "user", version, installedAt: "2026-01-01T00:00:00.000Z", installPath: "/cache/maestro" },
          ],
        },
      })
    );
  }

  async function project(stamp: string | undefined): Promise<string> {
    const root = await installed();
    execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root], {
      env: env(root, null),
    });
    const current = readConfig(root)!;
    const next = { ...current } as MaestroConfigV3 & { runtimeVersion?: string };
    if (stamp === undefined) delete next.runtimeVersion;
    else next.runtimeVersion = stamp;
    writeConfig(root, next);
    return root;
  }

  const check = (root: string) =>
    JSON.parse(projectScript(root, "maestro-check-runtime.cjs", [], undefined, null).stdout);
  const step0 = (root: string) =>
    projectScript(
      root,
      "maestro-step0.cjs",
      [],
      { cwd: root, hook_event_name: "UserPromptExpansion", command_name: "maestro" },
      null
    );

  it("project NEWER than the plugin (the live 0.10.6 vs 0.10.5 case): continue, plugin-behind notice, no /maestro-update", async () => {
    const root = await project("0.10.6");
    writeInstalledPlugins("0.10.5");

    const result = check(root);
    expect(result).toMatchObject({ action: "continue", ok: true, stale: false, pluginBehind: true });
    expect(result.reason).toBe("project runtime 0.10.6 is newer than the installed plugin 0.10.5");
    expect(result.reason).not.toContain("behind");
    expect(result.notice).toContain("installed maestro plugin (0.10.5)");
    expect(result.notice).toContain("Do NOT run /maestro-update");

    const hook = step0(root);
    expect(hook.code, hook.stderr).toBe(0);
    expect(hook.stdout).toContain("newer than the installed maestro plugin");
    expect(hook.stdout).toContain("should be updated");
    expect(hook.stdout).not.toContain("Run /maestro-update first");
  });

  it("project OLDER than the plugin: update, as before", async () => {
    const root = await project("0.10.5");
    writeInstalledPlugins("0.10.6");

    expect(check(root)).toMatchObject({
      action: "update",
      stale: true,
      reason: "project runtime 0.10.5 is behind plugin 0.10.6",
    });
    const hook = step0(root);
    expect(hook.code).toBe(0);
    expect(hook.stdout).toContain("Run /maestro-update first");
  });

  it("EQUAL versions: continue, and the hook says nothing", async () => {
    const root = await project("0.10.6");
    writeInstalledPlugins("0.10.6");

    const result = check(root);
    expect(result).toMatchObject({ action: "continue", ok: true, stale: false });
    expect(result.notice).toBeUndefined();
    expect(step0(root).stdout).toBe("");
  });

  it("numeric, not lexical: 0.10.0 is newer than 0.9.9", async () => {
    const root = await project("0.10.0");
    writeInstalledPlugins("0.9.9");
    expect(check(root)).toMatchObject({ action: "continue", pluginBehind: true });
  });

  it("an unstamped or unparseable project version keeps today's behaviour: update", async () => {
    const unstamped = await project(undefined);
    writeInstalledPlugins("0.10.5");
    expect(check(unstamped)).toMatchObject({
      action: "update",
      reason: "project runtime (unstamped) is behind plugin 0.10.5",
    });

    fs.rmSync(path.join(tmp, "repo"), { recursive: true, force: true });
    const garbled = await project("not-a-version");
    expect(check(garbled)).toMatchObject({ action: "update", stale: true });
  });
});

describe("the app's refreshStaleRuntime reaches the same verdict (087 item 1)", () => {
  const dbs = () =>
    [
      path.join(tmp, "report-defaults.sqlite"),
      path.join(tmp, "project-tags.sqlite"),
      path.join(tmp, "handoff-defaults.sqlite"),
    ] as const;

  it("a project stamped NEWER than the shipped plugin is not refreshed (no downgrade)", async () => {
    const root = await installed();
    writeConfig(root, { ...readConfig(root)!, runtimeVersion: "99.0.0" });
    const hookFile = path.join(root, ".claude", "scripts", "maestro-session-log.cjs");
    fs.writeFileSync(hookFile, "// newer content from a newer release\n");

    expect(await refreshStaleRuntime(root, PLUGIN_ROOT, ...dbs())).toBeNull();
    expect(fs.readFileSync(hookFile, "utf8")).toBe("// newer content from a newer release\n");
    expect(readConfig(root)!.runtimeVersion).toBe("99.0.0");
  });

  it("a project stamped OLDER is refreshed and restamped", async () => {
    const root = await installed();
    writeConfig(root, { ...readConfig(root)!, runtimeVersion: "0.0.1" });
    expect(await refreshStaleRuntime(root, PLUGIN_ROOT, ...dbs())).not.toBeNull();
    expect(readConfig(root)!.runtimeVersion).toBe(shippedRuntimeVersion(PLUGIN_ROOT));
  });

  it("the shared comparison agrees with both callers", () => {
    expect(compareRuntimeVersions("0.10.6", "0.10.5")).toBe("newer");
    expect(compareRuntimeVersions("0.10.5", "0.10.6")).toBe("older");
    expect(compareRuntimeVersions("0.10.6", "0.10.6")).toBe("equal");
    expect(compareRuntimeVersions("0.10.0", "0.9.9")).toBe("newer");
    expect(compareRuntimeVersions("1.0.0-rc.1", "1.0.0")).toBe("older");
    expect(compareRuntimeVersions(undefined, "0.10.5")).toBe("unknown");
    expect(compareRuntimeVersions("garbage", "0.10.5")).toBe("unknown");
    expect(runtimeNeedsRefresh("0.10.6", "0.10.5")).toBe(false);
    expect(runtimeNeedsRefresh("0.10.5", "0.10.6")).toBe(true);
    expect(runtimeNeedsRefresh(undefined, "0.10.6")).toBe(true);
    expect(runtimeNeedsRefresh("0.10.6", "0.10.6")).toBe(false);
  });
});

describe("/maestro-update's installer refuses a downgrade unless asked (087 item 1)", () => {
  const pluginVersion = () => shippedRuntimeVersion(PLUGIN_ROOT)!;
  function project(stamp: string): string {
    const root = path.join(tmp, "dg");
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeConfig(root, { ...cfg, runtimeVersion: stamp } as MaestroConfigV3);
    return root;
  }
  const install = (root: string, extra: string[] = []) =>
    run(path.join(PLUGIN_SCRIPTS, "maestro-install.js"), [root, ...extra], root, null);

  it("refuses, writes nothing, and says why when the project is newer", () => {
    const root = project("99.0.0");
    const before = fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8");

    const r = install(root);
    expect(r.code).toBe(1);
    const out = JSON.parse(r.stdout);
    expect(out).toMatchObject({
      ok: false,
      refused: "downgrade",
      projectRuntimeVersion: "99.0.0",
      pluginVersion: pluginVersion(),
    });
    expect(out.reason).toContain("newer than this maestro plugin");
    expect(out.reason).toContain("--allow-downgrade");
    expect(r.stderr).toContain("would downgrade");
    expect(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8")).toBe(before);
    expect(fs.existsSync(path.join(root, ".claude", "scripts"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude", "settings.json"))).toBe(false);
  });

  it("proceeds with an explicit --allow-downgrade, and restamps the plugin's version", () => {
    const root = project("99.0.0");
    const r = install(root, ["--allow-downgrade"]);
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({
      ok: true,
      runtimeVersion: pluginVersion(),
      runtimeVersionUpdated: true,
    });
    expect(readConfig(root)!.runtimeVersion).toBe(pluginVersion());
  });

  it("an older project is updated without any flag", () => {
    const root = project("0.0.1");
    const r = install(root);
    expect(r.code, r.stderr).toBe(0);
    expect(readConfig(root)!.runtimeVersion).toBe(pluginVersion());
  });
});

// ── 2. the third issue: missing_payload ─────────────────────────────────────────────────────────

describe("SubagentStop flags a route's missing payload (087 item 2)", () => {
  it("payload written during the run: no issue", async () => {
    const root = await installed();
    subagentStart(root, "backend", "b1");
    writePayload(root, "test", "backend");
    const r = subagentStop(root, "backend", "b1", { last_assistant_message: "done\nHANDOFF: success" });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toContain("handoff problem");
    expect(handoffEntry(root, "b1").handoff_issue).toBeUndefined();
  });

  it("payload missing: logged, recorded, surfaced, and the instruction is resume — not skip", async () => {
    const root = await installed();
    subagentStart(root, "backend", "b1");
    const r = subagentStop(root, "backend", "b1", { last_assistant_message: '"verdict": "SUCCESS"\nHANDOFF: success' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("handoff problem (missing_payload)");

    const entry = handoffEntry(root, "b1");
    expect(entry.handoff_issue).toMatchObject({
      kind: "missing_payload",
      label: "success",
      files: [".claude/channels/test/backend.1.md"],
    });
    expect(entry.handoff_issue.message).toContain("resume this agent");
    expect(entry.handoff_issue.message).toContain("do not skip it");
    expect(entry.log).toBe("HANDOFF: success [missing_payload]");

    expect(readState(root).handoff_issues[0]).toMatchObject({
      agent: "backend",
      agent_id: "b1",
      kind: "missing_payload",
    });
    const seen = projectScript(root, "maestro-task-status.cjs", ["handoff-issues"]);
    expect(seen.stdout).toContain("backend: NO PAYLOAD written for HANDOFF: success (agent_id b1)");
    expect(seen.stdout).toContain(".claude/channels/test/backend.1.md");
  });

  it("a condition route expecting a payload is checked too", async () => {
    const root = await installed();
    subagentStart(root, "test", "t1");
    const r = subagentStop(root, "test", "t1", { last_assistant_message: '"verdict": "FAIL"\nHANDOFF: tests failed' });
    expect(r.stdout).toContain("missing_payload");
    expect(handoffEntry(root, "t1").handoff_issue.files).toEqual([".claude/channels/backend/test.1.md"]);
  });

  it("a file left over from BEFORE this run does not count", async () => {
    const root = await installed();
    writePayload(root, "test", "backend");
    const old = new Date(Date.now() - 60 * 60 * 1000);
    fs.utimesSync(lane(root, "test", "backend"), old, old);
    subagentStart(root, "backend", "b2");
    const r = subagentStop(root, "backend", "b2", { last_assistant_message: "HANDOFF: success" });
    expect(r.stdout).toContain("missing_payload");
  });

  it("a route that needs no payload is never flagged", async () => {
    const root = await installed();
    subagentStart(root, "test", "t1");
    const r = subagentStop(root, "test", "t1", { last_assistant_message: '"verdict": "SUCCESS"\nHANDOFF: success' });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toContain("handoff problem");
    expect(handoffEntry(root, "t1").handoff_issue).toBeUndefined();
  });

  it("a team-meeting turn is never flagged", async () => {
    const root = await installed();
    startMeeting(root);
    subagentStart(root, "backend", "m1");
    const r = subagentStop(root, "backend", "m1", { last_assistant_message: "my notes\nHANDOFF: success" });
    expect(r.stdout).not.toContain("handoff problem");
    const entry = handoffEntry(root, "m1");
    expect(entry.meeting).toBe(true);
    expect(entry.handoff_issue).toBeUndefined();
  });

  it("the pure judgement agrees with the hook", () => {
    const routes = [{ label: "success", receiver: "test", channelFile: ".claude/channels/test/backend.1.md" }];
    expect(checkPayload("HANDOFF: success", routes, () => false)?.kind).toBe("missing_payload");
    expect(checkPayload("HANDOFF: success", routes, () => true)).toBeNull();
    expect(checkPayload("HANDOFF: SUCCESS", routes, () => false)?.kind).toBe("missing_payload");
    expect(checkPayload("HANDOFF: tests failed", routes, () => false)).toBeNull();
    expect(checkPayload("no line", routes, () => false)).toBeNull();
    expect(checkPayload("HANDOFF: success", [], () => false)).toBeNull();
  });
});

describe("the required-payload instruction reaches every kind of run (087 item 2)", () => {
  it("first run, cold re-run and resume all carry it; only first runs carry the shape", async () => {
    const root = await installed();

    const first = inject(root, "backend", "b1");
    expect(first).toContain("REQUIRED before your HANDOFF line");
    expect(first).toContain("A missing payload is not skipped");
    expect(first).toContain("Route `HANDOFF: success` → `test` — write this to `.claude/channels/test/backend.1.md`");
    expect(first).not.toContain("skip the write");

    // b1 completes; the loop-back then RESUMES b1 …
    subagentStart(root, "backend", "b1");
    writePayload(root, "test", "backend");
    subagentStop(root, "backend", "b1", { last_assistant_message: "HANDOFF: success" });
    const resumed = inject(root, "backend", "b1");
    expect(resumed).toContain("Resumed run —");
    expect(resumed).toContain("REQUIRED before your HANDOFF line");
    expect(resumed).toContain("`HANDOFF: success` → write `.claude/channels/test/backend.1.md` (for `test`)");
    expect(resumed).not.toContain("Handoff routing for the");

    // … or dispatches a COLD re-run under a new agent_id, which gets the full first-run text.
    const cold = inject(root, "backend", "b2");
    expect(cold).not.toContain("Resumed run —");
    expect(cold).toContain("REQUIRED before your HANDOFF line");
    expect(cold).toContain("write this to `.claude/channels/test/backend.1.md`");
  });

  it("a meeting participant gets no payload requirement", async () => {
    const root = await installed();
    startMeeting(root);
    const ctx = inject(root, "backend", "m1");
    expect(ctx).toContain("team meeting");
    expect(ctx).not.toContain("REQUIRED before your HANDOFF line");
  });

  it("an agent whose only route needs no payload gets no requirement for it", async () => {
    const root = await installed();
    const ctx = inject(root, "test", "t1");
    // test -> backend (tests failed) needs one; test -> scribe (success) does not.
    expect(ctx).toContain("`.claude/channels/backend/test.1.md`");
    // (the report's optional concept-gap note names scribe/test.1.md; no ROUTE requires it)
    expect(ctx).not.toContain("Route `HANDOFF: success` → `scribe`");
  });
});

// ── 3. the 084 false missing-HANDOFF flag ─────────────────────────────────────────────────────────

// Shaped like a real Claude Code 2.1.296 subagent transcript from task 084: the harness's meta
// reminder naming SubagentHandback (a STRING content line that mentions the tool), the agent's
// final `tool_use` of SubagentHandback carrying the whole report in `input.message`, and the
// harness's tool_result. The SubagentStop payload for such a run has NO last_assistant_message.
function handbackTranscript(report: string): string {
  const base = {
    isSidechain: true,
    userType: "external",
    cwd: "/project",
    sessionId: "fa3f41d8-161c-4481-841a-97a0210892fb",
    version: "2.1.296",
    agentId: "a0e1",
  };
  const lines = [
    {
      ...base,
      type: "user",
      isMeta: true,
      uuid: "u1",
      timestamp: "2026-10-01T10:00:00.000Z",
      message: {
        role: "user",
        content:
          "<system-reminder>Your final report is delivered through SubagentHandback: when your work is complete, call SubagentHandback({message: <your full report>}). Only that call reaches the caller.</system-reminder>",
      },
    },
    {
      ...base,
      type: "assistant",
      uuid: "u2",
      timestamp: "2026-10-01T10:05:00.000Z",
      message: {
        model: "claude-opus-5-5",
        id: "msg_01",
        type: "message",
        role: "assistant",
        content: [{ type: "text", text: "All done; handing back." }],
      },
    },
    {
      ...base,
      type: "assistant",
      uuid: "u3",
      timestamp: "2026-10-01T10:05:01.000Z",
      message: {
        model: "claude-opus-5-5",
        id: "msg_02",
        type: "message",
        role: "assistant",
        stop_reason: "tool_use",
        content: [{ type: "tool_use", id: "toolu_01", name: "SubagentHandback", input: { message: report } }],
      },
    },
    {
      ...base,
      type: "user",
      uuid: "u4",
      timestamp: "2026-10-01T10:05:02.000Z",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "Delivered." }] },
    },
  ];
  return lines.map((l) => JSON.stringify(l)).join("\n") + "\n";
}

describe("SubagentHandback hand-backs are read, not flagged missing (087 item 3)", () => {
  const REPORT =
    'Implemented the thing.\n```json\n{ "subagent": "backend", "verdict": "SUCCESS" }\n```\nHANDOFF: success';

  it("a valid HANDOFF line delivered through SubagentHandback is recovered and not flagged", async () => {
    const root = await installed();
    const transcript = path.join(tmp, "agent-a0e1.jsonl");
    fs.writeFileSync(transcript, handbackTranscript(REPORT));
    subagentStart(root, "backend", "b1");
    writePayload(root, "test", "backend");

    const r = subagentStop(root, "backend", "b1", { agent_transcript_path: transcript });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toContain("handoff problem");
    const entry = handoffEntry(root, "b1");
    expect(entry).toMatchObject({ status: "success", label: "success" });
    expect(entry.output).toContain("HANDOFF: success");
    expect(entry.handoff_issue).toBeUndefined();
  });

  it("a hand-back with NO HANDOFF line is still flagged missing", async () => {
    const root = await installed();
    const transcript = path.join(tmp, "agent-none.jsonl");
    fs.writeFileSync(transcript, handbackTranscript('Implemented it.\n{ "verdict": "SUCCESS" }'));
    subagentStart(root, "backend", "b1");

    const r = subagentStop(root, "backend", "b1", { agent_transcript_path: transcript });
    expect(r.stdout).toContain("handoff problem (missing)");
    expect(handoffEntry(root, "b1").handoff_issue).toMatchObject({ kind: "missing", label: null });
  });

  it("the pure recovery reads SubagentHandback and still reads SendMessage (078)", () => {
    expect(handbackHandoff(handbackTranscript(REPORT))).toContain("HANDOFF: success");
    const viaSend = JSON.stringify({
      type: "assistant",
      message: {
        content: [
          { type: "tool_use", name: "SendMessage", input: { to: "main", message: "x\nHANDOFF: tests failed" } },
        ],
      },
    });
    expect(handbackHandoff(viaSend)).toContain("HANDOFF: tests failed");
    expect(handbackHandoff(handbackTranscript("no line here"))).toBeNull();
  });
});

// ── 1b. the app's installStatus().appBehind, and every surface agreeing ──────────────────────────

// The app-side verdict (installStatus().appBehind, which the /maestro route and the InstallProvider
// toast render) against the terminal check (maestro-check-runtime.cjs's pluginBehind), for the SAME
// stamp/plugin pair. A copy of the real plugin with its plugin.json version rewritten stands in for
// "the plugin this app ships"; installed_plugins.json in the pinned HOME names the same version for
// the terminal side. Nothing else about the plugin is altered.
describe("installStatus().appBehind agrees with the terminal readiness check (087 item 1)", () => {
  const dbs = () =>
    [
      path.join(tmp, "report-defaults.sqlite"),
      path.join(tmp, "project-tags.sqlite"),
      path.join(tmp, "handoff-defaults.sqlite"),
    ] as const;

  function pluginAt(version: string): string {
    const dir = path.join(tmp, `plugin-${version.replace(/[^0-9A-Za-z.-]/g, "_")}`);
    if (fs.existsSync(dir)) return dir;
    fs.cpSync(PLUGIN_ROOT, dir, { recursive: true });
    const manifest = path.join(dir, ".claude-plugin", "plugin.json");
    const parsed = JSON.parse(fs.readFileSync(manifest, "utf8"));
    fs.writeFileSync(manifest, JSON.stringify({ ...parsed, version }, null, 2) + "\n");
    return dir;
  }

  function terminalPluginIs(version: string, installPath: string) {
    const dir = path.join(home, ".claude", "plugins");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "installed_plugins.json"),
      JSON.stringify({
        version: 1,
        plugins: {
          "maestro@maestro": [{ scope: "user", version, installedAt: "2026-01-01T00:00:00.000Z", installPath }],
        },
      })
    );
  }

  // Installed from `plugin`, rendered (so the readiness check reaches its version step), then stamped.
  async function project(name: string, plugin: string, stamp: unknown): Promise<string> {
    const root = path.join(tmp, name);
    fs.mkdirSync(root, { recursive: true });
    execFileSync("git", ["init", "-q"], { cwd: root });
    writeConfig(root, cfg);
    await installRuntime(root, plugin, ...dbs());
    execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root], {
      env: env(root, null),
    });
    const next = { ...readConfig(root)! } as MaestroConfigV3 & { runtimeVersion?: unknown };
    if (stamp === undefined) delete next.runtimeVersion;
    else next.runtimeVersion = stamp;
    writeConfig(root, next as MaestroConfigV3);
    return root;
  }

  const terminal = (root: string) =>
    JSON.parse(projectScript(root, "maestro-check-runtime.cjs", [], undefined, null).stdout);

  // [project stamp, shipped/installed plugin version, expected verdict]
  const CASES: [string | undefined, string, "older" | "equal" | "newer" | "unknown"][] = [
    ["0.10.6", "0.10.5", "newer"],
    ["0.10.5", "0.10.6", "older"],
    ["0.10.6", "0.10.6", "equal"],
    ["0.10.0", "0.9.9", "newer"],
    ["0.9.9", "0.10.0", "older"],
    ["1.0.0", "1.0.0-rc.1", "newer"],
    ["1.0.0-rc.1", "1.0.0", "older"],
    [undefined, "0.10.5", "unknown"],
    ["not-a-version", "0.10.5", "unknown"],
  ];

  for (const [stamp, shipped, verdict] of CASES) {
    it(`project ${stamp ?? "(unstamped)"} vs plugin ${shipped}: every surface says ${verdict}`, async () => {
      const plugin = pluginAt(shipped);
      const root = await project("agree", plugin, stamp);
      terminalPluginIs(shipped, plugin);

      expect(compareRuntimeVersions(stamp, shipped)).toBe(verdict);

      // App side.
      const status = await installStatus(root, plugin);
      expect(status.installed).toBe(true);
      if (verdict === "newer") {
        expect(status.appBehind).toEqual({ projectVersion: stamp, shippedVersion: shipped });
        expect(status.stale).toBe(false);
      } else {
        expect(status.appBehind).toBeNull();
      }

      // Terminal side, same pair.
      const t = terminal(root);
      expect(Boolean(t.pluginBehind)).toBe(verdict === "newer");
      expect(t.action).toBe(verdict === "older" || verdict === "unknown" ? "update" : "continue");
      expect(t.stale).toBe(verdict === "older" || verdict === "unknown");

      // The agreement, stated once: the app flags itself behind iff the terminal flags the plugin behind.
      expect(status.appBehind !== null).toBe(Boolean(t.pluginBehind));

      // The app's auto-refresh runs exactly when the terminal says "update". Last, because it writes.
      const refreshed = await refreshStaleRuntime(root, plugin, ...dbs());
      expect(refreshed !== null).toBe(t.action === "update");
      expect(readConfig(root)!.runtimeVersion).toBe(refreshed !== null ? shipped : stamp);
    });
  }

  it("appBehind forces stale false even when the scripts differ by content (update would downgrade)", async () => {
    const plugin = pluginAt("0.10.5");
    const root = await project("behind", plugin, "0.10.6");
    fs.writeFileSync(path.join(root, ".claude", "scripts", "maestro-session-log.cjs"), "// newer release\n");
    const status = await installStatus(root, plugin);
    expect(status.scriptsOutOfDate).toContain(".claude/scripts/maestro-session-log.cjs");
    expect(status.appBehind).toEqual({ projectVersion: "0.10.6", shippedVersion: "0.10.5" });
    expect(status.stale).toBe(false);
  });

  it("without appBehind, stale is exactly as before: differing content is stale at an equal, older or missing stamp", async () => {
    const plugin = pluginAt("0.10.5");
    for (const stamp of ["0.10.5", "0.10.4", undefined]) {
      fs.rmSync(path.join(tmp, "stale"), { recursive: true, force: true });
      const root = await project("stale", plugin, stamp);
      expect(await installStatus(root, plugin)).toMatchObject({ appBehind: null, stale: false });
      fs.writeFileSync(path.join(root, ".claude", "scripts", "maestro-session-log.cjs"), "// edited\n");
      expect(await installStatus(root, plugin)).toMatchObject({ appBehind: null, stale: true });
    }
  });

  it("a non-string stamp gives no appBehind", async () => {
    const plugin = pluginAt("0.10.5");
    const root = await project("num", plugin, 99);
    expect((await installStatus(root, plugin)).appBehind).toBeNull();
  });

  it("a project that is not installed gives no appBehind, however new its stamp", async () => {
    const plugin = pluginAt("0.10.5");
    // No skill and no scripts: only a stamped maestro.json.
    const bare = path.join(tmp, "bare");
    fs.mkdirSync(bare, { recursive: true });
    writeConfig(bare, { ...cfg, runtimeVersion: "99.0.0" } as MaestroConfigV3);
    expect(await installStatus(bare, plugin)).toMatchObject({ installed: false, appBehind: null, stale: false });

    // Skill present but the scripts dir removed.
    const root = await project("noscripts", plugin, "99.0.0");
    fs.rmSync(path.join(root, ".claude", "scripts"), { recursive: true, force: true });
    expect(await installStatus(root, plugin)).toMatchObject({ installed: false, appBehind: null });
  });

  it("the real shipped plugin: a project one patch ahead is appBehind and refreshStaleRuntime leaves it alone", async () => {
    const shipped = shippedRuntimeVersion(PLUGIN_ROOT);
    const [maj, min, pat] = shipped.split(/[.-]/).map(Number);
    const ahead = `${maj}.${min}.${pat + 1}`;
    const root = await project("real", PLUGIN_ROOT, ahead);
    expect((await installStatus(root, PLUGIN_ROOT)).appBehind).toEqual({
      projectVersion: ahead,
      shippedVersion: shipped,
    });
    expect(await refreshStaleRuntime(root, PLUGIN_ROOT, ...dbs())).toBeNull();
    expect(readConfig(root)!.runtimeVersion).toBe(ahead);
  });
});
