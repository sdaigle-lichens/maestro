// `076` through the REAL installed CLI: `maestro-task-status.cjs merge <filename|NNN>`. Real git repos
// and real worktrees under os.tmpdir(); HOME pinned and CLAUDE_CODE_SESSION_ID always set or deleted
// (never inherited) — see test-maestro's references/hook-script-tests.md. Nothing is mocked.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const REPO_ROOT = path.resolve(here, "../../../..");

const SESSION_A = "sess-aaa-111";
const SESSION_B = "sess-bbb-222";

let tmp: string;
let REPORTS_DB: string;
let PROJECT_TAGS_DB: string;
let HANDOFFS_DB: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-076-")));
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

function gitFails(cwd: string, ...args: string[]): boolean {
  try {
    git(cwd, ...args);
    return false;
  } catch {
    return true;
  }
}

function hookEnv(projectDir: string, sessionId: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_PROJECT_DIR: projectDir,
    HOME: tmp,
    // HOME is pinned to an empty dir, so give git the identity the merge commit needs.
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  if (sessionId === null) delete env.CLAUDE_CODE_SESSION_ID;
  else env.CLAUDE_CODE_SESSION_ID = sessionId;
  return env;
}

function cli(dir: string, args: string[], sessionId: string | null) {
  const res = spawnSync("node", [path.join(dir, ".claude", "scripts", "maestro-task-status.cjs"), ...args], {
    encoding: "utf8",
    env: hookEnv(dir, sessionId),
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const tasksDir = (root: string) => path.join(root, ".claude", "maestro-tasks");
const sessionDir = (root: string, id: string) => path.join(root, ".claude", "maestro_sessions", id);
const wtPathFor = (root: string, n: string) => path.join(path.dirname(root), `${path.basename(root)}-task-${n}`);

function writeTask(root: string, filename: string, title: string) {
  fs.mkdirSync(tasksDir(root), { recursive: true });
  fs.writeFileSync(path.join(tasksDir(root), filename), `# ${title}\n\n## Blocked by\n\nNone\n`);
}

function makeLiveSession(root: string, id: string) {
  fs.mkdirSync(sessionDir(root, id), { recursive: true });
  fs.writeFileSync(path.join(sessionDir(root, id), "log.jsonl"), '{"kind":"tool_call"}\n');
}

async function installed(): Promise<string> {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeConfig(root, defaultish);
  await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
  fs.writeFileSync(path.join(root, "app.txt"), "main\n");
  fs.writeFileSync(path.join(root, "f.txt"), "base\n");
  writeTask(root, "001-a.md", "A");
  writeTask(root, "002-b.md", "B");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

/** Session A holds 001; session B claims 002 and gets worktree task-002. */
async function withWorktree(): Promise<{ root: string; wt: string }> {
  const root = await installed();
  makeLiveSession(root, SESSION_A);
  makeLiveSession(root, SESSION_B);
  expect(cli(root, ["claim", "001-a.md"], SESSION_A).stdout).toContain("claimed");
  expect(cli(root, ["claim", "002-b.md"], SESSION_B).stdout).toContain("claimed");
  cli(root, ["worktree", "002-b.md"], SESSION_B);
  const wt = wtPathFor(root, "002");
  expect(fs.statSync(wt).isDirectory()).toBe(true);
  return { root, wt };
}

/** Commit a change in the worktree and mark the task done. */
function finish(wt: string, file = "work.txt", content = "w\n") {
  fs.writeFileSync(path.join(wt, file), content);
  git(wt, "add", "-A");
  git(wt, "commit", "-q", "-m", "work");
  expect(cli(wt, ["done", "002-b.md"], SESSION_B).code).toBe(0);
}

const statusOf = (root: string) => git(root, "status", "--porcelain", "--untracked-files=no");

describe("maestro-task-status.cjs merge (076) — refusals change nothing", () => {
  it("refuses a task that is not done", async () => {
    const { root, wt } = await withWorktree();
    fs.writeFileSync(path.join(wt, "work.txt"), "w\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "work");
    const head = git(root, "rev-parse", "HEAD");

    const run = cli(root, ["merge", "002-b.md"], null);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain("REFUSED");
    expect(run.stdout).toContain('not "done"');
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(fs.existsSync(wt)).toBe(true);
    expect(git(root, "branch", "--list", "task-002")).toContain("task-002");
  });

  it("refuses an unknown task and a numberless filename", async () => {
    const { root } = await withWorktree();
    writeTask(root, "notes.md", "N");

    const unknown = cli(root, ["merge", "099"], null);
    const numberless = cli(root, ["merge", "notes.md"], null);

    expect(unknown.code).toBe(1);
    expect(unknown.stdout).toContain("REFUSED");
    expect(numberless.code).toBe(1);
    expect(numberless.stdout).toContain("no task number");
  });

  it("without an argument it is an explicit nonzero exit", async () => {
    const { root } = await withWorktree();
    const run = cli(root, ["merge"], null);
    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("needs a task filename");
  });

  it("refuses a dirty worktree (modified tracked file and untracked file), keeping the work", async () => {
    const { root, wt } = await withWorktree();
    finish(wt);
    const head = git(root, "rev-parse", "HEAD");

    fs.writeFileSync(path.join(wt, "app.txt"), "uncommitted\n");
    const modified = cli(root, ["merge", "002-b.md"], null);
    expect(modified.code).toBe(1);
    expect(modified.stdout).toContain("REFUSED");
    expect(modified.stdout).toContain("uncommitted changes");

    git(wt, "checkout", "--", "app.txt");
    fs.writeFileSync(path.join(wt, "scratch.txt"), "x\n");
    const untracked = cli(root, ["merge", "002-b.md"], null);
    expect(untracked.code).toBe(1);
    expect(untracked.stdout).toContain("uncommitted changes");

    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(fs.existsSync(path.join(wt, "scratch.txt"))).toBe(true);
    expect(git(root, "branch", "--list", "task-002")).toContain("task-002");
  });

  it("refuses when the branch does not exist", async () => {
    const root = await installed();
    expect(cli(root, ["done", "002-b.md"], null).code).toBe(0);

    const run = cli(root, ["merge", "002"], null);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain("does not exist");
  });

  it("refuses when the branch exists but has no worktree", async () => {
    const root = await installed();
    git(root, "branch", "task-002");
    expect(cli(root, ["done", "002-b.md"], null).code).toBe(0);

    const run = cli(root, ["merge", "002-b.md"], null);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain("no worktree");
    expect(git(root, "branch", "--list", "task-002")).toContain("task-002");
  });

  it("refuses when the main checkout is on a detached HEAD", async () => {
    const { root, wt } = await withWorktree();
    finish(wt);
    git(root, "checkout", "-q", "--detach");
    const head = git(root, "rev-parse", "HEAD");

    const run = cli(root, ["merge", "002-b.md"], null);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain("detached HEAD");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(fs.existsSync(wt)).toBe(true);
    expect(git(root, "branch", "--list", "task-002")).toContain("task-002");
  });

  it("refuses when the main checkout is mid-merge", async () => {
    const { root, wt } = await withWorktree();
    finish(wt);
    // Put main into a real conflicted merge with an unrelated branch.
    git(root, "checkout", "-q", "-b", "other");
    fs.writeFileSync(path.join(root, "f.txt"), "other\n");
    git(root, "commit", "-qam", "other");
    git(root, "checkout", "-q", "main");
    fs.writeFileSync(path.join(root, "f.txt"), "main-side\n");
    git(root, "commit", "-qam", "main side");
    expect(gitFails(root, "merge", "other")).toBe(true);
    expect(fs.existsSync(path.join(root, ".git", "MERGE_HEAD"))).toBe(true);

    const run = cli(root, ["merge", "002-b.md"], null);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain("middle of a merge");
    expect(fs.existsSync(path.join(root, ".git", "MERGE_HEAD"))).toBe(true); // user's merge untouched
    expect(fs.existsSync(wt)).toBe(true);
    expect(git(root, "branch", "--list", "task-002")).toContain("task-002");
  });
});

describe("maestro-task-status.cjs merge (076) — success and conflict", () => {
  it("clean merge: --no-ff into main, removes worktree, branch and session pointer; pushes nothing", async () => {
    const { root, wt } = await withWorktree();
    // A bare remote proves nothing is pushed.
    const remote = path.join(tmp, "remote.git");
    git(tmp, "init", "-q", "--bare", remote);
    git(root, "remote", "add", "origin", remote);
    finish(wt);
    expect(fs.existsSync(path.join(sessionDir(root, SESSION_B), "worktree.json"))).toBe(true);
    const before = git(root, "rev-parse", "HEAD");

    const run = cli(root, ["merge", "002"], null); // bare NNN

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("merged task-002 into main");
    expect(run.stdout).toContain("Nothing was pushed");
    expect(fs.readFileSync(path.join(root, "work.txt"), "utf8")).toBe("w\n");
    // --no-ff: a merge commit with two parents
    expect(git(root, "rev-list", "--parents", "-n", "1", "HEAD").split(" ").length).toBe(3);
    expect(git(root, "rev-parse", "HEAD^1")).toBe(before);
    expect(git(root, "log", "-1", "--format=%s")).toBe("Merge task-002 (002-b.md)");
    expect(fs.existsSync(wt)).toBe(false);
    expect(git(root, "worktree", "list")).not.toContain(wt);
    expect(git(root, "branch", "--list", "task-002")).toBe("");
    expect(fs.existsSync(path.join(sessionDir(root, SESSION_B), "worktree.json"))).toBe(false);
    // Session A's own state is untouched
    expect(fs.existsSync(path.join(sessionDir(root, SESSION_A), "log.jsonl"))).toBe(true);
    // nothing reached the remote
    expect(git(remote, "branch", "--list")).toBe("");
  });

  it("also accepts the full filename", async () => {
    const { root, wt } = await withWorktree();
    finish(wt);
    const run = cli(root, ["merge", "002-b.md"], null);
    expect(run.code).toBe(0);
    expect(fs.existsSync(wt)).toBe(false);
  });

  it("conflict: main unchanged, merge aborted, worktree and branch intact, conflicting files listed", async () => {
    const { root, wt } = await withWorktree();
    fs.writeFileSync(path.join(wt, "f.txt"), "from-worktree\n");
    fs.writeFileSync(path.join(wt, "g.txt"), "g-worktree\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "wt change");
    expect(cli(wt, ["done", "002-b.md"], SESSION_B).code).toBe(0);
    // Diverge main on the same file, committed.
    fs.writeFileSync(path.join(root, "f.txt"), "from-main\n");
    git(root, "commit", "-qam", "main change");
    const head = git(root, "rev-parse", "HEAD");
    const branchTip = git(root, "rev-parse", "task-002");

    const run = cli(root, ["merge", "002-b.md"], null);

    expect(run.code).toBe(1);
    expect(run.stdout).toContain("CONFLICT");
    expect(run.stdout).toContain("Conflicting files:");
    expect(run.stdout).toMatch(/^ {2}f\.txt$/m);
    expect(run.stdout).not.toMatch(/^ {2}g\.txt$/m);
    // main exactly as before
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(fs.existsSync(path.join(root, ".git", "MERGE_HEAD"))).toBe(false);
    expect(statusOf(root)).toBe("");
    expect(fs.readFileSync(path.join(root, "f.txt"), "utf8")).toBe("from-main\n");
    expect(fs.existsSync(path.join(root, "g.txt"))).toBe(false);
    // worktree and branch intact, work not lost
    expect(fs.existsSync(wt)).toBe(true);
    expect(git(root, "worktree", "list")).toContain(wt);
    expect(git(root, "rev-parse", "task-002")).toBe(branchTip);
    expect(fs.readFileSync(path.join(wt, "f.txt"), "utf8")).toBe("from-worktree\n");
    expect(fs.existsSync(path.join(sessionDir(root, SESSION_B), "worktree.json"))).toBe(true);
  });

  it("after a conflict is resolved in the worktree, a second merge succeeds", async () => {
    const { root, wt } = await withWorktree();
    finish(wt, "f.txt", "from-worktree\n");
    fs.writeFileSync(path.join(root, "f.txt"), "from-main\n");
    git(root, "commit", "-qam", "main change");
    expect(cli(root, ["merge", "002"], null).code).toBe(1);

    expect(gitFails(wt, "merge", "main")).toBe(true);
    fs.writeFileSync(path.join(wt, "f.txt"), "resolved\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "resolve");
    const run = cli(root, ["merge", "002"], null);

    expect(run.code).toBe(0);
    expect(fs.readFileSync(path.join(root, "f.txt"), "utf8")).toBe("resolved\n");
    expect(fs.existsSync(wt)).toBe(false);
    expect(git(root, "branch", "--list", "task-002")).toBe("");
  });

  it("merge would overwrite local changes in main: refused or aborted, nothing removed", async () => {
    const { root, wt } = await withWorktree();
    finish(wt, "app.txt", "from-worktree\n");
    fs.writeFileSync(path.join(root, "app.txt"), "local uncommitted\n"); // dirty main, same file
    const head = git(root, "rev-parse", "HEAD");

    const run = cli(root, ["merge", "002"], null);

    expect(run.code).toBe(1);
    expect(run.stdout).not.toContain("merged task-002");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(fs.readFileSync(path.join(root, "app.txt"), "utf8")).toBe("local uncommitted\n");
    expect(fs.existsSync(wt)).toBe(true);
    expect(git(root, "branch", "--list", "task-002")).toContain("task-002");
  });
});

describe("nothing is merged, pushed or removed without the merge command (076)", () => {
  it("claim, worktree, done, sync and release never merge or remove", async () => {
    const { root, wt } = await withWorktree();
    fs.writeFileSync(path.join(wt, "work.txt"), "w\n");
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "work");
    const head = git(root, "rev-parse", "HEAD");
    const tip = git(root, "rev-parse", "task-002");

    expect(cli(wt, ["done", "002-b.md"], SESSION_B).code).toBe(0);
    expect(cli(root, ["sync"], SESSION_A).code).toBe(0);
    expect(cli(root, ["release", "001-a.md"], SESSION_A).code).toBe(0);

    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(git(root, "rev-parse", "task-002")).toBe(tip);
    expect(fs.existsSync(wt)).toBe(true);
    expect(fs.existsSync(path.join(root, "work.txt"))).toBe(false);
    expect(git(root, "worktree", "list")).toContain(wt);
  });
});

describe("plugin and .claude/scripts copies (076)", () => {
  it("are byte-identical and carry the merge command", () => {
    const a = fs.readFileSync(path.join(REPO_ROOT, "plugins/maestro/scripts/maestro-task-status.cjs"));
    const b = fs.readFileSync(path.join(REPO_ROOT, ".claude/scripts/maestro-task-status.cjs"));
    expect(a.equals(b)).toBe(true);
    expect(a.toString("utf8")).toContain('command === "merge"');
  });
});
