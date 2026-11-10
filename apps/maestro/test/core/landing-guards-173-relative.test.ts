// `173` QA round 3: a user's `diff.relative=true` must not skew the path lists the merge and
// switch-back guards compare. With that config, `git diff --name-only` run from a subdirectory prints
// paths relative to the subdirectory and drops everything outside it; the guards pin the output with
// `-c diff.relative=false`, so the lists stay repo paths (relative to the git top level).
//
// Real git repositories and the REAL installed `maestro-task-status.cjs` under os.tmpdir(); nothing
// mocked. HOME is pinned to a temp dir and CLAUDE_CODE_SESSION_ID is deleted (never inherited), as in
// landing-guards-173.test.ts. The flat layout is the control: the project is the top level, so the
// config cannot skew anything there.

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
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-173-rel-")));
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
const branches = (root: string) => git(root, "branch", "--format=%(refname:short)").split("\n").filter(Boolean);
const epicDir = (root: string) => path.join(root, ".claude", "epics", "e1");

/**
 * The installed project with tasks 001 and 002 in epic `e1`, everything committed on main, and
 * `diff.relative=true` set in the repository's own config. `nested` puts the project one directory
 * below the git top level (`<tmp>/outer/sub`); flat makes the project the top level (`<tmp>/repo`).
 */
async function project(layout: "top" | "nested"): Promise<{ repo: string; root: string }> {
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
  for (const file of ["001-a.md", "002-b.md"]) {
    fs.writeFileSync(path.join(dir, file), `# ${file}\n\n## Blocked by\n\nNone\n`);
  }
  expect(run(root, "maestro-epic.cjs", ["create", "e1"]).code).toBe(0);
  expect(run(root, "maestro-epic.cjs", ["link", "e1", "001-a.md", "002-b.md"]).code).toBe(0);
  expect(run(root, "maestro-task-status.cjs", ["sync"]).code).toBe(0);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  git(repo, "config", "diff.relative", "true");
  return { repo, root };
}

/** Task 001 worked in the main checkout: branch task-001 with `files`, marked done, committed, switched back. */
function workedInMainCheckout(repo: string, root: string, files: Record<string, string>) {
  git(repo, "switch", "-q", "-c", "task-001");
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  }
  expect(status(root, "done", "001-a.md").code).toBe(0);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "A (task 001)");
  const back = status(root, "switch-back");
  expect(back.code, back.out).toBe(0);
  expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
}

describe("diff.relative=true does not skew the merge guard (173 round 3)", () => {
  it("nested: a Maestro state file changed locally is still exempt from the target dirt check", async () => {
    const { repo, root } = await project("nested");
    workedInMainCheckout(repo, root, { "a.txt": "a\n" });
    // Tracked and modified in the main checkout: exempt. Under diff.relative=true, unpinned, git would
    // print it as .claude/epics/e1/EPIC.md (no sub/ prefix), so the exemption would miss it.
    fs.appendFileSync(path.join(epicDir(root), "EPIC.md"), "\nlocal note\n");

    const r = status(root, "merge", "001-a.md");

    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("merged task-001 into main");
    expect(r.out).not.toContain("uncommitted changes");
  });

  it("nested: names a locally modified file the branch changes by its top-relative path, and the stash command resolves it", async () => {
    const { repo, root } = await project("nested");
    workedInMainCheckout(repo, root, { "app.txt": "from the branch\n" });
    fs.writeFileSync(path.join(root, "app.txt"), "regenerated locally\n");

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain("sub/app.txt — DIFFERENT from task-001's copy");
    expect(r.out).not.toContain("\n  app.txt —");
    const cmd = /^\s+(git -C .+ stash push .+)$/m.exec(r.out)?.[1];
    expect(cmd, r.out).toBeTruthy();
    expect(cmd).toContain("-- sub/app.txt");
    expect(fs.readFileSync(path.join(root, "app.txt"), "utf8")).toBe("regenerated locally\n");
  });

  it("nested: switch-back lists the branch's read-only path from the top level, and refuses before switching", async () => {
    const { repo, root } = await project("nested");
    git(repo, "switch", "-q", "-c", "task-001");
    fs.mkdirSync(path.join(root, "ro"));
    fs.writeFileSync(path.join(root, "ro", "x.txt"), "branch\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "branch adds ro/x.txt");
    fs.chmodSync(path.join(root, "ro"), 0o555);
    try {
      const r = status(root, "switch-back");

      expect(r.out).toContain("SANDBOX-BLOCKED");
      expect(r.out).toContain("sub/ro/x.txt");
      expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("task-001");
    } finally {
      fs.chmodSync(path.join(root, "ro"), 0o755);
    }
  });

  it("nested: switch-back refuses over a tracked change and names it by its top-relative path", async () => {
    const { repo, root } = await project("nested");
    git(repo, "switch", "-q", "-c", "task-001");
    // An uncommitted edit on the task branch: switch-back must refuse, naming sub/app.txt (not app.txt).
    fs.writeFileSync(path.join(root, "app.txt"), "local edit\n");

    const r = status(root, "switch-back");

    expect(r.code).toBe(1);
    expect(r.out).toContain("switch-back REFUSED");
    expect(r.out).toContain("(e.g. sub/app.txt)");
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("task-001");
  });

  it("flat control: a locally modified file the branch changes is named app.txt, with the same refusal", async () => {
    const { repo, root } = await project("top");
    workedInMainCheckout(repo, root, { "app.txt": "from the branch\n" });
    fs.writeFileSync(path.join(root, "app.txt"), "regenerated locally\n");

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain("app.txt — DIFFERENT from task-001's copy");
    expect(r.out).toContain(`git -C ${repo} stash push -m 'before merging task-001' -- app.txt`);
    expect(branches(root)).toContain("task-001");
  });

  it("flat control: the switch-back and the merge work with the config set, changing nothing else", async () => {
    const { repo, root } = await project("top");
    workedInMainCheckout(repo, root, { "a.txt": "a\n" });

    const r = status(root, "merge", "001-a.md");

    expect(r.code, r.out).toBe(0);
    expect(git(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
  });
});
