// `163` through the REAL installed CLI: what a worktree holds that git does not.
//   - `merge` refuses while ignored paths exist only in the worktree (a gitignored fixture the commit
//     does not carry), lists them with the three exits, honours `--accept-ignored`, and merges once
//     they are committed with `git add -f`. `done` prints the same list without refusing.
//   - `worktree` copies git-excluded nested `.claude` directories into a new worktree; a copy git
//     would show as untracked is removed again and warned; nothing is left to clean by hand at merge.
// Real git repos and real worktrees under os.tmpdir(); HOME pinned and CLAUDE_CODE_SESSION_ID always
// set. Nothing is mocked. The fixture rule names no tool: the ignored paths are plain `.dat` files.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import {
  formatExcludedProvision,
  formatIgnoredNotice,
  ignoredOnlyInWorktree,
  provisionExcludedDirs,
  type GitRunner,
} from "../../src/core/worktree-footprint.js";
import { defaultish } from "./fixtures/configs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

vi.setConfig({ testTimeout: 60_000 });

const SESSION_A = "sess-163-fa";
const SESSION_B = "sess-163-fb";

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-163f-")));
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

const runner: GitRunner = (cwd, args) => {
  try {
    return { ok: true, out: git(cwd, ...args) };
  } catch (err) {
    return { ok: false, out: String((err as { stdout?: string }).stdout ?? "") };
  }
};

function cli(dir: string, args: string[], sessionId: string | null) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLAUDE_PROJECT_DIR: dir,
    HOME: tmp,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
  if (sessionId === null) delete env.CLAUDE_CODE_SESSION_ID;
  else env.CLAUDE_CODE_SESSION_ID = sessionId;
  const r = spawnSync("node", [path.join(dir, ".claude", "scripts", "maestro-task-status.cjs"), ...args], {
    encoding: "utf8",
    env,
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const sessionDir = (root: string, id: string) => path.join(root, ".claude", "maestro_sessions", id);
const wtPathFor = (root: string) => path.join(path.dirname(root), `${path.basename(root)}-task-002`);
function put(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

/** A project whose `.gitignore` is `rules`, with an installed runtime and two tasks, committed. */
async function project(rules: string, extra?: (root: string) => void): Promise<string> {
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
  put(path.join(root, ".gitignore"), rules);
  put(path.join(root, "app.txt"), "main\n");
  for (const f of ["001-a.md", "002-b.md"])
    put(path.join(root, ".claude", "maestro-tasks", f), `# ${f}\n\n## Blocked by\n\nNone\n`);
  extra?.(root);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

/** Session A holds 001; session B claims 002 and gets the worktree task-002. */
function worktreeFor002(root: string): { wt: string; out: string } {
  for (const id of [SESSION_A, SESSION_B]) put(path.join(sessionDir(root, id), "log.jsonl"), '{"kind":"tool_call"}\n');
  cli(root, ["claim", "001-a.md"], SESSION_A);
  cli(root, ["claim", "002-b.md"], SESSION_B);
  const made = cli(root, ["worktree", "002-b.md"], SESSION_B);
  const wt = wtPathFor(root);
  expect(fs.statSync(wt).isDirectory()).toBe(true);
  return { wt, out: made.stdout };
}

/** Commit what is tracked in the worktree and mark the task done. */
function finish(wt: string) {
  put(path.join(wt, "work.txt"), "w\n");
  git(wt, "add", "work.txt");
  git(wt, "commit", "-q", "-m", "work");
  return cli(wt, ["done", "002-b.md"], SESSION_B);
}

const FIXTURE = "fixtures/sample.dat";

describe("merge refuses ignored files only the worktree has (163)", () => {
  it("lists the ignored fixture, offers the three exits and changes nothing", async () => {
    const root = await project("*.dat\n");
    const { wt } = worktreeFor002(root);
    put(path.join(wt, FIXTURE), "fixture\n");
    const done = finish(wt);
    const head = git(root, "rev-parse", "HEAD");

    // `done` warns but never refuses: Step 4 runs before the commit is even offered.
    expect(done.code).toBe(0);
    expect(done.stdout).toContain(FIXTURE);
    expect(done.stdout).toContain("--accept-ignored");

    const run = cli(root, ["merge", "002-b.md"], null);
    expect(run.code).toBe(1);
    expect(run.stdout).toContain("REFUSED");
    expect(run.stdout).toContain(FIXTURE);
    expect(run.stdout).toContain("git add -f");
    expect(run.stdout).toContain("delete them");
    expect(run.stdout).toContain("--accept-ignored");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(fs.existsSync(path.join(wt, FIXTURE))).toBe(true);
    expect(git(root, "branch", "--list", "task-002")).toContain("task-002");
  });

  it("merges once the fixture is committed with git add -f", async () => {
    const root = await project("*.dat\n");
    const { wt } = worktreeFor002(root);
    put(path.join(wt, FIXTURE), "fixture\n");
    finish(wt);
    git(wt, "add", "-f", FIXTURE);
    git(wt, "commit", "-q", "-m", "fixture");

    const run = cli(root, ["merge", "002-b.md"], null);
    expect(run.code, run.stdout).toBe(0);
    expect(fs.readFileSync(path.join(root, FIXTURE), "utf8")).toBe("fixture\n");
    expect(fs.existsSync(wt)).toBe(false);
  });

  it("--accept-ignored waives the check and the merge goes ahead", async () => {
    const root = await project("*.dat\n");
    const { wt } = worktreeFor002(root);
    put(path.join(wt, FIXTURE), "fixture\n");
    finish(wt);

    const run = cli(root, ["merge", "002-b.md", "--accept-ignored"], null);
    expect(run.code, run.stdout).toBe(0);
    expect(fs.existsSync(wt)).toBe(false);
    expect(fs.existsSync(path.join(root, FIXTURE))).toBe(false);
  });

  it("a path present in both checkouts is environment and is not listed", async () => {
    const root = await project("*.dat\n");
    const { wt } = worktreeFor002(root);
    put(path.join(root, FIXTURE), "environment\n");
    put(path.join(wt, FIXTURE), "environment\n");
    finish(wt);

    expect(ignoredOnlyInWorktree(runner, root, wt)).toEqual([]);
    const run = cli(root, ["merge", "002-b.md"], null);
    expect(run.code, run.stdout).toBe(0);
  });

  it("collapses a wholly ignored directory to one entry, and skips one the main checkout also has", async () => {
    const root = await project("scratch/\ncache/\n");
    const { wt } = worktreeFor002(root);
    put(path.join(wt, "scratch", "a", "one"), "1\n");
    put(path.join(wt, "scratch", "two"), "2\n");
    put(path.join(wt, "cache", "x"), "x\n");
    put(path.join(root, "cache", "y"), "y\n");

    expect(ignoredOnlyInWorktree(runner, root, wt)).toEqual(["scratch/"]);
  });

  it("works for a freeform branch too", async () => {
    const root = await project("*.dat\n");
    const wt = path.join(path.dirname(root), `${path.basename(root)}-freeform-ab12cd34`);
    git(root, "worktree", "add", "-q", "-b", "freeform-ab12cd34", wt);
    put(path.join(wt, "work.txt"), "w\n");
    put(path.join(wt, FIXTURE), "fixture\n");
    git(wt, "add", "work.txt");
    git(wt, "commit", "-q", "-m", "work");

    const refused = cli(root, ["merge", "freeform-ab12cd34"], null);
    expect(refused.code).toBe(1);
    expect(refused.stdout).toContain(FIXTURE);
    expect(fs.existsSync(wt)).toBe(true);

    git(wt, "add", "-f", FIXTURE);
    git(wt, "commit", "-q", "-m", "fixture");
    const merged = cli(root, ["merge", "freeform-ab12cd34"], null);
    expect(merged.code, merged.stdout).toBe(0);
    expect(fs.existsSync(wt)).toBe(false);
  });
});

describe("the notices name no tool or file type (163)", () => {
  const TOOLS = /\b(npm|npx|pnpm|yarn|bun|pip|poetry|cargo|gradle|maven|make|jest|vitest|mocha|pytest|rspec|eslint)\b/i;

  it("the ignored-files notice is project-agnostic", () => {
    const text = formatIgnoredNotice(["some/path", "dir/"], "/wt");
    expect(text).toContain("some/path");
    expect(text).not.toMatch(TOOLS);
    expect(text).not.toMatch(/\.(pem|env|json|ts|js|py|rb|go|rs|key|crt)\b/i);
    expect(formatIgnoredNotice([], "/wt")).toBe("");
  });

  it("the provisioning notice and the module source are project-agnostic", () => {
    const text = formatExcludedProvision({ copied: ["apps/web/.claude"], warned: ["apps/api/.claude"] });
    expect(text).not.toMatch(TOOLS);
    const source = fs.readFileSync(path.join(here, "../../src/core/worktree-footprint.ts"), "utf8");
    expect(source).not.toMatch(TOOLS);
  });
});

describe("a new worktree gets the git-excluded nested .claude directories (163)", () => {
  const SKILL = "apps/web/.claude/skills/local/SKILL.md";
  const seed = (root: string) => {
    put(path.join(root, "apps", "web", "index.txt"), "tracked\n");
    put(path.join(root, SKILL), "# local project skill\n");
  };

  it("copies the directory, leaves git status clean, and merge leaves nothing behind", async () => {
    const root = await project("apps/*/.claude/\n", seed);
    expect(git(root, "ls-files", "apps/web")).toBe("apps/web/index.txt");

    const { wt, out } = worktreeFor002(root);

    expect(out).toContain("apps/web/.claude");
    expect(out).toContain("copied");
    expect(fs.readFileSync(path.join(wt, SKILL), "utf8")).toBe("# local project skill\n");
    // A copy, not a link: a `dir/` ignore rule does not match a symlink.
    expect(fs.lstatSync(path.join(wt, "apps", "web", ".claude")).isSymbolicLink()).toBe(false);
    expect(git(wt, "status", "--porcelain", "--untracked-files=all", "--", "apps")).toBe("");

    expect(finish(wt).code).toBe(0);
    const run = cli(root, ["merge", "002-b.md"], null);
    expect(run.code, run.stdout).toBe(0);
    expect(fs.existsSync(wt)).toBe(false);
    expect(git(root, "worktree", "list", "--porcelain")).not.toContain("task-002");
    expect(git(root, "branch", "--list", "task-002")).toBe("");
    // The main checkout's own copy is untouched.
    expect(fs.readFileSync(path.join(root, SKILL), "utf8")).toBe("# local project skill\n");
  });

  it("removes a copy that would show as untracked and says so", async () => {
    // The rule that excludes it in the main checkout is itself an untracked file there, so the
    // worktree has no such rule: the copy would be untracked.
    const root = await project("", (r) => put(path.join(r, "apps", "web", "index.txt"), "tracked\n"));
    put(path.join(root, "apps", "web", ".gitignore"), ".claude/\n");
    put(path.join(root, SKILL), "# local project skill\n");

    const { wt, out } = worktreeFor002(root);

    expect(out).toContain("NOT copied");
    expect(out).toContain("apps/web/.claude");
    expect(fs.existsSync(path.join(wt, "apps", "web", ".claude"))).toBe(false);
    expect(git(wt, "status", "--porcelain", "--untracked-files=all", "--", "apps")).toBe("");

    expect(finish(wt).code).toBe(0);
    const run = cli(root, ["merge", "002-b.md"], null);
    expect(run.code, run.stdout).toBe(0);
    expect(fs.existsSync(wt)).toBe(false);
  });

  it("copies nothing and prints nothing when the main checkout has no excluded nested .claude", async () => {
    const root = await project("*.dat\n");
    const { out } = worktreeFor002(root);
    expect(out).not.toContain("copied git-excluded");
    expect(out).not.toContain("NOT copied");
  });

  it("never touches the root .claude, and never overwrites content already in the worktree", async () => {
    const root = await project("apps/*/.claude/\n", seed);
    const wt = path.join(tmp, "manual-wt");
    git(root, "worktree", "add", "-q", "-b", "manual", wt);
    put(path.join(wt, "apps", "web", ".claude", "mine"), "keep\n");

    const r = provisionExcludedDirs(runner, root, wt);

    expect(r).toEqual({ copied: [], warned: [] });
    expect(fs.readFileSync(path.join(wt, "apps", "web", ".claude", "mine"), "utf8")).toBe("keep\n");
    expect(fs.existsSync(path.join(wt, "apps", "web", ".claude", "skills"))).toBe(false);
  });
});
