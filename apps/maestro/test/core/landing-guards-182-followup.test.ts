// Follow-up to `182`: the epic report check's no-task-branch refusal names the origin/HEAD fix when
// the default branch is null. Real git repositories under os.tmpdir() and the REAL installed
// `maestro-epic.cjs` spawned as a node process. Nothing is mocked. HOME is pinned and
// CLAUDE_CODE_SESSION_ID is deleted per spawn (pinnedEnv), per test-maestro's hook-script rule.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { checkReportCommit, type GitRunner } from "../../src/core/landing-guards.js";
import { worktreeBranchFor } from "../../src/core/worktree.js";
import { defaultish } from "./fixtures/configs.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

let tmp: string;
let home: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-182-followup-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home);
});

afterEach(() => {
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

/** The real runner the core guards take: reports failure instead of throwing. */
const realGit: GitRunner = (cwd, args) => {
  try {
    return { ok: true, out: git(cwd, ...args) };
  } catch (err) {
    return { ok: false, out: String((err as { stderr?: unknown }).stderr ?? "") };
  }
};

const tasksDir = (root: string) => path.join(root, ".claude", "maestro-tasks");

function run(root: string, script: string, args: string[], input = "") {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", script), ...args], {
    encoding: "utf8",
    input,
    env: pinnedEnv(home, { ...IDENTITY, CLAUDE_PROJECT_DIR: root }),
  });
  return { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

/** Local `main` with the installed runtime, a numbered task, a numberless one, and NO origin/HEAD. */
async function repo(opts: { epic?: boolean } = {}): Promise<string> {
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
  fs.writeFileSync(path.join(tasksDir(root), "001-a.md"), "# A\n\n## Blocked by\n\nNone\n");
  fs.writeFileSync(path.join(tasksDir(root), "notes.md"), "# Notes\n\n## Blocked by\n\nNone\n");
  if (opts.epic) {
    expect(run(root, "maestro-epic.cjs", ["create", "e1"]).code).toBe(0);
    expect(run(root, "maestro-epic.cjs", ["link", "e1", "001-a.md"]).code).toBe(0);
  }
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

/** A commit on a fresh branch `name` cut from main, then back on main. Returns its full SHA. */
function workBranch(root: string, name: string): string {
  git(root, "switch", "-q", "-c", name);
  fs.writeFileSync(path.join(root, `${name}.txt`), `${name}\n`);
  git(root, "add", `${name}.txt`);
  git(root, "commit", "-q", "-m", `work on ${name}`);
  const sha = git(root, "rev-parse", "HEAD");
  git(root, "switch", "-q", "main");
  return sha;
}

const SET_HEAD_FIX = ["git remote set-head origin --auto", "git remote set-head origin <branch>"];

function report(root: string, task: string, sha: string) {
  return checkReportCommit(realGit, root, {
    task,
    body: `Outcome: done\nCommit: ${sha}\n`,
    trackerDone: false,
  });
}

// ── the new refusal: origin/HEAD unset, no task branch ──────────────────────

describe("no task branch and origin/HEAD unset (182 follow-up)", () => {
  it("refuses with the new wording and both set-head commands, with a local main present", async () => {
    const root = await repo();
    expect(git(root, "rev-parse", "--verify", "--quiet", "refs/heads/main")).not.toBe("");
    const base = git(root, "rev-parse", "main");

    const v = report(root, "001-a.md", base);

    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.missing).toBe("not-on-branch");
    expect(v.message).toContain(
      `there is no task branch task-001 and no default branch to look on: origin/HEAD is not set in ${root}`
    );
    for (const cmd of SET_HEAD_FIX) expect(v.message).toContain(cmd);
    expect(v.message).not.toContain("already on");
    expect(v.message).not.toContain("beyond");
  });

  it("a task with no number gets the '(the task has no number)' label in the same refusal", async () => {
    const root = await repo();
    expect(worktreeBranchFor("notes.md")).toBeNull();
    const base = git(root, "rev-parse", "main");

    const v = report(root, "notes.md", base);

    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).toContain(
      "there is no task branch (the task has no number) and no default branch to look on: origin/HEAD is not set"
    );
    for (const cmd of SET_HEAD_FIX) expect(v.message).toContain(cmd);
  });

  it("does not fall back to main: a commit on local main is refused, never accepted as the task's", async () => {
    const root = await repo();
    const base = git(root, "rev-parse", "main");
    expect(report(root, "001-a.md", base).ok).toBe(false);
  });

  // Measured: `git symbolic-ref` still prints the name of a DANGLING symref, so defaultBranch returns
  // "ghost", not null. The new null-path wording is therefore NOT reached for a dangling origin/HEAD;
  // the 182 design names the dangling target instead. Pinned as it is today (refused, names ghost,
  // never main), and reported to the caller as a mismatch with the brief's "unset or dangling".
  it("a DANGLING origin/HEAD is refused naming the dangling target, never main (current behaviour)", async () => {
    const root = await repo();
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/ghost");
    const base = git(root, "rev-parse", "main");

    const v = report(root, "001-a.md", base);

    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).toContain("on ghost (origin/HEAD; it could be the commit the task started from)");
    expect(v.message).not.toContain("origin/HEAD is not set");
    expect(v.message).not.toContain("on main");
  });
});

// ── the unchanged set case: origin/HEAD=main keeps its (origin/HEAD) messages ─

describe("origin/HEAD set to main is unchanged (182 follow-up)", () => {
  it("no task branch: names main (origin/HEAD) and never the set-head fix", async () => {
    const root = await repo();
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    const base = git(root, "rev-parse", "main");

    const v = report(root, "001-a.md", base);

    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).toContain("there is no task branch task-001");
    expect(v.message).toContain("on main (origin/HEAD; it could be the commit the task started from)");
    expect(v.message).not.toContain("origin/HEAD is not set");
    expect(v.message).not.toContain("set-head");
  });

  it("'already on main (origin/HEAD)' when the named commit is on main and the branch has no own commits beyond it", async () => {
    const root = await repo();
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    workBranch(root, "task-001");
    // The task branch holds its own commit, so the base commit (on main only) is what it started from.
    const base = git(root, "rev-parse", "main");
    const v = report(root, "001-a.md", base);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).toContain("already on main (origin/HEAD)");
  });

  it("'beyond main (origin/HEAD)' when the task branch is empty", async () => {
    const root = await repo();
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    git(root, "branch", "task-001", "main");
    const base = git(root, "rev-parse", "main");
    const v = report(root, "001-a.md", base);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.message).toContain("beyond main (origin/HEAD)");
  });

  it("negative control: the task branch's own commit is accepted", async () => {
    const root = await repo();
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    const own = workBranch(root, "task-001");
    expect(report(root, "001-a.md", own)).toEqual({ ok: true, checked: true, sha: own, on: "task-001" });
  });
});

// ── origin/HEAD unset with a task branch: every report is refused with the set-head fix ─
// With def === null, ownCommits is false, so neither an empty branch's base commit nor a branch's
// own commit can be accepted: nothing measures "beyond" without a default branch.

describe("origin/HEAD unset with an empty task branch cut from main", () => {
  it("refuses a report that names main's own commit (the base is not the task's work)", async () => {
    const root = await repo();
    // An empty branch created from main. Nothing is the task's own work yet.
    git(root, "branch", "task-001", "main");
    const base = git(root, "rev-parse", "main");

    const v = report(root, "001-a.md", base);

    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.missing).toBe("not-on-branch");
    for (const cmd of SET_HEAD_FIX) expect(v.message).toContain(cmd);
  });

  it("an empty task branch that exists gets the 'exists, but no default branch' wording, not 'no task branch'", async () => {
    const root = await repo();
    git(root, "branch", "task-001", "main");
    const base = git(root, "rev-parse", "main");

    const v = report(root, "001-a.md", base);

    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.missing).toBe("not-on-branch");
    expect(v.message).toContain(
      `the task branch task-001 exists, but there is no default branch to measure it against: origin/HEAD is not set in ${root}`
    );
    for (const cmd of SET_HEAD_FIX) expect(v.message).toContain(cmd);
    expect(v.message).not.toContain("there is no task branch task-001");
    expect(v.message).not.toContain("on main");
  });
});

describe("origin/HEAD unset with a task branch that has its own commits (182 follow-up)", () => {
  it("refuses the branch's own commit with the set-head fix, never accepts it", async () => {
    const root = await repo();
    const own = workBranch(root, "task-001");

    const v = report(root, "001-a.md", own);

    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.missing).toBe("not-on-branch");
    for (const cmd of SET_HEAD_FIX) expect(v.message).toContain(cmd);
  });

  it("refuses the base commit of a branch that has commits, never main's", async () => {
    const root = await repo();
    workBranch(root, "task-001");
    const base = git(root, "rev-parse", "main");

    const v = report(root, "001-a.md", base);

    expect(v.ok).toBe(false);
    if (v.ok) return;
    for (const cmd of SET_HEAD_FIX) expect(v.message).toContain(cmd);
  });

  // Defect probe (wording). The branch task-001 EXISTS here, but the null-default refusal reads
  // "there is no task branch task-001", which tells the user the branch is missing. It should not
  // claim absence of a branch that is there.
  it("does not claim the task branch is missing when it exists", async () => {
    const root = await repo();
    const own = workBranch(root, "task-001");

    const v = report(root, "001-a.md", own);

    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.message).not.toContain("there is no task branch task-001");
  });
});

describe("the suggested set-head fix, run for real against a remote (182 follow-up)", () => {
  it("after git remote set-head origin --auto, a real task commit is accepted and main's base is refused", async () => {
    const root = await repo();
    const bare = path.join(tmp, "remote.git");
    fs.mkdirSync(bare);
    git(bare, "init", "-q", "--bare");
    git(bare, "symbolic-ref", "HEAD", "refs/heads/main");
    git(root, "remote", "add", "origin", bare);
    git(root, "push", "-q", "origin", "main");
    git(root, "fetch", "-q", "origin");
    git(root, "remote", "set-head", "origin", "--auto");
    expect(git(root, "symbolic-ref", "refs/remotes/origin/HEAD")).toBe("refs/remotes/origin/main");

    const own = workBranch(root, "task-001");
    const base = git(root, "rev-parse", "main");

    expect(report(root, "001-a.md", own)).toEqual({ ok: true, checked: true, sha: own, on: "task-001" });
    const refused = report(root, "001-a.md", base);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.message).not.toContain("origin/HEAD is not set");
  });
});

// ── end to end through the bundled CLI ──────────────────────────────────────

describe("maestro-epic.cjs report, end to end (182 follow-up)", () => {
  it("origin/HEAD unset: the CLI refuses with the set-head fix and writes no report", async () => {
    const root = await repo({ epic: true });
    const base = git(root, "rev-parse", "main");

    const r = run(root, "maestro-epic.cjs", ["report", "--task", "001-a.md"], `Outcome: done\nCommit: ${base}\n`);

    expect(r.code).not.toBe(0);
    expect(r.out).toContain("there is no task branch task-001 and no default branch to look on");
    for (const cmd of SET_HEAD_FIX) expect(r.out).toContain(cmd);
    expect(r.out).not.toContain("Maestro epic: report r");
  });

  it("origin/HEAD unset with the task branch's own commit: the CLI refuses with the set-head fix and writes no report", async () => {
    const root = await repo({ epic: true });
    const own = workBranch(root, "task-001");

    const r = run(root, "maestro-epic.cjs", ["report", "--task", "001-a.md"], `Outcome: done\nCommit: ${own}\n`);

    expect(r.code).not.toBe(0);
    for (const cmd of SET_HEAD_FIX) expect(r.out).toContain(cmd);
    expect(r.out).not.toContain("Maestro epic: report r");
  });

  it("origin/HEAD unset, task branch exists: the CLI stdout names the branch as existing, with the set-head fix", async () => {
    const root = await repo({ epic: true });
    const own = workBranch(root, "task-001");

    const r = run(root, "maestro-epic.cjs", ["report", "--task", "001-a.md"], `Outcome: done\nCommit: ${own}\n`);

    expect(r.code).not.toBe(0);
    expect(r.out).toContain(
      `the task branch task-001 exists, but there is no default branch to measure it against: origin/HEAD is not set in ${root}`
    );
    expect(r.out).not.toContain("there is no task branch task-001");
    for (const cmd of SET_HEAD_FIX) expect(r.out).toContain(cmd);
  });

  it("origin/HEAD=main: the CLI refuses with the (origin/HEAD) message, not the set-head fix", async () => {
    const root = await repo({ epic: true });
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    const base = git(root, "rev-parse", "main");

    const r = run(root, "maestro-epic.cjs", ["report", "--task", "001-a.md"], `Outcome: done\nCommit: ${base}\n`);

    expect(r.code).not.toBe(0);
    expect(r.out).toContain("(origin/HEAD; it could be the commit the task started from)");
    expect(r.out).not.toContain("set-head");
  });

  it("origin/HEAD=main: the CLI accepts a report that names the task branch's own commit", async () => {
    const root = await repo({ epic: true });
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    const own = workBranch(root, "task-001");

    const r = run(root, "maestro-epic.cjs", ["report", "--task", "001-a.md"], `Outcome: done\nCommit: ${own}\n`);

    expect(r.code).toBe(0);
    expect(r.out).toContain("written to");
  });
});
