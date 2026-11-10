// `173` through the REAL installed `maestro-task-status.cjs merge`: real git repositories and real
// spawned node processes under os.tmpdir(); nothing mocked. HOME is pinned to a temp dir and
// CLAUDE_CODE_SESSION_ID is deleted (never inherited), as in landing-guards-170.test.ts.
//
//   * A task committed on its branch in the MAIN checkout lands after switch-back with no manual
//     step: the branch's tracker counts as done, and the task tracker is merged by Maestro itself
//     when both sides changed it (a local change or a conflict).
//   * Any other locally modified file the merge would overwrite makes it refuse first, naming each
//     file, whether it matches the branch's copy, and the resolving command. Nothing is discarded.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";
import { pinnedEnv } from "../helpers/env.js";
import { mergeTaskTrackers, parseOverwriteError } from "../../src/core/landing-guards.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

let tmp: string;
let home: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-173-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home);
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@t",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@t",
};

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf8",
    env: pinnedEnv(home, GIT_IDENTITY),
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function run(root: string, script: string, args: string[]) {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", script), ...args], {
    encoding: "utf8",
    env: pinnedEnv(home, { ...GIT_IDENTITY, CLAUDE_PROJECT_DIR: root }),
  });
  return { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

const status = (root: string, ...args: string[]) => run(root, "maestro-task-status.cjs", args);
const trackerPath = (root: string) => path.join(root, ".claude", "maestro-tasks", "status.json");
const tracker = (root: string) =>
  JSON.parse(fs.readFileSync(trackerPath(root), "utf8")) as Record<string, { status: string; unmerged?: boolean }>;
const branches = (root: string) => git(root, "branch", "--format=%(refname:short)").split("\n").filter(Boolean);

/**
 * The installed repo with tasks 001 and 002 in epic `e1`, everything committed on main. `nested`
 * puts the Maestro project one directory below the git top level (a repository holding a project).
 */
async function project(layout: "top" | "nested" = "top"): Promise<string> {
  const repo = path.join(tmp, layout === "nested" ? "outer" : "repo");
  const root = layout === "nested" ? path.join(repo, "sub") : repo;
  fs.mkdirSync(root, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  writeConfig(root, defaultish);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  fs.writeFileSync(path.join(root, "app.txt"), "main\n");
  const dir = path.join(root, ".claude", "maestro-tasks");
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, title] of [
    ["001-a.md", "A"],
    ["002-b.md", "B"],
  ] as const) {
    fs.writeFileSync(path.join(dir, file), `# ${title}\n\n## Blocked by\n\nNone\n`);
  }
  expect(run(root, "maestro-epic.cjs", ["create", "e1"]).code).toBe(0);
  expect(run(root, "maestro-epic.cjs", ["link", "e1", "001-a.md", "002-b.md"]).code).toBe(0);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  return root;
}

/**
 * Task 001 worked IN the main checkout: branch task-001, `files` written, the task marked done
 * there (the branch's tracker), everything committed on the branch, then `switch-back` to main.
 */
function workedInMainCheckout(root: string, files: Record<string, string> = { "a.txt": "a\n" }) {
  git(root, "switch", "-q", "-c", "task-001");
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  expect(status(root, "done", "001-a.md").code).toBe(0);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "A (task 001)");
  const back = status(root, "switch-back");
  expect(back.code, back.out).toBe(0);
  expect(git(root, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
}

describe("merge lands a task committed in the main checkout (173)", () => {
  it("merges after switch-back with no manual step: the branch's tracker says done", async () => {
    const root = await project();
    workedInMainCheckout(root);
    expect(tracker(root)["001-a.md"]?.status).not.toBe("done"); // main's tracker has not seen it

    const r = status(root, "merge", "001-a.md");

    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("merged task-001 into main");
    expect(tracker(root)["001-a.md"]?.status).toBe("done");
    expect(tracker(root)["001-a.md"]?.unmerged).toBeUndefined();
    expect(fs.readFileSync(path.join(root, "a.txt"), "utf8")).toBe("a\n");
    expect(branches(root)).not.toContain("task-001");
  });

  it("still merges when the user also marked it done on main (the local tracker change git refused)", async () => {
    const root = await project();
    workedInMainCheckout(root);
    expect(status(root, "done", "001-a.md").code).toBe(0);
    expect(git(root, "status", "--porcelain")).toContain(".claude/maestro-tasks/status.json");

    const r = status(root, "merge", "001-a.md");

    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toContain("would be overwritten");
    expect(tracker(root)["001-a.md"]?.status).toBe("done");
    expect(git(root, "log", "-1", "--format=%P").split(" ")).toHaveLength(2);
  });

  it("keeps the main checkout's own uncommitted tracker changes on top of the merged tracker", async () => {
    const root = await project();
    workedInMainCheckout(root);
    expect(status(root, "done", "002-b.md").code).toBe(0); // another task finished on main meanwhile

    const r = status(root, "merge", "001-a.md");

    expect(r.code, r.out).toBe(0);
    const map = tracker(root);
    expect(map["001-a.md"]?.status).toBe("done");
    expect(map["002-b.md"]?.status).toBe("done");
    // 002's change is still the main checkout's own, uncommitted: nothing was discarded or committed.
    expect(git(root, "diff", "--name-only")).toContain(".claude/maestro-tasks/status.json");
    expect(git(root, "show", "HEAD:.claude/maestro-tasks/status.json")).not.toMatch(
      /"002-b\.md": \{\s*"status": "done"/
    );
    // No backup is left behind in the git directory.
    expect(fs.existsSync(path.join(root, ".git", "maestro-tracker-before-merge.json"))).toBe(false);
  });

  it("resolves a conflict in the tracker alone by merging it task by task, and completes the merge", async () => {
    const root = await project();
    workedInMainCheckout(root);
    // main committed a change to the SAME tracker entry after the branch forked: a textual conflict.
    const map = tracker(root);
    map["001-a.md"] = { ...map["001-a.md"], status: "blocked" } as { status: string };
    fs.writeFileSync(trackerPath(root), `${JSON.stringify(map, null, 2)}\n`);
    git(root, "commit", "-q", "-am", "tracker moved on");

    const r = status(root, "merge", "001-a.md");

    expect(r.code, r.out).toBe(0);
    expect(r.out).not.toContain("CONFLICT");
    expect(tracker(root)["001-a.md"]?.status).toBe("done");
    expect(git(root, "log", "-1", "--format=%P").split(" ")).toHaveLength(2);
    expect(fs.existsSync(path.join(root, ".git", "MERGE_HEAD"))).toBe(false);
  });

  it("still refuses a task whose tracker says not done on both main and the branch", async () => {
    const root = await project();
    git(root, "switch", "-q", "-c", "task-001");
    fs.writeFileSync(path.join(root, "a.txt"), "a\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "wip");
    git(root, "switch", "-q", "main");

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain('not "done"');
    expect(branches(root)).toContain("task-001");
  });

  /**
   * Task 003 created AND committed on its own branch: main has neither its file nor a tracker entry
   * for it, so only the branch's tracker knows it is done.
   */
  function createdOnBranch(root: string) {
    git(root, "switch", "-q", "-c", "task-003");
    const dir = path.join(root, ".claude", "maestro-tasks");
    fs.writeFileSync(path.join(dir, "003-c.md"), "# C\n\n## Blocked by\n\nNone\n");
    fs.writeFileSync(path.join(root, "c.txt"), "c\n");
    expect(status(root, "done", "003-c.md").code).toBe(0);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "C (task 003)");
    const back = status(root, "switch-back");
    expect(back.code, back.out).toBe(0);
    expect(fs.existsSync(path.join(dir, "003-c.md"))).toBe(false);
    expect(tracker(root)["003-c.md"]).toBeUndefined();
  }

  for (const arg of ["003-c.md", "003"]) {
    it(`lands a task created on its own branch, unknown to main, named as "${arg}"`, async () => {
      const root = await project();
      createdOnBranch(root);

      const r = status(root, "merge", arg);

      expect(r.code, r.out).toBe(0);
      expect(r.out).toContain("merged task-003 into main");
      expect(tracker(root)["003-c.md"]?.status).toBe("done");
      expect(fs.readFileSync(path.join(root, "c.txt"), "utf8")).toBe("c\n");
      expect(branches(root)).not.toContain("task-003");
    });
  }

  it("still refuses a task created on its own branch that is not done there", async () => {
    const root = await project();
    git(root, "switch", "-q", "-c", "task-003");
    fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", "003-c.md"), "# C\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "wip");
    git(root, "switch", "-q", "main");

    for (const arg of ["003-c.md", "003"]) {
      const r = status(root, "merge", arg);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toContain('not "done"');
    }
    expect(branches(root)).toContain("task-003");
  });
});

describe("merge lands a task across the edge cases of the tracker merge (173)", () => {
  it("lands a task when the project sits below the git top level and the tracker changed on main", async () => {
    const root = await project("nested");
    workedInMainCheckout(root);
    expect(status(root, "done", "002-b.md").code).toBe(0); // the main checkout's own tracker change

    const r = status(root, "merge", "001-a.md");

    expect(r.code, r.out).toBe(0);
    expect(tracker(root)["001-a.md"]?.status).toBe("done");
    expect(tracker(root)["002-b.md"]?.status).toBe("done");
    expect(fs.existsSync(path.join(root, ".git"))).toBe(false); // the repository is the outer directory
  });

  it("puts the main checkout's tracker back exactly as it was when the merge then aborts on another file", async () => {
    const root = await project();
    workedInMainCheckout(root, { "shared.txt": "branch\n" });
    // main creates the same file differently after the fork: an add/add conflict git cannot resolve.
    fs.writeFileSync(path.join(root, "shared.txt"), "main\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "main side");
    expect(status(root, "done", "002-b.md").code).toBe(0);
    const local = fs.readFileSync(trackerPath(root), "utf8");
    const head = git(root, "rev-parse", "HEAD");

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain("CONFLICT");
    expect(r.out).toContain("shared.txt");
    expect(fs.readFileSync(trackerPath(root), "utf8")).toBe(local);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(fs.existsSync(path.join(root, ".git", "MERGE_HEAD"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".git", "maestro-tracker-before-merge.json"))).toBe(false);
    expect(branches(root)).toContain("task-001");
  });
});

describe("merge names local changes it would overwrite (173)", () => {
  it("refuses over a modified tracked file that DIFFERS from the branch's copy, and changes nothing", async () => {
    const root = await project();
    workedInMainCheckout(root, { "app.txt": "from the branch\n" });
    fs.writeFileSync(path.join(root, "app.txt"), "regenerated locally\n");
    const head = git(root, "rev-parse", "HEAD");

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain("merge REFUSED — 1 locally modified file(s)");
    expect(r.out).toContain("would be overwritten by merging task-001");
    expect(r.out).toContain("app.txt — DIFFERENT from task-001's copy");
    expect(r.out).toContain(`git -C ${root} stash push -m 'before merging task-001' -- app.txt`);
    expect(r.out).toContain("stash pop");
    expect(fs.readFileSync(path.join(root, "app.txt"), "utf8")).toBe("regenerated locally\n");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(git(root, "stash", "list")).toBe("");
    expect(branches(root)).toContain("task-001");
  });

  it("says a modified file is identical to the branch's copy and prints the restore command", async () => {
    const root = await project();
    workedInMainCheckout(root, { "app.txt": "from the branch\n" });
    fs.writeFileSync(path.join(root, "app.txt"), "from the branch\n"); // a tool regenerated the same bytes

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain("app.txt — identical to task-001's copy");
    expect(r.out).toContain(`git -C ${root} restore --source=HEAD --staged --worktree -- app.txt`);
    expect(fs.readFileSync(path.join(root, "app.txt"), "utf8")).toBe("from the branch\n");

    // The printed command resolves it: run it, and the merge lands with the branch's content.
    git(root, "restore", "--source=HEAD", "--staged", "--worktree", "--", "app.txt");
    const again = status(root, "merge", "001-a.md");
    expect(again.code, again.out).toBe(0);
    expect(fs.readFileSync(path.join(root, "app.txt"), "utf8")).toBe("from the branch\n");
  });

  it("names a Maestro state file the merge would overwrite, though it does not make the target dirty", async () => {
    const root = await project();
    const epicMd = ".claude/epics/e1/EPIC.md";
    workedInMainCheckout(root, { [epicMd]: "# e1\n\nedited on the branch\n" });
    fs.appendFileSync(path.join(root, epicMd), "\nnote from a live manager session\n");
    const local = fs.readFileSync(path.join(root, epicMd), "utf8");

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain(`${epicMd} — DIFFERENT from task-001's copy`);
    expect(r.out).not.toContain("status.json —"); // the tracker is Maestro's to merge, never listed
    expect(fs.readFileSync(path.join(root, epicMd), "utf8")).toBe(local);

    // Following the printed stash command, the merge lands; the stash keeps the local note.
    git(root, "stash", "push", "-m", "before merging task-001", "--", epicMd);
    const again = status(root, "merge", "001-a.md");
    expect(again.code, again.out).toBe(0);
    expect(git(root, "stash", "list")).toContain("before merging task-001");
  });

  it("lists the other tracked changes the merge does not touch, without naming them as overwritten", async () => {
    const root = await project();
    fs.writeFileSync(path.join(root, "other.txt"), "base\n");
    git(root, "add", "other.txt");
    git(root, "commit", "-q", "-m", "other");
    workedInMainCheckout(root, { "app.txt": "from the branch\n" });
    fs.writeFileSync(path.join(root, "app.txt"), "local\n");
    fs.writeFileSync(path.join(root, "other.txt"), "local\n");

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain("app.txt — DIFFERENT");
    expect(r.out).not.toContain("other.txt — ");
    expect(r.out).toContain("1 other tracked change(s) the merge does not touch (e.g. other.txt)");
  });
});

describe("the printed resolving command runs as printed (173)", () => {
  it("quotes a file name with a space so the stash command the refusal prints really resolves the merge", async () => {
    const root = await project();
    fs.mkdirSync(path.join(root, "docs"));
    fs.writeFileSync(path.join(root, "docs", "my notes.md"), "main\n");
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "notes on main");
    workedInMainCheckout(root, { "docs/my notes.md": "from the branch\n" });
    fs.writeFileSync(path.join(root, "docs", "my notes.md"), "regenerated locally\n");

    const r = status(root, "merge", "001-a.md");
    expect(r.code).toBe(1);
    expect(r.out).toContain("'docs/my notes.md'");
    const cmd = /^\s+(git -C .+ stash push .+)$/m.exec(r.out)?.[1];
    expect(cmd, r.out).toBeTruthy();

    // Run exactly what was printed, through a shell, as the user would paste it.
    execFileSync("sh", ["-c", cmd as string], { cwd: root, stdio: "pipe" });

    expect(fs.readFileSync(path.join(root, "docs", "my notes.md"), "utf8")).toBe("main\n");
    expect(git(root, "stash", "list")).toContain("before merging task-001");
    const again = status(root, "merge", "001-a.md");
    expect(again.code, again.out).toBe(0);
    expect(fs.readFileSync(path.join(root, "docs", "my notes.md"), "utf8")).toBe("from the branch\n");
  });
});

describe("the tracker set aside is re-applied before the merge cleans up (173)", () => {
  it("puts the main checkout's tracker changes back even when removing the worktree fails after the merge", async () => {
    const root = await project();
    // Task 001 in its own worktree (git's own `worktree add`), marked done and committed there.
    const wt = path.join(tmp, "wt-001");
    git(root, "worktree", "add", "-q", "-b", "task-001", wt);
    fs.writeFileSync(path.join(wt, "a.txt"), "a\n");
    expect(status(wt, "done", "001-a.md").code).toBe(0);
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "A (task 001)");
    // Meanwhile another task finished in the main checkout (an uncommitted tracker change the merge
    // would overwrite, so it is set aside), and the worktree is locked: `worktree remove` fails.
    expect(status(root, "done", "002-b.md").code).toBe(0);
    git(root, "worktree", "lock", wt);

    const r = status(root, "merge", "001-a.md");

    expect(r.out).toContain("merged task-001 into main");
    expect(r.out).toContain(`could not remove worktree ${wt}`);
    const map = tracker(root);
    expect(map["001-a.md"]?.status).toBe("done");
    expect(map["002-b.md"]?.status).toBe("done");
    expect(git(root, "diff", "--name-only")).toContain(".claude/maestro-tasks/status.json");
    // Re-applied, so the backup is gone and nothing names it.
    expect(fs.existsSync(path.join(root, ".git", "maestro-tracker-before-merge.json"))).toBe(false);
    expect(r.out).not.toContain("maestro-tracker-before-merge.json");
    expect(branches(root)).toContain("task-001"); // cleanup stopped at the worktree, as it said
  });
});

describe("the exit message names the tracker backup only when it survives (173)", () => {
  it("prints no backup message and leaves no backup on a clean merge", async () => {
    const root = await project();
    workedInMainCheckout(root);
    expect(status(root, "done", "002-b.md").code).toBe(0); // a local tracker change the merge sets aside

    const r = status(root, "merge", "001-a.md");

    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("merged task-001 into main");
    expect(r.out).not.toContain("maestro-tracker-before-merge.json");
    expect(r.out).not.toContain("may not hold them");
    expect(fs.existsSync(path.join(root, ".git", "maestro-tracker-before-merge.json"))).toBe(false);
    expect(tracker(root)["001-a.md"]?.status).toBe("done");
    expect(tracker(root)["002-b.md"]?.status).toBe("done");
  });

  it("names the backup path on exit when the re-apply really throws after the merge, and keeps the local changes there", async () => {
    const root = await project();
    workedInMainCheckout(root);
    expect(status(root, "done", "002-b.md").code).toBe(0);
    const abs = trackerPath(root);
    const local = fs.readFileSync(abs, "utf8");
    const backup = path.join(root, ".git", "maestro-tracker-before-merge.json");
    // A real git post-merge hook: git runs it once the merge commit has landed and before Maestro
    // re-applies the main checkout's tracker changes. It replaces the tracker file with a directory,
    // so the re-apply's own read throws EISDIR for real. Nothing is mocked.
    fs.writeFileSync(path.join(root, ".git", "hooks", "post-merge"), `#!/bin/sh\nrm -f '${abs}' && mkdir '${abs}'\n`, {
      mode: 0o755,
    });

    const r = status(root, "merge", "001-a.md");

    expect(r.out).toContain("merged task-001 into main");
    expect(r.out).toContain("could not re-apply the main checkout's own task-tracker changes (EISDIR");
    expect(r.out).toContain(`saved in ${backup}`);
    expect(r.out).toContain("do NOT copy the backup over the tracker");
    expect(r.out).toContain("only the entries the tracker lacks or holds in an older state");
    // The backup survived the failed re-apply and holds the local changes exactly as they were.
    expect(fs.readFileSync(backup, "utf8")).toBe(local);
    expect(fs.statSync(abs).isDirectory()).toBe(true);
    // The merge itself landed, and the branch was deleted (no worktree to remove).
    expect(git(root, "log", "-1", "--format=%P").split(" ")).toHaveLength(2);
    expect(branches(root)).not.toContain("task-001");
  });
});

describe("a tracker backup left by an earlier merge is never overwritten (173)", () => {
  it("refuses the merge, changing nothing, while an earlier merge's tracker backup still exists", async () => {
    const root = await project();
    workedInMainCheckout(root);
    // An earlier merge's re-apply failed and left its backup: the only copy of those changes.
    const backup = path.join(root, ".git", "maestro-tracker-before-merge.json");
    const earlier = '{\n  "999-earlier.md": { "status": "done" }\n}\n';
    fs.writeFileSync(backup, earlier);
    // The tracker is dirty again (another task finished on main), so this merge would set it aside.
    expect(status(root, "done", "002-b.md").code).toBe(0);
    const abs = trackerPath(root);
    const trackerBefore = fs.readFileSync(abs, "utf8");
    const head = git(root, "rev-parse", "HEAD");

    const r = status(root, "merge", "001-a.md");

    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("merge REFUSED");
    expect(r.out).toContain(`a task-tracker backup from an earlier merge is still at ${backup}`);
    expect(r.out).toContain(`diff '${backup}' '${abs}'`);
    expect(r.out).toContain(`rm '${backup}'`);
    // A plain copy of the backup would undo tasks that merge marked done: the refusal forbids it.
    expect(r.out).toContain("do NOT copy the backup over the tracker");
    expect(r.out).toContain("only the entries the tracker lacks or holds in an older state");
    // Nothing touched: the backup byte for byte, the tracker, HEAD and the branch.
    expect(fs.readFileSync(backup, "utf8")).toBe(earlier);
    expect(fs.readFileSync(abs, "utf8")).toBe(trackerBefore);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(branches(root)).toContain("task-001");

    // Once the user has dealt with it and deleted it, the same merge lands.
    fs.rmSync(backup);
    const again = status(root, "merge", "001-a.md");
    expect(again.code, again.out).toBe(0);
    expect(tracker(root)["002-b.md"]?.status).toBe("done");
  });
});

describe("tracker merge and git's overwrite error (173, pure)", () => {
  it("takes each side's change to a task only it changed, and never un-does a task", () => {
    const base = { a: { status: "ready" }, b: { status: "ready" }, c: { status: "ready" } };
    const ours = { a: { status: "done" }, b: { status: "ready" }, c: { status: "ready", epic: "x" } };
    const theirs = { a: { status: "ready" }, b: { status: "done" }, c: { status: "done" }, d: { status: "ready" } };
    expect(mergeTaskTrackers(base, ours, theirs)).toEqual({
      a: { status: "done" },
      b: { status: "done" },
      c: { status: "done", epic: "x" },
      d: { status: "ready" },
    });
  });

  it("reads the file list out of git's own refusal", () => {
    const err =
      "error: Your local changes to the following files would be overwritten by merge:\n\tapp.txt\n\tsub/b.txt\nPlease commit your changes or stash them before you merge.\nAborting";
    expect(parseOverwriteError(err)).toEqual(["app.txt", "sub/b.txt"]);
    expect(parseOverwriteError("fatal: refusing to merge unrelated histories")).toEqual([]);
  });
});
