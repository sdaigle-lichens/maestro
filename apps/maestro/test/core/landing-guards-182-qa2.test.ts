// `182` second QA round: the same-class landing messages the first round could not trigger, driven
// for real. Each test runs the INSTALLED `maestro-task-status.cjs` against a real git repository
// under os.tmpdir() (switch-back, merge), or the exported `checkReportCommit` with a real git runner
// (the epic report check). Nothing is mocked.
//
// Triggered here: switch-back SANDBOX-BLOCKED (a tracked file the switch rewrites is read-only),
// switch-back STOPPED PARTWAY (a failing post-checkout hook makes `git switch` exit non-zero after
// HEAD moved), switch-back "could not compare HEAD with" (a dangling origin/HEAD), merge
// SANDBOX-BLOCKED (git cannot create a file in a read-only directory of the main checkout), and the
// epic report's "already on / beyond / on <def> (origin/HEAD)" messages.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { checkReportCommit, type GitRunner } from "../../src/core/landing-guards.js";
import { defaultish } from "./fixtures/configs.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

const SESSION_A = "sess-qca-111";
const SESSION_B = "sess-qcb-222";

// A file mode only refuses writes to a non-root process; root ignores it, so those cases are skipped.
const runningAsRoot = typeof process.getuid === "function" && process.getuid() === 0;
const itNonRoot = runningAsRoot ? it.skip : it;

let tmp: string;
let home: string;
let restore: Array<() => void> = [];

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-182qa2-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home);
  restore = [];
});

afterEach(() => {
  // Put back any mode a test took away, so the tmp tree can be removed.
  for (const r of restore) r();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
    env: pinnedEnv(home, IDENTITY),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** `git` that reports failure instead of throwing: the real runner the core guards take. */
const realGit: GitRunner = (cwd, args) => {
  try {
    return { ok: true, out: git(cwd, ...args) };
  } catch (err) {
    return { ok: false, out: String((err as { stderr?: unknown }).stderr ?? "") };
  }
};

function cli(root: string, args: string[], sessionId?: string) {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-task-status.cjs"), ...args], {
    encoding: "utf8",
    env: pinnedEnv(home, {
      ...IDENTITY,
      CLAUDE_PROJECT_DIR: root,
      ...(sessionId ? { CLAUDE_CODE_SESSION_ID: sessionId } : {}),
    }),
  });
  return { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

const tasksDir = (root: string) => path.join(root, ".claude", "maestro-tasks");
const branches = (root: string) => git(root, "branch", "--format=%(refname:short)").split("\n").filter(Boolean);
const current = (root: string) => git(root, "rev-parse", "--abbrev-ref", "HEAD");
const lineWith = (out: string, needle: string) => out.split("\n").find((l) => l.includes(needle)) ?? "";

/** A committed repo on main with the install, two tasks, and NO origin/HEAD. */
async function project(): Promise<string> {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeConfig(root, defaultish);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  fs.writeFileSync(path.join(root, "app.txt"), "main\n");
  fs.mkdirSync(tasksDir(root), { recursive: true });
  for (const [file, title] of [
    ["001-a.md", "A"],
    ["002-b.md", "B"],
  ] as const)
    fs.writeFileSync(path.join(tasksDir(root), file), `# ${title}\n\n## Blocked by\n\nNone\n`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

/** `project()` with a bare remote whose default is main, plus a `dev` branch one commit ahead. */
async function projectWithRemote(): Promise<string> {
  const root = await project();
  const remote = path.join(tmp, "remote.git");
  git(tmp, "init", "-q", "--bare", "-b", "main", remote);
  git(root, "remote", "add", "origin", remote);
  git(root, "push", "-q", "origin", "main");
  git(root, "switch", "-q", "-c", "dev");
  fs.writeFileSync(path.join(root, "dev.txt"), "dev\n");
  git(root, "add", "dev.txt");
  git(root, "commit", "-q", "-m", "dev work");
  git(root, "push", "-q", "origin", "dev");
  git(root, "switch", "-q", "main");
  return root;
}

function liveSession(root: string, id: string) {
  const dir = path.join(root, ".claude", "maestro_sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "log.jsonl"), '{"kind":"tool_call"}\n');
}

function commitFile(root: string, rel: string, text: string, message: string) {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), text);
  git(root, "add", rel);
  git(root, "commit", "-q", "-m", message);
}

function workBranch(root: string, name: string, from: string): void {
  git(root, "switch", "-q", "-c", name, from);
  fs.writeFileSync(path.join(root, `${name}.txt`), `${name}\n`);
  git(root, "add", `${name}.txt`);
  git(root, "commit", "-q", "-m", `work on ${name}`);
}

// ── switch-back: SANDBOX-BLOCKED ────────────────────────────────────────────

/**
 * origin/HEAD = dev. `locked.txt` is tracked on main ("main") and on dev ("dev"), so a switch from a
 * branch carrying the main copy to dev rewrites it. The feature branch is cut from main, so it holds
 * the main copy and is clean.
 */
async function lockedSwitchFixture(): Promise<string> {
  const root = await projectWithRemote();
  commitFile(root, "locked.txt", "main\n", "main locked");
  git(root, "switch", "-q", "dev");
  git(root, "merge", "-q", "--no-edit", "main");
  commitFile(root, "locked.txt", "dev\n", "dev locked");
  git(root, "push", "-q", "origin", "dev");
  git(root, "switch", "-q", "main");
  git(root, "remote", "set-head", "origin", "dev");
  git(root, "switch", "-q", "-c", "feature", "main");
  return root;
}

describe("switch-back SANDBOX-BLOCKED (182 QA round 2)", () => {
  itNonRoot(
    "refuses, changes nothing, and prints the user's ! command when a rewritten path is read-only",
    async () => {
      const root = await lockedSwitchFixture();
      const locked = path.join(root, "locked.txt");
      fs.chmodSync(locked, 0o444);
      restore.push(() => fs.chmodSync(locked, 0o644));

      const r = cli(root, ["switch-back"]);

      expect(r.code).toBe(1);
      expect(r.out).toContain("switch-back SANDBOX-BLOCKED");
      expect(lineWith(r.out, "switch-back SANDBOX-BLOCKED")).toContain("(origin/HEAD)");
      expect(r.out).toContain("Do NOT retry");
      expect(r.out).toContain("! git -C");
      expect(current(root)).toBe("feature");
      expect(fs.readFileSync(locked, "utf8")).toBe("main\n");
    }
  );

  // Negative control: the same switch goes through once the file is writable, so the refusal above
  // is the read-only file, not some other rule.
  it("the same switch succeeds to dev once the rewritten file is writable (negative control)", async () => {
    const root = await lockedSwitchFixture();

    const r = cli(root, ["switch-back"]);

    expect(r.code).toBe(0);
    expect(r.out).toContain("switched the main checkout");
    expect(lineWith(r.out, "switched the main checkout")).toContain("(origin/HEAD)");
    expect(current(root)).toBe("dev");
  });
});

// ── switch-back: STOPPED PARTWAY ────────────────────────────────────────────

describe("switch-back STOPPED PARTWAY (182 QA round 2)", () => {
  it("says it stopped partway, with origin/HEAD provenance, when git switch exits non-zero after HEAD moved", async () => {
    const root = await projectWithRemote();
    git(root, "remote", "set-head", "origin", "dev");
    git(root, "switch", "-q", "-c", "feature");
    // A post-checkout hook's exit status becomes `git switch`'s exit status, and it runs after HEAD and
    // the working tree have already moved to dev. That is the failure "STOPPED PARTWAY" describes.
    const hook = path.join(root, ".git", "hooks", "post-checkout");
    fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n");
    fs.chmodSync(hook, 0o755);

    const r = cli(root, ["switch-back"]);

    expect(r.code).toBe(1);
    expect(r.out).toContain("switch-back STOPPED PARTWAY");
    expect(lineWith(r.out, "switch-back STOPPED PARTWAY")).toContain("(origin/HEAD)");
    expect(r.out).not.toContain("switch-back FAILED");
    // HEAD really did move: the message's "HEAD is now dev" is a fact, not a guess.
    expect(current(root)).toBe("dev");
  });
});

// ── switch-back: could not compare ──────────────────────────────────────────

describe("switch-back could not compare (182 QA round 2)", () => {
  it("says it could not compare HEAD with a dangling origin/HEAD target, and changes nothing", async () => {
    const root = await projectWithRemote();
    // origin/HEAD names a branch the clone never fetched: the symbolic ref is written, the target is not.
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/ghost");

    const r = cli(root, ["switch-back"]);

    expect(r.code).toBe(1);
    expect(r.out).toContain("could not compare HEAD with ghost (origin/HEAD)");
    expect(current(root)).toBe("main");
    expect(branches(root)).toContain("dev");
  });
});

// ── merge: SANDBOX-BLOCKED ──────────────────────────────────────────────────

/**
 * origin/HEAD = main. A task branch adds `locked/new.txt`; main has a tracked `locked/` directory,
 * which the test then makes read-only. The merge must create a file inside it.
 */
async function lockedDirFixture(): Promise<{ root: string; locked: string }> {
  const root = await projectWithRemote();
  git(root, "remote", "set-head", "origin", "main");
  commitFile(root, "locked/keep.txt", "k\n", "locked dir");
  git(root, "switch", "-q", "-c", "task-001", "main");
  commitFile(root, "locked/new.txt", "t\n", "task adds a file in locked");
  git(root, "switch", "-q", "main");
  expect(cli(root, ["done", "001-a.md"]).code).toBe(0);
  return { root, locked: path.join(root, "locked") };
}

describe("merge SANDBOX-BLOCKED (182 QA round 2)", () => {
  itNonRoot(
    "refuses, rolls the merge back, and names the ! command when git cannot write into the main checkout",
    async () => {
      const { root, locked } = await lockedDirFixture();
      const head = git(root, "rev-parse", "HEAD");
      fs.chmodSync(locked, 0o555);
      restore.push(() => fs.chmodSync(locked, 0o755));

      const r = cli(root, ["merge", "001-a.md"]);

      expect(r.code).toBe(1);
      expect(r.out).toContain("merge SANDBOX-BLOCKED");
      expect(r.out).toContain("Do NOT retry");
      expect(r.out).toContain("! CLAUDE_PROJECT_DIR=");
      expect(git(root, "rev-parse", "HEAD")).toBe(head);
      expect(realGit(root, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).ok).toBe(false);
      expect(fs.existsSync(path.join(locked, "new.txt"))).toBe(false);
    }
  );

  // Negative control: the same merge lands once the directory is writable.
  it("the same merge lands into main with origin/HEAD provenance once the directory is writable (negative control)", async () => {
    const { root } = await lockedDirFixture();

    const r = cli(root, ["merge", "001-a.md"]);

    expect(r.code).toBe(0);
    expect(lineWith(r.out, "merged task-001")).toContain("(origin/HEAD)");
    expect(fs.existsSync(path.join(root, "locked", "new.txt"))).toBe(true);
  });
});

// ── epic report check: already on / beyond / on <def> (origin/HEAD) ─────────

describe("epic report commit check names the default branch with origin/HEAD (182 QA round 2)", () => {
  it("refuses a commit that is already on the default branch, and says so with origin/HEAD", async () => {
    const root = await projectWithRemote();
    git(root, "remote", "set-head", "origin", "main");
    workBranch(root, "task-001", "main");
    git(root, "switch", "-q", "main");
    const base = git(root, "rev-parse", "main");

    const v = checkReportCommit(realGit, root, {
      task: "001-a.md",
      body: `Outcome: done\nCommit: ${base}\n`,
      trackerDone: false,
    });

    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.message).toContain("already on main (origin/HEAD)");
      expect(v.missing).toBe("not-on-branch");
    }
  });

  it("refuses a branch-less or empty task whose named commit is only on the default branch, with origin/HEAD", async () => {
    const root = await projectWithRemote();
    git(root, "remote", "set-head", "origin", "main");
    git(root, "branch", "task-001", "main");
    const base = git(root, "rev-parse", "main");

    const v = checkReportCommit(realGit, root, {
      task: "001-a.md",
      body: `Outcome: done\nCommit: ${base}\n`,
      trackerDone: false,
    });

    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.message).toContain("beyond main (origin/HEAD)");
      expect(v.message).toContain("on main (origin/HEAD; it could be the commit the task started from)");
    }
  });

  // Negative control: a commit on the task branch's own work is accepted, with nothing refused.
  it("accepts a done report that names the task branch's own commit (negative control)", async () => {
    const root = await projectWithRemote();
    git(root, "remote", "set-head", "origin", "main");
    workBranch(root, "task-001", "main");
    const own = git(root, "rev-parse", "task-001");
    git(root, "switch", "-q", "main");

    const v = checkReportCommit(realGit, root, {
      task: "001-a.md",
      body: `Outcome: done\nCommit: ${own}\n`,
      trackerDone: false,
    });

    expect(v).toEqual({ ok: true, checked: true, sha: own, on: "task-001" });
  });

  // Known gap, pinned as it is today: with origin/HEAD unset, the report check still refuses a commit
  // that names no task branch, but its message says "no default branch to look on" and does not give
  // the set-head command. Not a landing step in the ticket's list, so it is recorded, not failed.
  it("with origin/HEAD unset and no task branch, the report check refuses (wording gap recorded)", async () => {
    const root = await project();
    const base = git(root, "rev-parse", "main");

    const v = checkReportCommit(realGit, root, {
      task: "001-a.md",
      body: `Outcome: done\nCommit: ${base}\n`,
      trackerDone: false,
    });

    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).toContain("no default branch to look on");
  });
});

// ── the messages above must not name main or master as a fallback ───────────

describe("no fallback to main when origin/HEAD is dangling (182 QA round 2)", () => {
  it("merge names the dangling target with origin/HEAD and does not merge into main", async () => {
    const root = await projectWithRemote();
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/ghost");
    workBranch(root, "task-001", "main");
    git(root, "switch", "-q", "main");
    expect(cli(root, ["done", "001-a.md"]).code).toBe(0);
    const head = git(root, "rev-parse", "HEAD");

    const r = cli(root, ["merge", "001-a.md"]);

    expect(r.code).toBe(1);
    expect(r.out).toContain("(origin/HEAD)");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(current(root)).toBe("main");
  });

  it("the report check does not treat main as the default when origin/HEAD dangles", async () => {
    const root = await projectWithRemote();
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/ghost");
    const base = git(root, "rev-parse", "main");
    const dir = path.join(root, ".claude", "maestro-tasks");
    expect(fs.existsSync(dir)).toBe(true);
    liveSession(root, SESSION_A);
    liveSession(root, SESSION_B);

    const v = checkReportCommit(realGit, root, {
      task: "001-a.md",
      body: `Outcome: done\nCommit: ${base}\n`,
      trackerDone: false,
    });

    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).not.toContain("already on main");
  });
});
