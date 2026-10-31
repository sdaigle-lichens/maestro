// `147`: the gaps left in `144`'s per-task channel scoping, through the REAL installed hooks.
//   1. a worktree session's write guard confines EVERY caller (any agent, the main session) to its
//      own channel scope; `checkWorktreeWrite` unit cases cover `..`, a missing scope, no worktree.
//   2. `maestro-task-status.cjs claim` records `active_task`, so a session that claims AFTER it
//      started moves from `session-<id8>` to `task-<NNN>`.
//   3. switching task mid-session retires the scope it leaves (`retireScope`), never another live
//      session's, keeps skill-gap reports, and is a no-op for the same scope.
// Real git repo under os.tmpdir(), HOME and CLAUDE_CODE_SESSION_ID pinned on every spawn via pinnedEnv.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { checkWorktreeWrite } from "../../src/core/worktree-write-guard.js";
import { channelScopeOf, retireScope, recordActiveTask } from "../../src/core/handoff-channels.js";
import { defaultish } from "./fixtures/configs.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

vi.setConfig({ testTimeout: 60_000 });

// Distinct 8-char prefixes so no two sessions share a `session-<id8>` scope.
const A = "aaaa1111-sess"; // main checkout
const B = "bbbb2222-sess"; // worktree, task 002
const S = "ssss3333-sess"; // the session that starts unclaimed
const O = "oooo4444-sess"; // another live session

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-147-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function script(root: string, sess: string, name: string, args: string[], input?: unknown) {
  const r = spawnSync("node", [path.join(root, ".claude", "scripts", name), ...args], {
    encoding: "utf8",
    env: pinnedEnv(tmp, {
      CLAUDE_PROJECT_DIR: root,
      CLAUDE_CODE_SESSION_ID: sess,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    }),
    ...(input !== undefined ? { input: JSON.stringify(input) } : {}),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function ok(r: { code: number; stderr: string; stdout: string }) {
  expect(r.code, r.stderr + r.stdout).toBe(0);
  return r;
}

const sessDir = (root: string, id: string) => path.join(root, ".claude", "maestro_sessions", id);
const stateOf = (root: string, id: string) => path.join(sessDir(root, id), "session.json");
const readState = (root: string, id: string) => JSON.parse(fs.readFileSync(stateOf(root, id), "utf8"));
const ch = (root: string, ...parts: string[]) => path.join(root, ".claude", "channels", ...parts);

function liveSession(root: string, id: string) {
  fs.mkdirSync(sessDir(root, id), { recursive: true });
  fs.writeFileSync(path.join(sessDir(root, id), "log.jsonl"), '{"kind":"tool_call"}\n');
}
function put(file: string, body = "{}\n") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}
const gapBody =
  "Skill gap report.\n\n```json\n" +
  JSON.stringify({ skill_gaps: [{ skill: "code-graph", missing: "X" }] }, null, 2) +
  "\n```\n";

async function repo(): Promise<string> {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeConfig(root, defaultish);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "r.sqlite"),
    path.join(tmp, "p.sqlite"),
    path.join(tmp, "h.sqlite")
  );
  fs.writeFileSync(path.join(root, "app.txt"), "main\n");
  fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
  for (const f of ["001-a.md", "002-b.md", "003-c.md"])
    fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", f), `# ${f}\n\n## Blocked by\n\nNone\n`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

/** A in the main checkout on 001; B in a git worktree on 002. */
async function worktreeSessions(): Promise<{ root: string; wt: string }> {
  const root = await repo();
  liveSession(root, A);
  liveSession(root, B);
  ok(script(root, A, "maestro-task-status.cjs", ["claim", "001-a.md"]));
  ok(script(root, B, "maestro-task-status.cjs", ["claim", "002-b.md"]));
  ok(script(root, B, "maestro-task-status.cjs", ["worktree", "002-b.md"]));
  const wt = path.join(path.dirname(root), `${path.basename(root)}-task-002`);
  expect(fs.existsSync(wt)).toBe(true);
  return { root, wt };
}

/** A PreToolUse write through the installed hook; true when denied. */
function denied(root: string, sess: string, agent: string | null, filePath: string, tool = "Write"): boolean {
  const r = ok(
    script(root, sess, "maestro-channel-write-guard.cjs", [], {
      cwd: root,
      session_id: sess,
      hook_event_name: "PreToolUse",
      tool_name: tool,
      tool_input: { file_path: filePath, content: "x" },
      ...(agent ? { agent_type: agent, agent_id: `${agent}-1` } : {}),
    })
  );
  if (!r.stdout.trim()) return false;
  return JSON.parse(r.stdout).hookSpecificOutput.permissionDecision === "deny";
}

describe("worktree write guard confines every agent to its own channel scope (147)", () => {
  it.each(["backend", "frontend", "test", "scribe", "infra", "mobile", "refactor", "reviewer"])(
    "a worktree %s may write its own scope and is refused another task's scope and the legacy root",
    async (agent) => {
      const { root } = await worktreeSessions();
      expect(denied(root, B, agent, ch(root, "task-002", "test", `${agent}.1.md`))).toBe(false);
      expect(denied(root, B, agent, ch(root, "task-001", "test", `${agent}.1.md`))).toBe(true);
      expect(denied(root, B, agent, ch(root, "session-bbbb2222", "test", `${agent}.1.md`))).toBe(true);
      expect(denied(root, B, agent, ch(root, "test", `${agent}.1.md`))).toBe(true); // legacy unscoped root
    }
  );

  it("the main session (no agent_type) in a worktree is confined the same way", async () => {
    const { root } = await worktreeSessions();
    expect(denied(root, B, null, ch(root, "task-002", "test", "backend.1.md"))).toBe(false);
    expect(denied(root, B, null, ch(root, "task-001", "test", "backend.1.md"))).toBe(true);
    expect(denied(root, B, null, ch(root, "test", "backend.1.md"))).toBe(true);
  });

  it("covers Edit and MultiEdit-style tools, not just Write", async () => {
    const { root } = await worktreeSessions();
    expect(denied(root, B, "backend", ch(root, "task-001", "test", "x.md"), "Edit")).toBe(true);
    expect(denied(root, B, "backend", ch(root, "task-002", "test", "x.md"), "Edit")).toBe(false);
  });

  it("a `..` segment cannot smuggle a write out of the own scope", async () => {
    const { root } = await worktreeSessions();
    const sneaky = path.join(root, ".claude", "channels", "task-002", "..", "task-001", "test", "backend.1.md");
    expect(denied(root, B, "backend", sneaky)).toBe(true);
    const toRoot = path.join(root, ".claude", "channels", "task-002", "..", "..", "channels", "test", "x.md");
    expect(denied(root, B, "backend", toRoot)).toBe(true);
    // A `..` that stays inside the own scope still passes.
    const inside = path.join(root, ".claude", "channels", "task-002", "test", "..", "reviewer", "test.1.md");
    expect(denied(root, B, "backend", inside)).toBe(false);
  });

  it("a relative path is resolved before the scope check", async () => {
    const { root } = await worktreeSessions();
    expect(denied(root, B, "backend", ".claude/channels/task-001/test/backend.1.md")).toBe(true);
    expect(denied(root, B, "backend", ".claude/channels/task-002/test/backend.1.md")).toBe(false);
  });

  it("the worktree's own .claude/channels copy is confined too", async () => {
    const { root, wt } = await worktreeSessions();
    expect(denied(root, B, "backend", path.join(wt, ".claude", "channels", "task-001", "test", "x.md"))).toBe(true);
    expect(denied(root, B, "backend", path.join(wt, ".claude", "channels", "task-002", "test", "x.md"))).toBe(false);
  });

  it("a session with no worktree is not narrowed by the worktree rule", async () => {
    const { root } = await worktreeSessions();
    // A is in the main checkout: another scope and the legacy root are not refused for a non-confined agent.
    expect(denied(root, A, "backend", ch(root, "task-002", "test", "backend.1.md"))).toBe(false);
    expect(denied(root, A, "backend", ch(root, "test", "backend.1.md"))).toBe(false);
    expect(denied(root, A, null, path.join(root, "app.txt"))).toBe(false);
  });

  it("non-channel paths keep the 082 behaviour for a worktree session", async () => {
    const { root, wt } = await worktreeSessions();
    expect(denied(root, B, "backend", path.join(root, "app.txt"))).toBe(true);
    expect(denied(root, B, "backend", path.join(wt, "app.txt"))).toBe(false);
    expect(denied(root, B, "backend", path.join(root, ".claude", "maestro-tasks", "002-b.md"))).toBe(false);
  });
});

describe("checkWorktreeWrite channelScope (147) unit", () => {
  const worktree = { path: "/nope/wt", main_root: "/nope/main" };
  const w = (file: string, channelScope?: string | null, cwd = "/nope/wt") =>
    checkWorktreeWrite({ cwd, toolName: "Write", toolInput: { file_path: file }, worktree, channelScope });

  it("allows the own scope and refuses another scope and the legacy root, naming the own scope", () => {
    expect(w("/nope/main/.claude/channels/task-002/test/b.1.md", "task-002").allow).toBe(true);
    const other = w("/nope/main/.claude/channels/task-001/test/b.1.md", "task-002");
    expect(other.allow).toBe(false);
    expect(other).toMatchObject({ reason: expect.stringContaining(".claude/channels/task-002/") });
    expect(w("/nope/main/.claude/channels/test/b.1.md", "task-002").allow).toBe(false);
    expect(w("/nope/main/.claude/channels/b.1.md", "task-002").allow).toBe(false);
  });

  it("refuses a `..` that leaves the own scope, in both the main and worktree channels dirs", () => {
    expect(w("/nope/main/.claude/channels/task-002/../task-001/x.md", "task-002").allow).toBe(false);
    expect(w("/nope/wt/.claude/channels/task-002/../task-001/x.md", "task-002").allow).toBe(false);
    expect(w("../main/.claude/channels/task-002/../task-001/x.md", "task-002").allow).toBe(false);
  });

  it("does not treat a sibling with the scope as a name prefix as the own scope", () => {
    expect(w("/nope/main/.claude/channels/task-0022/test/x.md", "task-002").allow).toBe(false);
  });

  it("a missing, null or invalid channelScope keeps the old behaviour (no channel rule)", () => {
    for (const scope of [undefined, null, "", "not a scope!", "../x"]) {
      expect(w("/nope/main/.claude/channels/task-001/test/b.1.md", scope).allow).toBe(true);
      expect(w("/nope/main/.claude/channels/test/b.1.md", scope).allow).toBe(true);
      // main-checkout source is still refused regardless
      expect(w("/nope/main/src/a.ts", scope).allow).toBe(false);
    }
  });

  it("no worktree: the channel rule never applies", () => {
    expect(
      checkWorktreeWrite({
        cwd: "/nope/main",
        toolName: "Write",
        toolInput: { file_path: "/nope/main/.claude/channels/task-001/test/b.1.md" },
        worktree: null,
        channelScope: "task-002",
      }).allow
    ).toBe(true);
  });

  it("paths outside any channels dir are unaffected by the scope", () => {
    expect(w("/nope/wt/src/a.ts", "task-002").allow).toBe(true);
    expect(w("/nope/main/src/a.ts", "task-002").allow).toBe(false);
    expect(w("/nope/elsewhere/a.md", "task-002").allow).toBe(true);
  });
});

describe("claim sets the channel scope (147)", () => {
  it("a session that started on session-<id8> moves to task-<NNN> when it claims", async () => {
    const root = await repo();
    liveSession(root, S);
    expect(channelScopeOf(root, S)).toBe("session-ssss3333");
    expect(ok(script(root, S, "maestro-task-status.cjs", ["claim", "003-c.md"])).stdout).toContain("claimed");
    expect(readState(root, S).active_task).toBe("003-c.md");
    expect(channelScopeOf(root, S)).toBe("task-003");
  });

  it("creates session.json when there is none and keeps every other key when there is one", async () => {
    const root = await repo();
    // No session.json at all: only the (log-bearing) session dir exists.
    liveSession(root, S);
    expect(fs.existsSync(stateOf(root, S))).toBe(false);
    ok(script(root, S, "maestro-task-status.cjs", ["claim", "001-a.md"]));
    expect(readState(root, S).active_task).toBe("001-a.md");

    // Existing session.json: workflow, run_id and an unknown key survive the claim.
    liveSession(root, O);
    fs.writeFileSync(
      stateOf(root, O),
      JSON.stringify({ workflow: "default", run_id: "run-XYZ", generated_instances: ["a"], custom: { k: 1 } })
    );
    ok(script(root, O, "maestro-task-status.cjs", ["claim", "002-b.md"]));
    expect(readState(root, O)).toMatchObject({
      workflow: "default",
      run_id: "run-XYZ",
      generated_instances: ["a"],
      custom: { k: 1 },
      active_task: "002-b.md",
    });
    expect(fs.existsSync(stateOf(root, O) + ".tmp")).toBe(false);
  });

  it("a refused claim (task already held) leaves the loser's session untouched", async () => {
    const root = await repo();
    liveSession(root, S);
    liveSession(root, O);
    ok(script(root, S, "maestro-task-status.cjs", ["claim", "001-a.md"]));
    const lost = script(root, O, "maestro-task-status.cjs", ["claim", "001-a.md"]);
    expect(lost.stdout).not.toContain('claimed "001-a.md" for session ' + O);
    expect(fs.existsSync(stateOf(root, O))).toBe(false);
    expect(channelScopeOf(root, O)).toBe("session-oooo4444");
  });

  it("claiming retires the session-<id8> lanes it leaves behind", async () => {
    const root = await repo();
    liveSession(root, S);
    put(ch(root, "session-ssss3333", "test", "backend.1.md"));
    ok(script(root, S, "maestro-task-status.cjs", ["claim", "003-c.md"]));
    expect(fs.existsSync(ch(root, "session-ssss3333", "test", "backend.1.md"))).toBe(false);
    expect(fs.existsSync(ch(root, "session-ssss3333", ".consumed", "test", "backend.1.md"))).toBe(true);
  });
});

describe("switching task mid-session retires the scope it leaves (147)", () => {
  it("set-session-workflow --task retires the previous task's undelivered lanes and keeps skill-gap reports", async () => {
    const root = await repo();
    liveSession(root, S);
    ok(script(root, S, "maestro-task-status.cjs", ["claim", "001-a.md"]));
    put(ch(root, "task-001", "test", "backend.1.md"), '{"x":1}\n');
    put(ch(root, "task-001", "reviewer", "test.1.md"));
    put(ch(root, "task-001", "scribe", "backend.1.md"), gapBody);
    put(ch(root, "task-001", "scribe", "test.1.md"), '{"not":"a gap"}\n');

    ok(script(root, S, "maestro-set-session-workflow.cjs", ["default", "--task", "002-b.md"]));

    expect(channelScopeOf(root, S)).toBe("task-002");
    expect(fs.existsSync(ch(root, "task-001", "test", "backend.1.md"))).toBe(false);
    expect(fs.existsSync(ch(root, "task-001", ".consumed", "test", "backend.1.md"))).toBe(true);
    expect(fs.existsSync(ch(root, "task-001", ".consumed", "reviewer", "test.1.md"))).toBe(true);
    // The gap report outlives delivery; a non-gap scribe file is retired like any other.
    expect(fs.existsSync(ch(root, "task-001", "scribe", "backend.1.md"))).toBe(true);
    expect(fs.existsSync(ch(root, "task-001", ".consumed", "scribe", "test.1.md"))).toBe(true);
  });

  it("never retires a scope another live session still owns", async () => {
    const root = await repo();
    liveSession(root, S);
    liveSession(root, O);
    // Both sessions' state resolves to task-001 (e.g. a resumed/forked session).
    fs.writeFileSync(stateOf(root, S), JSON.stringify({ active_task: "001-a.md" }));
    fs.writeFileSync(stateOf(root, O), JSON.stringify({ active_task: "001-a.md" }));
    put(ch(root, "task-001", "test", "backend.1.md"));

    ok(script(root, S, "maestro-set-session-workflow.cjs", ["default", "--task", "002-b.md"]));

    expect(channelScopeOf(root, S)).toBe("task-002");
    expect(fs.existsSync(ch(root, "task-001", "test", "backend.1.md"))).toBe(true);
    expect(fs.existsSync(ch(root, "task-001", ".consumed"))).toBe(false);
  });

  it("leaves unrelated live sessions' scopes alone", async () => {
    const root = await repo();
    liveSession(root, S);
    liveSession(root, O);
    ok(script(root, S, "maestro-task-status.cjs", ["claim", "001-a.md"]));
    ok(script(root, O, "maestro-task-status.cjs", ["claim", "003-c.md"]));
    put(ch(root, "task-001", "test", "backend.1.md"));
    put(ch(root, "task-003", "test", "backend.1.md"));
    put(ch(root, "session-oooo4444", "test", "backend.1.md"));

    ok(script(root, S, "maestro-set-session-workflow.cjs", ["default", "--task", "002-b.md"]));

    expect(fs.existsSync(ch(root, "task-001", ".consumed", "test", "backend.1.md"))).toBe(true);
    expect(fs.existsSync(ch(root, "task-003", "test", "backend.1.md"))).toBe(true);
    expect(fs.existsSync(ch(root, "session-oooo4444", "test", "backend.1.md"))).toBe(true);
  });

  it("re-recording the same task is a no-op for the lanes", async () => {
    const root = await repo();
    liveSession(root, S);
    ok(script(root, S, "maestro-task-status.cjs", ["claim", "001-a.md"]));
    put(ch(root, "task-001", "test", "backend.1.md"));
    ok(script(root, S, "maestro-set-session-workflow.cjs", ["default", "--task", "001-a.md"]));
    ok(script(root, S, "maestro-set-session-workflow.cjs", ["default"])); // no --task: scope unchanged
    expect(fs.existsSync(ch(root, "task-001", "test", "backend.1.md"))).toBe(true);
    expect(fs.existsSync(ch(root, "task-001", ".consumed"))).toBe(false);
  });

  it("with no prior lanes the switch still succeeds", async () => {
    const root = await repo();
    liveSession(root, S);
    ok(script(root, S, "maestro-task-status.cjs", ["claim", "001-a.md"]));
    ok(script(root, S, "maestro-set-session-workflow.cjs", ["default", "--task", "002-b.md"]));
    expect(readState(root, S).active_task).toBe("002-b.md");
  });
});

describe("recordActiveTask / retireScope (147) direct", () => {
  let root: string;
  beforeEach(() => {
    root = path.join(tmp, "proj");
    fs.mkdirSync(path.join(root, ".claude", "maestro_sessions"), { recursive: true });
  });

  it("records active_task, preserves other keys, and reports the scope move and retired files", () => {
    put(ch(root, "session-ssss3333", "test", "backend.1.md"));
    fs.mkdirSync(sessDir(root, S), { recursive: true });
    fs.writeFileSync(stateOf(root, S), JSON.stringify({ workflow: "w", extra: [1, 2] }));
    const res = recordActiveTask(root, S, ".claude/maestro-tasks/007-x.md");
    expect(res).toMatchObject({ scope: "task-007", priorScope: "session-ssss3333" });
    expect(res!.retired).toHaveLength(1);
    expect(readState(root, S)).toEqual({ workflow: "w", extra: [1, 2], active_task: "007-x.md" });
  });

  it("is a no-op for the lanes when the scope does not change", () => {
    fs.mkdirSync(sessDir(root, S), { recursive: true });
    fs.writeFileSync(stateOf(root, S), JSON.stringify({ active_task: "007-x.md" }));
    put(ch(root, "task-007", "test", "backend.1.md"));
    const res = recordActiveTask(root, S, "007-other-name.md");
    expect(res).toMatchObject({ scope: "task-007", priorScope: "task-007", retired: [] });
    expect(fs.existsSync(ch(root, "task-007", "test", "backend.1.md"))).toBe(true);
  });

  it("returns null for an invalid session id and writes nothing", () => {
    expect(recordActiveTask(root, "../evil", "001-a.md")).toBeNull();
    expect(recordActiveTask(root, undefined, "001-a.md")).toBeNull();
    expect(fs.readdirSync(path.join(root, ".claude", "maestro_sessions"))).toEqual([]);
  });

  it("recovers from a corrupt or non-object session.json", () => {
    fs.mkdirSync(sessDir(root, S), { recursive: true });
    fs.writeFileSync(stateOf(root, S), "not json{");
    expect(recordActiveTask(root, S, "001-a.md")).toMatchObject({ scope: "task-001" });
    fs.writeFileSync(stateOf(root, S), "[1,2]");
    expect(recordActiveTask(root, S, "002-b.md")).toMatchObject({ scope: "task-002" });
    expect(readState(root, S)).toEqual({ active_task: "002-b.md" });
  });

  it("retireScope refuses an invalid scope and a missing scope dir", () => {
    expect(retireScope(root, "../etc", S)).toEqual([]);
    expect(retireScope(root, "not-a-scope", S)).toEqual([]);
    expect(retireScope(root, "task-999", S)).toEqual([]);
  });

  it("retireScope skips when another session owns the scope, even by session-<id8> fallback", () => {
    // O has no active_task, so its scope is session-oooo4444; S asks to retire exactly that.
    fs.mkdirSync(sessDir(root, O), { recursive: true });
    fs.writeFileSync(stateOf(root, O), JSON.stringify({}));
    put(ch(root, "session-oooo4444", "test", "backend.1.md"));
    expect(retireScope(root, "session-oooo4444", S)).toEqual([]);
    expect(fs.existsSync(ch(root, "session-oooo4444", "test", "backend.1.md"))).toBe(true);
    // The owner itself may retire its own old scope.
    expect(retireScope(root, "session-oooo4444", O)).toHaveLength(1);
  });
});
