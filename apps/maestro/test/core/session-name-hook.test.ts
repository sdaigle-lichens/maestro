// `113` through the REAL installed scripts: maestro-session-name.cjs fed the JSON payloads Claude
// Code sends on its five registrations, then the epic and claim CLIs (maestro-epic.cjs,
// maestro-task-status.cjs) preferring the name that hook stored over a passed-in one. Spawned against
// temp projects; HOME pinned and CLAUDE_CODE_SESSION_ID always set or deleted, never inherited.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";
import { pinnedEnv } from "../helpers/env.js";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const PLUGIN_HOOK = path.join(PLUGIN_ROOT, "scripts", "maestro-session-name.js");

const W = "1a2b3c4d-0000-1111-2222-333344445555"; // a worker session
const M = "9f8e7d6c-aaaa-bbbb-cccc-ddddeeeeffff"; // a manager session
const W_NAME = "maestro-1a2b3c4d";
const M_NAME = "maestro-mgr-9f8e7d6c";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-113-hook-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function installed(name = "p"): Promise<string> {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeConfig(root, defaultish);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  return root;
}

function env(root: string, sessionId: string | null): NodeJS.ProcessEnv {
  return sessionId === null
    ? pinnedEnv(tmp, { CLAUDE_PROJECT_DIR: root })
    : pinnedEnv(tmp, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: sessionId });
}

/** Feed one payload to a hook script. `envSession` is what CLAUDE_CODE_SESSION_ID is pinned to (null deletes it). */
function hook(root: string, payload: unknown, opts: { script?: string; envSession?: string | null } = {}) {
  const script = opts.script ?? path.join(root, ".claude", "scripts", "maestro-session-name.cjs");
  const input = typeof payload === "string" ? payload : JSON.stringify(payload);
  const res = spawnSync("node", [script], { encoding: "utf8", env: env(root, opts.envSession ?? null), input });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function cli(root: string, script: string, args: string[], session: string | null, input = "") {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", script), ...args], {
    encoding: "utf8",
    env: env(root, session),
    input,
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}
const epic = (root: string, args: string[], session: string | null, input = "") =>
  cli(root, "maestro-epic.cjs", args, session, input);
const status = (root: string, args: string[], session: string | null) =>
  cli(root, "maestro-task-status.cjs", args, session);

const sessionJson = (root: string, id: string) => path.join(root, ".claude", "maestro_sessions", id, "session.json");
const stateOf = (root: string, id: string) => JSON.parse(fs.readFileSync(sessionJson(root, id), "utf8"));
const epicState = (root: string, slug: string) =>
  JSON.parse(fs.readFileSync(path.join(root, ".claude", "epics", slug, "state.json"), "utf8"));
const claimOf = (root: string, f: string) =>
  JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro-tasks", "claims", `${f}.json`), "utf8"));
const titleOut = (stdout: string) => (stdout ? JSON.parse(stdout).hookSpecificOutput : null);

const expansion = (id: string, command_name: string, cwd: string) => ({
  hook_event_name: "UserPromptExpansion",
  session_id: id,
  cwd,
  command_name,
  expansion_type: "slash_command",
  prompt: `/${command_name}`,
});
const skillCall = (id: string, skill: string, cwd: string) => ({
  hook_event_name: "PreToolUse",
  session_id: id,
  cwd,
  tool_name: "Skill",
  tool_input: { skill },
});
const submit = (id: string, prompt: string, cwd: string, extra: Record<string, unknown> = {}) => ({
  hook_event_name: "UserPromptSubmit",
  session_id: id,
  cwd,
  prompt,
  ...extra,
});
const sessionStart = (id: string, cwd: string, extra: Record<string, unknown> = {}) => ({
  hook_event_name: "SessionStart",
  session_id: id,
  cwd,
  source: "resume",
  ...extra,
});

/** Name a session the way a real one is named: the entrance, then its first UserPromptSubmit. */
function enter(root: string, id: string, command: "maestro" | "maestro-manager") {
  expect(hook(root, expansion(id, command, root)).code).toBe(0);
}

function writeTask(root: string, filename: string) {
  const dir = path.join(root, ".claude", "maestro-tasks");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, filename), `# ${filename}\n\n## Blocked by\n\nNone\n`);
}
function liveSession(root: string, id: string) {
  const dir = path.join(root, ".claude", "maestro_sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "log.jsonl"), '{"kind":"tool_call"}\n');
}

describe("maestro-session-name hook: the five registrations", () => {
  it("UserPromptExpansion for /maestro records maestro-<id8> and prints nothing", async () => {
    const root = await installed();
    const r = hook(root, expansion(W, "maestro", root));
    expect(r).toMatchObject({ code: 0, stdout: "" });
    expect(stateOf(root, W)).toMatchObject({
      session_name: W_NAME,
      session_name_role: "worker",
      session_name_applied: false,
    });
  });

  it("UserPromptExpansion for /maestro-manager (bare or plugin-namespaced) records maestro-mgr-<id8>", async () => {
    const root = await installed();
    expect(hook(root, expansion(M, "maestro:maestro-manager", root)).stdout).toBe("");
    expect(stateOf(root, M).session_name).toBe(M_NAME);
  });

  it("PreToolUse Skill (the model invoking the skill) records the name; other skills and tools touch nothing", async () => {
    const root = await installed();
    for (const p of [
      skillCall(W, "maestro-tasks", root),
      skillCall(W, "maestro:maestro-post-mortem", root),
      {
        hook_event_name: "PreToolUse",
        session_id: W,
        cwd: root,
        tool_name: "Bash",
        tool_input: { command: "maestro" },
      },
      expansion(W, "maestro-help", root),
    ]) {
      expect(hook(root, p)).toMatchObject({ code: 0, stdout: "" });
    }
    expect(fs.existsSync(path.join(root, ".claude", "maestro_sessions", W))).toBe(false);

    expect(hook(root, skillCall(M, "maestro:maestro-manager", root))).toMatchObject({ code: 0, stdout: "" });
    expect(stateOf(root, M).session_name).toBe(M_NAME);
  });

  it("the first entrance wins across hooks: /maestro then a model-invoked maestro-manager keeps the worker name", async () => {
    const root = await installed();
    enter(root, W, "maestro");
    hook(root, skillCall(W, "maestro-manager", root));
    expect(stateOf(root, W)).toMatchObject({ session_name: W_NAME, session_name_role: "worker" });
  });

  it("UserPromptSubmit of a typed `/maestro ...` (which fires BEFORE its expansion) names the session on the first prompt, once", async () => {
    const root = await installed();
    const prompt = "/maestro Complete the task described in file .claude/maestro-tasks/001-a.md";
    const first = hook(root, submit(W, prompt, root));
    expect(first.code).toBe(0);
    expect(titleOut(first.stdout)).toEqual({ hookEventName: "UserPromptSubmit", sessionTitle: W_NAME });

    // Then the same prompt's expansion, and later prompts: nothing more is emitted.
    expect(hook(root, expansion(W, "maestro", root)).stdout).toBe("");
    expect(hook(root, submit(W, "carry on", root)).stdout).toBe("");
    expect(hook(root, submit(W, prompt, root)).stdout).toBe("");
    expect(stateOf(root, W)).toMatchObject({ session_name: W_NAME, session_name_applied: true });
  });

  it("UserPromptSubmit applies a name recorded by a model-invoked entrance on the next prompt", async () => {
    const root = await installed();
    hook(root, skillCall(M, "maestro-manager", root));
    expect(titleOut(hook(root, submit(M, "next", root)).stdout)?.sessionTitle).toBe(M_NAME);
    expect(hook(root, submit(M, "again", root)).stdout).toBe("");
  });

  it("UserPromptSubmit for a session that never entered Maestro emits nothing and writes nothing", async () => {
    const root = await installed();
    expect(hook(root, submit(W, "hello", root))).toMatchObject({ code: 0, stdout: "" });
    expect(hook(root, submit(W, "please run /maestro later", root)).stdout).toBe("");
    expect(fs.existsSync(path.join(root, ".claude", "maestro_sessions", W))).toBe(false);
  });

  it("SessionStart re-applies the stored name on every startup / resume / fork", async () => {
    const root = await installed();
    enter(root, W, "maestro");
    hook(root, submit(W, "x", root)); // applied once already
    for (const source of ["startup", "resume", "fork", "resume"]) {
      const r = hook(root, sessionStart(W, root, { source }));
      expect(titleOut(r.stdout), source).toEqual({ hookEventName: "SessionStart", sessionTitle: W_NAME });
    }
  });

  it("a custom title the user set is kept and recorded instead, and never emitted over", async () => {
    const root = await installed();
    enter(root, W, "maestro");
    expect(hook(root, submit(W, "x", root, { session_title: "billing-worker" })).stdout).toBe("");
    expect(stateOf(root, W)).toMatchObject({ session_name: "billing-worker", session_name_custom: true });
    expect(hook(root, sessionStart(W, root, { session_title: "billing-worker" })).stdout).toBe("");
    expect(stateOf(root, W).session_name).toBe("billing-worker");
  });

  it("SessionStart after the session directory was swept re-derives the name from the claim", async () => {
    const root = await installed();
    writeTask(root, "001-a.md");
    expect(status(root, ["sync"], W).code).toBe(0);
    enter(root, W, "maestro");
    liveSession(root, W);
    expect(status(root, ["claim", "001-a.md"], W).code).toBe(0);
    expect(claimOf(root, "001-a.md").session_name).toBe(W_NAME);

    fs.rmSync(path.join(root, ".claude", "maestro_sessions", W), { recursive: true, force: true });
    const r = hook(root, sessionStart(W, root));
    expect(titleOut(r.stdout)?.sessionTitle).toBe(W_NAME);
    expect(stateOf(root, W).session_name).toBe(W_NAME);
  });

  it("SessionStart after a sweep re-derives a manager's name from its epic", async () => {
    const root = await installed();
    enter(root, M, "maestro-manager");
    expect(epic(root, ["create", "billing"], M).code).toBe(0);
    expect(epicState(root, "billing").manager.name).toBe(M_NAME);

    fs.rmSync(path.join(root, ".claude", "maestro_sessions", M), { recursive: true, force: true });
    expect(titleOut(hook(root, sessionStart(M, root)).stdout)?.sessionTitle).toBe(M_NAME);
  });

  it("takes the session id from CLAUDE_CODE_SESSION_ID when the payload has none, and cwd from CLAUDE_PROJECT_DIR", async () => {
    const root = await installed();
    const r = hook(root, { hook_event_name: "UserPromptExpansion", command_name: "maestro" }, { envSession: W });
    expect(r.code).toBe(0);
    expect(stateOf(root, W).session_name).toBe(W_NAME);
  });
});

describe("maestro-session-name hook: silent exit 0", () => {
  it("no session id (none in the payload, CLAUDE_CODE_SESSION_ID deleted)", async () => {
    const root = await installed();
    for (const p of [
      { hook_event_name: "UserPromptExpansion", cwd: root, command_name: "maestro" },
      { hook_event_name: "SessionStart", cwd: root, source: "startup" },
    ]) {
      expect(hook(root, p, { envSession: null })).toMatchObject({ code: 0, stdout: "", stderr: "" });
    }
    const sessions = path.join(root, ".claude", "maestro_sessions");
    const ids = fs.existsSync(sessions) ? fs.readdirSync(sessions).filter((f) => !f.startsWith(".")) : [];
    expect(ids).toEqual([]);
  });

  it("an invalid session id in the payload does not fall through to the environment's", async () => {
    const root = await installed();
    const r = hook(root, { ...expansion(W, "maestro", root), session_id: "../../escape" }, { envSession: W });
    expect(r).toMatchObject({ code: 0, stdout: "" });
    expect(fs.existsSync(path.join(root, ".claude", "maestro_sessions", W))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude", "escape"))).toBe(false);
  });

  it("a project with no .claude/maestro.json grows no maestro_sessions directory", async () => {
    const root = path.join(tmp, "plain");
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    for (const p of [expansion(W, "maestro", root), submit(W, "/maestro go", root), sessionStart(W, root)]) {
      expect(hook(root, p, { script: PLUGIN_HOOK })).toMatchObject({ code: 0, stdout: "", stderr: "" });
    }
    expect(fs.existsSync(path.join(root, ".claude", "maestro_sessions"))).toBe(false);
  });

  it("garbage, empty, non-object and unknown-event stdin", async () => {
    const root = await installed();
    for (const input of [
      "{not json",
      "",
      "null",
      "42",
      '"str"',
      "[]",
      JSON.stringify({ hook_event_name: "Stop", session_id: W, cwd: root }),
    ]) {
      expect(hook(root, input), input).toMatchObject({ code: 0, stdout: "" });
    }
    expect(fs.existsSync(path.join(root, ".claude", "maestro_sessions", W))).toBe(false);
  });
});

describe("maestro-session-name: the plugin's copy", () => {
  it("names the session in a project that does not register its own copy", async () => {
    const root = path.join(tmp, "plugin-only");
    fs.mkdirSync(root, { recursive: true });
    writeConfig(root, defaultish);
    const r = hook(root, submit(M, "/maestro-manager run billing", root), { script: PLUGIN_HOOK });
    expect(r.code).toBe(0);
    expect(titleOut(r.stdout)).toEqual({ hookEventName: "UserPromptSubmit", sessionTitle: M_NAME });
  });

  it("stands down when the project registers its own copy, so one prompt is never handled twice", async () => {
    const root = await installed();
    for (const p of [expansion(W, "maestro", root), submit(W, "/maestro go", root), sessionStart(W, root)]) {
      expect(hook(root, p, { script: PLUGIN_HOOK })).toMatchObject({ code: 0, stdout: "" });
    }
    expect(fs.existsSync(path.join(root, ".claude", "maestro_sessions", W))).toBe(false);
  });
});

describe("the epic and claim CLIs record the stored name in preference to a passed one", () => {
  async function epicWithTask(): Promise<string> {
    const root = await installed();
    writeTask(root, "001-a.md");
    writeTask(root, "002-b.md");
    expect(status(root, ["sync"], W).code).toBe(0);
    enter(root, M, "maestro-manager");
    enter(root, W, "maestro");
    liveSession(root, W);
    return root;
  }

  it("claim: the stored name wins over --name, and fills it in when --name is omitted", async () => {
    const root = await epicWithTask();
    expect(status(root, ["claim", "001-a.md", "--name", "stale-from-listing"], W).code).toBe(0);
    expect(claimOf(root, "001-a.md")).toMatchObject({ session_id: W, session_name: W_NAME });

    // A session with nothing stored still records its --name (the fallback).
    const plain = "77777777-0000-0000-0000-000000000000";
    liveSession(root, plain);
    expect(status(root, ["claim", "002-b.md", "--name", "typed"], plain).code).toBe(0);
    expect(claimOf(root, "002-b.md").session_name).toBe("typed");
  });

  it("claim with no --name records the stored name", async () => {
    const root = await epicWithTask();
    expect(status(root, ["claim", "001-a.md"], W).code).toBe(0);
    expect(claimOf(root, "001-a.md").session_name).toBe(W_NAME);
  });

  it("create --manager: the creating session's stored name wins and is printed", async () => {
    const root = await epicWithTask();
    const r = epic(root, ["create", "billing", "--manager", "typed-boss"], M);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`manager: "${M_NAME}"`);
    expect(epicState(root, "billing").manager.name).toBe(M_NAME);
  });

  it("create with no --manager and no stored name records no manager", async () => {
    const root = await installed();
    expect(epic(root, ["create", "billing"], null).code).toBe(0);
    expect(epicState(root, "billing").manager ?? null).toBeNull();
  });

  it("set-manager: the stored name wins, the name may be omitted, and without either it is refused", async () => {
    const root = await epicWithTask();
    expect(epic(root, ["create", "billing"], null).code).toBe(0);

    expect(epic(root, ["set-manager", "billing", "typed-boss"], M).stdout).toContain(`"${M_NAME}"`);
    expect(epicState(root, "billing").manager.name).toBe(M_NAME);

    expect(epic(root, ["set-manager", "billing"], null).code).toBe(1);
    expect(epicState(root, "billing").manager.name).toBe(M_NAME);
    expect(epic(root, ["set-manager", "billing", "fallback"], null).code).toBe(0);
    expect(epicState(root, "billing").manager.name).toBe("fallback");
    expect(epic(root, ["set-manager", "billing"], M).code).toBe(0);
    expect(epicState(root, "billing").manager.name).toBe(M_NAME);
  });

  it("add-worker run by the manager prefers the name on the worker's --task claim over the typed one", async () => {
    const root = await epicWithTask();
    epic(root, ["create", "billing"], M);
    epic(root, ["link", "billing", "001-a.md"], M);
    status(root, ["claim", "001-a.md"], W);

    const r = epic(root, ["add-worker", "billing", "worker-from-listing", "--task", "001-a.md"], M);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(`recorded worker "${W_NAME}"`);
    expect(r.stdout).toContain(`not "worker-from-listing"`);
    expect(epicState(root, "billing").workers.map((w: { name: string }) => w.name)).toEqual([W_NAME]);
    // The manager's own stored name was NOT recorded as a worker.
    expect(JSON.stringify(epicState(root, "billing").workers)).not.toContain(M_NAME);
  });

  it("add-worker run by the manager with no --task records the typed name", async () => {
    const root = await epicWithTask();
    epic(root, ["create", "billing"], M);
    const r = epic(root, ["add-worker", "billing", "typed-worker"], M);
    expect(r.code).toBe(0);
    expect(r.stdout).not.toContain("recorded name, not");
    expect(epicState(root, "billing").workers.map((w: { name: string }) => w.name)).toEqual(["typed-worker"]);
  });

  it("add-worker run by the worker itself records its own stored name", async () => {
    const root = await epicWithTask();
    epic(root, ["create", "billing"], M);
    expect(epic(root, ["add-worker", "billing", "whatever"], W).code).toBe(0);
    expect(epicState(root, "billing").workers.map((w: { name: string }) => w.name)).toEqual([W_NAME]);
  });

  it("add-worker run by a manager whose stored name has the worker role (it ran /maestro first) does not record itself", async () => {
    const root = await epicWithTask();
    // Session W entered as a worker, then became this epic's manager.
    epic(root, ["create", "billing"], W);
    expect(epicState(root, "billing").manager.name).toBe(W_NAME);
    expect(epic(root, ["add-worker", "billing", "typed-worker"], W).code).toBe(0);
    expect(epicState(root, "billing").workers.map((w: { name: string }) => w.name)).toEqual(["typed-worker"]);
  });

  it("add-worker with no name anywhere is refused", async () => {
    const root = await epicWithTask();
    epic(root, ["create", "billing"], M);
    expect(epic(root, ["add-worker", "billing"], M).code).toBe(1);
  });

  it("report --from, note --from and ack --by: the caller's stored name wins", async () => {
    const root = await epicWithTask();
    epic(root, ["create", "billing"], M);
    epic(root, ["create", "search"], null);
    epic(root, ["link", "billing", "001-a.md"], M);

    expect(
      epic(root, ["report", "--task", "001-a.md", "--from", "stale-worker", "--file", "-"], W, "done\n").code
    ).toBe(0);
    const report = epicState(root, "billing").log.find((e: { kind: string }) => e.kind === "report");
    expect(report.from).toBe(W_NAME);
    expect(fs.readFileSync(path.join(root, ".claude", "epics", "billing", report.file), "utf8")).toContain(
      `From session: ${W_NAME}`
    );

    expect(
      epic(root, ["note", "search", "--from-epic", "billing", "--from", "stale-boss", "--file", "-"], M, "hi\n").code
    ).toBe(0);
    expect(epicState(root, "search").log.find((e: { kind: string }) => e.kind === "note").from).toBe(M_NAME);

    expect(epic(root, ["ack", "billing", report.id, "--by", "stale-boss"], M).code).toBe(0);
    expect(epicState(root, "billing").log.find((e: { kind: string }) => e.kind === "ack").by).toBe(M_NAME);
  });

  it("report with no --from and no stored name still falls back to the claim's name (100)", async () => {
    const root = await epicWithTask();
    epic(root, ["create", "billing"], M);
    epic(root, ["link", "billing", "001-a.md"], M);
    status(root, ["claim", "001-a.md"], W);
    expect(epic(root, ["report", "--task", "001-a.md", "--file", "-"], null, "x\n").code).toBe(0);
    expect(epicState(root, "billing").log[0].from).toBe(W_NAME);
  });
});
