// `074` through the REAL installed CLI and hook: a session that claims a task while ANOTHER live
// session holds a claim works in a sibling git worktree. Real git repos under os.tmpdir(), the
// installed maestro-task-status.cjs / maestro-inject-agent-context.cjs spawned with HOME pinned and
// CLAUDE_CODE_SESSION_ID always set or deleted (never inherited) — see test-maestro's
// references/hook-script-tests.md. Nothing is mocked.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";
import { sessionPathsFor, readWorktreePointer } from "../../src/core/session-paths.js";
import { sweepStaleSessions } from "../../src/core/session-sweep.js";
import { listTasks, tasksDirFor } from "../../src/core/tasks.js";
import {
  mainCheckoutRoot,
  isLinkedWorktree,
  taskNumber,
  worktreeBranchFor,
  worktreePathFor,
} from "../../src/core/worktree.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

const SESSION_A = "sess-aaa-111";
const SESSION_B = "sess-bbb-222";
const SESSION_C = "sess-ccc-333";

let tmp: string;
let REPORTS_DB: string;
let PROJECT_TAGS_DB: string;
let HANDOFFS_DB: string;

beforeEach(() => {
  // realpath: git reports resolved paths, and os.tmpdir() may be a symlink on some hosts.
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-074-")));
  REPORTS_DB = path.join(tmp, "report-defaults.sqlite");
  PROJECT_TAGS_DB = path.join(tmp, "project-tags.sqlite");
  HANDOFFS_DB = path.join(tmp, "handoff-defaults.sqlite");
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

/** A committed repo with the Maestro install committed (so it travels into a worktree) and a tasks dir. */
async function installed(name = "repo"): Promise<string> {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeConfig(root, defaultish);
  await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
  fs.writeFileSync(path.join(root, "app.txt"), "main\n");
  writeTask(root, "001-a.md", "A");
  writeTask(root, "002-b.md", "B");
  writeTask(root, "003-c.md", "C");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

function hookEnv(projectDir: string, sessionId: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: projectDir, HOME: tmp };
  if (sessionId === null) delete env.CLAUDE_CODE_SESSION_ID;
  else env.CLAUDE_CODE_SESSION_ID = sessionId;
  return env;
}

/** Run the installed CLI out of `dir` (a main checkout or a worktree). */
function cli(dir: string, args: string[], sessionId: string | null) {
  const res = spawnSync("node", [path.join(dir, ".claude", "scripts", "maestro-task-status.cjs"), ...args], {
    encoding: "utf8",
    env: hookEnv(dir, sessionId),
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const tasksDir = (root: string) => path.join(root, ".claude", "maestro-tasks");
const claimPath = (root: string, f: string) => path.join(tasksDir(root), "claims", `${f}.json`);
const sessionDir = (root: string, id: string) => path.join(root, ".claude", "maestro_sessions", id);

function writeTask(root: string, filename: string, title: string) {
  fs.mkdirSync(tasksDir(root), { recursive: true });
  fs.writeFileSync(path.join(tasksDir(root), filename), `# ${title}\n\n## Blocked by\n\nNone\n`);
}

function makeLiveSession(root: string, id: string) {
  fs.mkdirSync(sessionDir(root, id), { recursive: true });
  fs.writeFileSync(path.join(sessionDir(root, id), "log.jsonl"), '{"kind":"tool_call"}\n');
}

/** Session A is live and holds 001; B (a second session) is live. Returns the repo. */
async function twoSessions(): Promise<string> {
  const root = await installed();
  makeLiveSession(root, SESSION_A);
  makeLiveSession(root, SESSION_B);
  expect(cli(root, ["claim", "001-a.md"], SESSION_A).stdout).toContain("claimed");
  return root;
}

const wtPathFor = (root: string, n: string) => path.join(path.dirname(root), `${path.basename(root)}-task-${n}`);

describe("worktree naming and root resolution (pure)", () => {
  it("derives task-NNN branch and a sibling path, null without a number", () => {
    expect(taskNumber("074-foo.md")).toBe("074");
    expect(worktreeBranchFor("074-foo.md")).toBe("task-074");
    expect(worktreePathFor("/x/repo", "074-foo.md")).toBe("/x/repo-task-074");
    expect(worktreeBranchFor("notes.md")).toBeNull();
    expect(worktreePathFor("/x/repo", "notes.md")).toBeNull();
  });

  it("mainCheckoutRoot returns the dir for a main checkout / non-git dir, the main for a linked worktree", async () => {
    const root = await installed();
    const plain = path.join(tmp, "plain");
    fs.mkdirSync(plain);
    expect(mainCheckoutRoot(root)).toBe(root);
    expect(mainCheckoutRoot(plain)).toBe(plain);
    const wt = wtPathFor(root, "009");
    git(root, "worktree", "add", "-q", "-b", "task-009", wt);
    expect(mainCheckoutRoot(wt)).toBe(root);
    expect(isLinkedWorktree(wt)).toBe(true);
    expect(isLinkedWorktree(root)).toBe(false);
  });
});

describe("maestro-task-status.cjs worktree (074)", () => {
  it("solo session: no worktree is created and nothing moves", async () => {
    const root = await installed();
    makeLiveSession(root, SESSION_A);
    expect(cli(root, ["claim", "001-a.md"], SESSION_A).code).toBe(0);

    const run = cli(root, ["worktree", "001-a.md"], SESSION_A);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("no worktree needed");
    expect(fs.existsSync(wtPathFor(root, "001"))).toBe(false);
    expect(git(root, "branch", "--list", "task-001")).toBe("");
    expect(fs.existsSync(path.join(sessionDir(root, SESSION_A), "worktree.json"))).toBe(false);
  });

  it("a dead foreign claim does not trigger a worktree", async () => {
    const root = await twoSessions();
    const stale = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(path.join(sessionDir(root, SESSION_A), "log.jsonl"), stale, stale);
    expect(cli(root, ["claim", "002-b.md"], SESSION_B).stdout).toContain("claimed");

    const run = cli(root, ["worktree", "002-b.md"], SESSION_B);

    expect(run.stdout).toContain("no worktree needed");
    expect(fs.existsSync(wtPathFor(root, "002"))).toBe(false);
  });

  it("live foreign claim: creates sibling worktree on task-NNN with the install and its own state", async () => {
    const root = await twoSessions();
    expect(cli(root, ["claim", "002-b.md"], SESSION_B).stdout).toContain("claimed");

    const run = cli(root, ["worktree", "002-b.md"], SESSION_B);

    const wt = wtPathFor(root, "002");
    expect(run.code).toBe(0);
    expect(run.stdout).toContain(wt);
    expect(run.stdout).toContain("task-002");
    expect(path.dirname(wt)).toBe(path.dirname(root)); // sibling
    expect(fs.statSync(wt).isDirectory()).toBe(true);
    expect(git(wt, "rev-parse", "--abbrev-ref", "HEAD")).toBe("task-002");
    expect(fs.existsSync(path.join(wt, ".claude", "scripts", "maestro-task-status.cjs"))).toBe(true);
    expect(fs.existsSync(path.join(wt, ".claude", "maestro.json"))).toBe(true);
    // The session's state moved into the worktree; main keeps only the pointer.
    expect(fs.existsSync(path.join(sessionDir(wt, SESSION_B), "session.json"))).toBe(true);
    expect(fs.readdirSync(sessionDir(root, SESSION_B))).toEqual(["worktree.json"]);
    const ptr = readWorktreePointer(path.join(root, ".claude"), SESSION_B);
    expect(ptr).toMatchObject({ path: wt, branch: "task-002", main_root: root, task: "002-b.md" });
    expect(sessionPathsFor(path.join(root, ".claude"), SESSION_B)!.dir).toBe(sessionDir(wt, SESSION_B));
    // Session A (no worktree) is unaffected.
    expect(sessionPathsFor(path.join(root, ".claude"), SESSION_A)!.dir).toBe(sessionDir(root, SESSION_A));
  });

  it("is idempotent: a second call reports the existing worktree and creates nothing new", async () => {
    const root = await twoSessions();
    cli(root, ["claim", "002-b.md"], SESSION_B);
    cli(root, ["worktree", "002-b.md"], SESSION_B);

    const again = cli(root, ["worktree", "002-b.md"], SESSION_B);

    expect(again.code).toBe(0);
    expect(again.stdout).toContain("already works in worktree");
  });

  it("edits in the worktree do not appear in the main checkout's working tree", async () => {
    const root = await twoSessions();
    cli(root, ["claim", "002-b.md"], SESSION_B);
    cli(root, ["worktree", "002-b.md"], SESSION_B);
    const wt = wtPathFor(root, "002");

    fs.writeFileSync(path.join(wt, "app.txt"), "changed in worktree\n");
    fs.writeFileSync(path.join(wt, "new.txt"), "new\n");

    expect(fs.readFileSync(path.join(root, "app.txt"), "utf8")).toBe("main\n");
    expect(fs.existsSync(path.join(root, "new.txt"))).toBe(false);
    expect(git(root, "status", "--porcelain")).not.toContain("app.txt");
  });

  it("queue and claims resolve to main from the worktree; close from the worktree marks main's status.json", async () => {
    const root = await twoSessions();
    cli(root, ["sync"], SESSION_A);
    cli(root, ["claim", "002-b.md"], SESSION_B);
    cli(root, ["worktree", "002-b.md"], SESSION_B);
    const wt = wtPathFor(root, "002");

    // Pure resolvers
    expect(tasksDirFor(wt)).toBe(tasksDir(root));
    expect(listTasks(wt).map((t) => t.filename)).toEqual(listTasks(root).map((t) => t.filename));

    // A claim made from inside the worktree lands in main's claims dir.
    const claimFromWt = cli(wt, ["claim", "003-c.md"], SESSION_B);
    expect(claimFromWt.stdout).toContain("claimed");
    expect(fs.existsSync(claimPath(root, "003-c.md"))).toBe(true);
    expect(fs.existsSync(path.join(tasksDir(wt), "claims", "003-c.md.json"))).toBe(false);
    // ...and session A, in main, sees it as already claimed.
    expect(cli(root, ["claim", "003-c.md"], SESSION_A).stdout).toContain("already claimed");

    // done from the worktree writes MAIN's status.json
    const done = cli(wt, ["done", "002-b.md"], SESSION_B);
    expect(done.code).toBe(0);
    const status = JSON.parse(fs.readFileSync(path.join(tasksDir(root), "status.json"), "utf8"));
    expect(status["002-b.md"].status).toBe("done");
    expect(fs.existsSync(claimPath(root, "002-b.md"))).toBe(false);
    expect(fs.existsSync(path.join(tasksDir(wt), "status.json"))).toBe(false);
    expect(listTasks(root).find((t) => t.filename === "002-b.md")!.status).toBe("done");
  });

  it("on done, the worktree and branch remain", async () => {
    const root = await twoSessions();
    cli(root, ["claim", "002-b.md"], SESSION_B);
    cli(root, ["worktree", "002-b.md"], SESSION_B);
    const wt = wtPathFor(root, "002");
    fs.writeFileSync(path.join(wt, "work.txt"), "w\n");

    expect(cli(wt, ["done", "002-b.md"], SESSION_B).code).toBe(0);

    expect(fs.existsSync(path.join(wt, "work.txt"))).toBe(true);
    expect(git(root, "branch", "--list", "task-002")).toContain("task-002");
    expect(git(root, "worktree", "list")).toContain(wt);
    expect(fs.existsSync(path.join(sessionDir(root, SESSION_B), "worktree.json"))).toBe(true);
  });

  it("dead session's worktree is not removed, and does not confuse or block a later session", async () => {
    const root = await twoSessions();
    cli(root, ["claim", "002-b.md"], SESSION_B);
    cli(root, ["worktree", "002-b.md"], SESSION_B);
    const wt = wtPathFor(root, "002");
    fs.writeFileSync(path.join(wt, "work.txt"), "w\n");
    fs.writeFileSync(path.join(sessionDir(wt, SESSION_B), "log.jsonl"), "{}\n");

    // Both A and B die: stale logs (B's log lives in the worktree, reached via the pointer).
    const stale = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(path.join(sessionDir(root, SESSION_A), "log.jsonl"), stale, stale);
    fs.utimesSync(path.join(sessionDir(wt, SESSION_B), "log.jsonl"), stale, stale);

    makeLiveSession(root, SESSION_C);
    const claim = cli(root, ["claim", "003-c.md"], SESSION_C);
    const run = cli(root, ["worktree", "003-c.md"], SESSION_C);

    expect(claim.stdout).toContain("claimed");
    expect(run.stdout).toContain("no worktree needed"); // dead claims are not "live foreign"
    expect(fs.existsSync(wtPathFor(root, "003"))).toBe(false);
    // The dead session's claim was reaped when C looked; its worktree is untouched.
    expect(fs.existsSync(path.join(wt, "work.txt"))).toBe(true);
    expect(git(root, "branch", "--list", "task-002")).toContain("task-002");
    // Re-claiming the dead session's task works (reaped, not blocking).
    expect(cli(root, ["claim", "002-b.md"], SESSION_C).stdout).toContain("claimed");
  });

  it("sweeping an abandoned worktree session removes its state but never the worktree or branch", async () => {
    const root = await twoSessions();
    cli(root, ["claim", "002-b.md"], SESSION_B);
    cli(root, ["worktree", "002-b.md"], SESSION_B);
    const wt = wtPathFor(root, "002");
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    for (const d of [sessionDir(wt, SESSION_B), sessionDir(root, SESSION_B)]) {
      for (const f of fs.readdirSync(d)) fs.utimesSync(path.join(d, f), old, old);
      fs.utimesSync(d, old, old);
    }

    const res = sweepStaleSessions([root], { env: {} });

    expect(res.removed.map((r) => r.sessionId)).toContain(SESSION_B);
    expect(fs.existsSync(sessionDir(root, SESSION_B))).toBe(false);
    expect(fs.existsSync(sessionDir(wt, SESSION_B))).toBe(false);
    expect(fs.existsSync(wt)).toBe(true);
    expect(git(root, "branch", "--list", "task-002")).toContain("task-002");
  });

  it("existing worktree path: clear message, nothing overwritten, exit 0", async () => {
    const root = await twoSessions();
    cli(root, ["claim", "002-b.md"], SESSION_B);
    const wt = wtPathFor(root, "002");
    fs.mkdirSync(wt);
    fs.writeFileSync(path.join(wt, "keep.txt"), "keep\n");

    const run = cli(root, ["worktree", "002-b.md"], SESSION_B);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("already exists");
    expect(run.stdout).toContain(wt);
    expect(run.stdout).toContain("NOT reused");
    expect(fs.readFileSync(path.join(wt, "keep.txt"), "utf8")).toBe("keep\n");
    expect(fs.existsSync(path.join(sessionDir(root, SESSION_B), "worktree.json"))).toBe(false);
  });

  it("existing branch: clear message naming the branch, no worktree created", async () => {
    const root = await twoSessions();
    cli(root, ["claim", "002-b.md"], SESSION_B);
    git(root, "branch", "task-002");

    const run = cli(root, ["worktree", "002-b.md"], SESSION_B);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("branch task-002");
    expect(run.stdout).toContain("already exists");
    expect(fs.existsSync(wtPathFor(root, "002"))).toBe(false);
    expect(fs.existsSync(path.join(sessionDir(root, SESSION_B), "worktree.json"))).toBe(false);
  });

  it("argument and session-id errors are explicit nonzero exits, not crashes", async () => {
    const root = await twoSessions();
    const noArg = cli(root, ["worktree"], SESSION_B);
    expect(noArg.code).not.toBe(0);
    expect(noArg.stderr).toContain("needs a task filename");
    const noId = cli(root, ["worktree", "002-b.md"], null);
    expect(noId.code).not.toBe(0);
    expect(noId.stderr).toContain("no resolvable session id");
  });

  it("a task filename with no number gets a message, not a worktree", async () => {
    const root = await twoSessions();
    writeTask(root, "notes.md", "N");
    makeLiveSession(root, SESSION_B);

    const run = cli(root, ["worktree", "notes.md"], SESSION_B);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("no task number");
  });

  it("per-session gitignored state is separate: worktree session.json differs from main's other sessions", async () => {
    const root = await twoSessions();
    fs.writeFileSync(path.join(sessionDir(root, SESSION_A), "session.json"), JSON.stringify({ marker: "A" }));
    fs.writeFileSync(path.join(sessionDir(root, SESSION_B), "session.json"), JSON.stringify({ marker: "B" }));
    cli(root, ["claim", "002-b.md"], SESSION_B);
    cli(root, ["worktree", "002-b.md"], SESSION_B);
    const wt = wtPathFor(root, "002");

    const mainA = JSON.parse(fs.readFileSync(path.join(sessionDir(root, SESSION_A), "session.json"), "utf8"));
    const wtB = JSON.parse(fs.readFileSync(path.join(sessionDir(wt, SESSION_B), "session.json"), "utf8"));
    expect(mainA).toEqual({ marker: "A" });
    expect(wtB.marker).toBe("B"); // carried over, then diverges
    expect(wtB.worktree).toMatchObject({ path: wt, branch: "task-002", main_root: root });
    expect(fs.existsSync(path.join(sessionDir(root, SESSION_B), "session.json"))).toBe(false);
    expect(fs.existsSync(path.join(sessionDir(wt, SESSION_A)))).toBe(false);
    // The worktree's state is gitignored there too, so it never shows up as a change to merge.
    expect(git(wt, "status", "--porcelain")).not.toContain("maestro_sessions");
    expect(git(root, "status", "--porcelain")).not.toContain("maestro_sessions");
  });
});

describe("agent context injection in a worktree session (074)", () => {
  it("tells subagents the worktree path and branch; a non-worktree session gets no such block", async () => {
    const root = await twoSessions();
    cli(root, ["claim", "002-b.md"], SESSION_B);
    cli(root, ["worktree", "002-b.md"], SESSION_B);
    const wt = wtPathFor(root, "002");
    const script = path.join(root, ".claude", "scripts", "maestro-inject-agent-context.cjs");

    const spawnHook = (sessionId: string) =>
      spawnSync("node", [script], {
        encoding: "utf8",
        env: hookEnv(root, sessionId),
        input: JSON.stringify({
          hook_event_name: "SubagentStart",
          session_id: sessionId,
          agent_type: "backend",
          agent_id: "agent-1",
          cwd: root,
        }),
      });

    const inWt = spawnHook(SESSION_B);
    const solo = spawnHook(SESSION_A);

    expect(inWt.status).toBe(0);
    expect(inWt.stdout).toContain("Git worktree");
    expect(inWt.stdout).toContain(wt);
    expect(inWt.stdout).toContain("task-002");
    expect(solo.status).toBe(0);
    expect(solo.stdout).not.toContain("Git worktree");
  });
});
