// `173`: the end-to-end sequence for a tracker backup left by a failed re-apply, through the REAL
// installed `maestro-task-status.cjs merge` and real git repositories under os.tmpdir(). Nothing is
// mocked. HOME is pinned and CLAUDE_CODE_SESSION_ID is deleted (never inherited), as in
// landing-guards-173.test.ts.
//
//   1. A merge whose tracker re-apply really fails (a git post-merge hook that turns the tracker into
//      a directory), so the merge lands and the backup of the main checkout's tracker is left behind.
//   2. A later Maestro write that dirties status.json.
//   3. A second merge, which must REFUSE before changing anything and leave the backup byte-identical.
//   4. After the user's manual diff, restore from the backup and rm it, the second merge lands.
//
// Run for a project at the git top level, a project below it (nested), and a task in its own
// worktree (the second task is merged from its worktree, which the merge then removes).

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

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

let tmp: string;
let home: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-173-backup-")));
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

type Layout = "top" | "nested" | "worktree";

/**
 * The installed repo with tasks 001 and 002 in epic `e1`, everything committed on main. `nested`
 * puts the Maestro project one directory below the git top level.
 */
async function project(nested: boolean): Promise<string> {
  const repo = path.join(tmp, nested ? "outer" : "repo");
  const root = nested ? path.join(repo, "sub") : repo;
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
 * Task 001 worked in the main checkout (branch task-001, marked done there), then switched back.
 * Task 002 committed on its own branch from the same main commit: in a worktree for `worktree`,
 * otherwise in the main checkout (then switched back). Finally the main checkout marks 002 done
 * locally, so the tracker is a local change the first merge must set aside.
 */
async function arrange(layout: Layout) {
  const root = await project(layout === "nested");
  const repo = layout === "nested" ? path.dirname(root) : root;
  const abs = trackerPath(root);
  const backup = path.join(repo, ".git", "maestro-tracker-before-merge.json");
  const wt = path.join(tmp, "wt-002");

  git(root, "switch", "-q", "-c", "task-001");
  fs.writeFileSync(path.join(root, "a.txt"), "a\n");
  expect(status(root, "done", "001-a.md").code).toBe(0);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "A (task 001)");
  expect(status(root, "switch-back").code).toBe(0);
  expect(git(root, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");

  if (layout === "worktree") {
    git(root, "worktree", "add", "-q", "-b", "task-002", wt);
    fs.writeFileSync(path.join(wt, "b.txt"), "b\n");
    expect(status(wt, "done", "002-b.md").code).toBe(0);
    git(wt, "add", "-A");
    git(wt, "commit", "-q", "-m", "B (task 002)");
  } else {
    git(root, "switch", "-q", "-c", "task-002");
    fs.writeFileSync(path.join(root, "b.txt"), "b\n");
    expect(status(root, "done", "002-b.md").code).toBe(0);
    git(root, "add", "-A");
    git(root, "commit", "-q", "-m", "B (task 002)");
    expect(status(root, "switch-back").code).toBe(0);
  }

  // A local tracker change on main: the merge of 001 must set it aside, so a backup is written.
  expect(status(root, "done", "002-b.md").code).toBe(0);
  return { root, repo, abs, backup, wt };
}

describe.each<Layout>(["top", "nested", "worktree"])(
  "a tracker backup left by a failed re-apply refuses the next merge, end to end (173, %s)",
  (layout) => {
    it("refuses the second merge byte for byte, then lands it after the manual diff, restore and rm", async () => {
      const { root, repo, abs, backup, wt } = await arrange(layout);
      const local = fs.readFileSync(abs, "utf8");
      expect(local).toContain('"002-b.md"');

      // 1. The first merge. A real post-merge hook makes the tracker a directory after the merge
      //    lands, so the re-apply's own read throws EISDIR and the backup is the only copy left.
      const hook = path.join(repo, ".git", "hooks", "post-merge");
      fs.writeFileSync(hook, `#!/bin/sh\nrm -f '${abs}' && mkdir '${abs}'\n`, { mode: 0o755 });
      const first = status(root, "merge", "001-a.md");
      expect(first.code, first.out).toBe(0);
      expect(first.out).toContain("merged task-001 into main");
      expect(first.out).toContain("could not re-apply the main checkout's own task-tracker changes (EISDIR");
      expect(first.out).toContain(`saved in ${backup}`);
      expect(first.out).toContain("do NOT copy the backup over the tracker");
      expect(first.out).toContain("only the entries the tracker lacks or holds in an older state");
      expect(fs.readFileSync(backup, "utf8")).toBe(local);
      expect(git(root, "log", "-1", "--format=%P").split(" ")).toHaveLength(2);
      const backupBytes = fs.readFileSync(backup);

      // The cause is gone: the hook is removed, the directory it made goes, and git restores the
      // tracker file from HEAD, as a user would before Maestro writes it again.
      fs.rmSync(hook);
      fs.rmSync(abs, { recursive: true, force: true });
      git(root, "restore", "--source=HEAD", "--", ".claude/maestro-tasks/status.json");
      expect(tracker(root)["001-a.md"]?.status).toBe("done");

      // 2. A later Maestro write dirties status.json.
      const later = status(root, "done", "002-b.md");
      expect(later.code, later.out).toBe(0);
      expect(git(root, "status", "--porcelain")).toContain(".claude/maestro-tasks/status.json");
      const trackerBefore = fs.readFileSync(abs, "utf8");
      const headBefore = git(root, "rev-parse", "HEAD");

      // 3. The second merge refuses before changing anything.
      const second = status(root, "merge", "002-b.md");
      expect(second.code, second.out).toBe(1);
      expect(second.out).toContain("merge REFUSED");
      expect(second.out).toContain(`a task-tracker backup from an earlier merge is still at ${backup}`);
      expect(second.out).toContain(`diff '${backup}' '${abs}'`);
      expect(second.out).toContain(`rm '${backup}'`);
      expect(second.out).toContain("do NOT copy the backup over the tracker");
      expect(second.out).toContain("only the entries the tracker lacks or holds in an older state");
      expect(fs.readFileSync(backup).equals(backupBytes)).toBe(true);
      expect(fs.readFileSync(abs, "utf8")).toBe(trackerBefore);
      expect(git(root, "rev-parse", "HEAD")).toBe(headBefore);
      expect(fs.existsSync(path.join(repo, ".git", "MERGE_HEAD"))).toBe(false);
      expect(git(root, "stash", "list")).toBe("");
      expect(branches(root)).toContain("task-002");
      if (layout === "worktree") expect(fs.existsSync(wt)).toBe(true);

      // 4. The manual diff shows the difference. Following the refusal's own steps, the user copies
      //    into the tracker each entry it lacks or holds in an older state (never a "done" entry, so the
      //    merged task stays done), then removes the backup, and the second merge then lands.
      const diff = spawnSync("diff", [backup, abs], { encoding: "utf8" });
      expect(diff.status).toBe(1);
      expect(diff.stdout).toContain('"status": "done"');
      // The printed rule, literally: copy an entry only when the tracker lacks it, or holds it in an
      // older state (here: not "done" while the backup has it "done"). A "done" entry is never copied over.
      const held = JSON.parse(backupBytes.toString("utf8")) as Record<string, { status?: string }>;
      const current = JSON.parse(fs.readFileSync(abs, "utf8")) as Record<string, { status?: string }>;
      for (const [key, value] of Object.entries(held)) {
        const mine = current[key];
        if (!mine || (mine.status !== "done" && value.status === "done")) current[key] = value;
      }
      fs.writeFileSync(abs, `${JSON.stringify(current, null, 2)}\n`);
      fs.rmSync(backup);

      const again = status(root, "merge", "002-b.md");
      expect(again.code, again.out).toBe(0);
      expect(again.out).toContain("merged task-002 into main");
      expect(again.out).not.toContain("maestro-tracker-before-merge.json");
      expect(fs.existsSync(backup)).toBe(false);
      const map = tracker(root);
      expect(map["001-a.md"]?.status).toBe("done");
      expect(map["002-b.md"]?.status).toBe("done");
      expect(git(root, "log", "-1", "--format=%P").split(" ")).toHaveLength(2);
      expect(branches(root)).not.toContain("task-002");
      if (layout === "worktree") {
        expect(fs.existsSync(wt)).toBe(false);
        expect(git(root, "worktree", "list")).not.toContain("wt-002");
      }
    });
  }
);
