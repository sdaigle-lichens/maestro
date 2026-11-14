// `182` adversarial coverage through the REAL installed CLI and real git repositories under
// os.tmpdir(). Complements landing-guards-182.test.ts: the cases here are the ones the ticket's
// acceptance criteria imply but that file does not pin: master-only repos, an unset origin/HEAD
// with main already checked out, the freeform worktree path, a slash-named default branch, a
// dangling origin/HEAD, the origin/<def> start point when no local default exists, the
// provenance wording on every message that names the default branch, and the skill and template
// prose that tells a worker how to find the default branch.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultBranch, type GitRunner } from "../../src/core/landing-guards.js";
import { defaultish } from "./fixtures/configs.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

const SESSION_A = "sess-qaa-111";
const SESSION_B = "sess-qbb-222";
const AUTO = "git remote set-head origin --auto";
const EXPLICIT = "git remote set-head origin <branch>";

let tmp: string;
let home: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-182qa-")));
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

function gitMayFail(cwd: string, ...args: string[]): { ok: boolean; out: string } {
  try {
    return { ok: true, out: git(cwd, ...args) };
  } catch (err) {
    return { ok: false, out: String((err as { stderr?: unknown }).stderr ?? "") };
  }
}

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

function setHead(root: string, ...args: string[]) {
  git(root, "remote", "set-head", "origin", ...args);
}

function liveSession(root: string, id: string) {
  const dir = path.join(root, ".claude", "maestro_sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "log.jsonl"), '{"kind":"tool_call"}\n');
}

function workBranch(root: string, name: string, from: string): void {
  git(root, "switch", "-q", "-c", name, from);
  fs.writeFileSync(path.join(root, `${name}.txt`), `${name}\n`);
  git(root, "add", `${name}.txt`);
  git(root, "commit", "-q", "-m", `work on ${name}`);
}

const branches = (root: string) => git(root, "branch", "--format=%(refname:short)").split("\n").filter(Boolean);
const current = (root: string) => git(root, "rev-parse", "--abbrev-ref", "HEAD");
const worktreeCount = (root: string) =>
  git(root, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((l) => l.startsWith("worktree ")).length;

/** The line of `out` that carries `needle`, or "" when none does. */
const lineWith = (out: string, needle: string) => out.split("\n").find((l) => l.includes(needle)) ?? "";

describe("defaultBranch edge cases (182 QA)", () => {
  const SYMREF = "symbolic-ref --quiet --short refs/remotes/origin/HEAD";
  const runner =
    (answers: Record<string, string>): GitRunner =>
    (_cwd, args) => {
      const key = args.join(" ");
      return key in answers ? { ok: true, out: answers[key] as string } : { ok: false, out: "" };
    };

  it("keeps a slash inside the branch name (origin/release/1.0 is release/1.0)", () => {
    expect(defaultBranch(runner({ [SYMREF]: "origin/release/1.0" }), "/x")).toBe("release/1.0");
  });

  it("is null when origin/HEAD is unset and only a local master exists", () => {
    expect(defaultBranch(runner({ "rev-parse --verify --quiet refs/heads/master": "abc" }), "/x")).toBeNull();
  });

  it("is null when git answers the origin/HEAD query with an empty name", () => {
    expect(defaultBranch(runner({ [SYMREF]: "origin/" }), "/x")).toBeNull();
  });

  it("with a real repository, unset origin/HEAD with main and master present is still null", async () => {
    const root = await project();
    git(root, "branch", "master");
    const real: GitRunner = (cwd, args) => gitMayFail(cwd, ...args);
    expect(defaultBranch(real, root)).toBeNull();
  });
});

describe("origin/HEAD unset, adversarial (182 QA)", () => {
  it("switch-back refuses while main is already checked out (no 'already on main' shortcut)", async () => {
    const root = await project();
    expect(current(root)).toBe("main");

    const r = cli(root, ["switch-back"]);

    expect(r.code).toBe(1);
    expect(r.out).toContain("switch-back REFUSED");
    expect(r.out).not.toContain("nothing to do");
    expect(r.out).toContain(AUTO);
    expect(r.out).toContain(EXPLICIT);
    expect(current(root)).toBe("main");
  });

  it("merge refuses when the only default-like branch is a local master, and changes nothing", async () => {
    const root = await project();
    git(root, "branch", "-m", "main", "master");
    workBranch(root, "task-001", "master");
    git(root, "switch", "-q", "master");
    expect(cli(root, ["done", "001-a.md"]).code).toBe(0);
    const head = git(root, "rev-parse", "HEAD");

    const r = cli(root, ["merge", "001-a.md"]);

    expect(r.code).toBe(1);
    expect(r.out).toContain("origin/HEAD is not set");
    expect(r.out).toContain(AUTO);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(current(root)).toBe("master");
    expect(branches(root)).toContain("task-001");
  });

  it("freeform-check refuses before any worktree or branch exists", async () => {
    const root = await project();
    liveSession(root, SESSION_A);
    liveSession(root, SESSION_B);
    expect(cli(root, ["claim", "001-a.md"], SESSION_A).out).toContain("claimed");
    const before = branches(root);

    const r = cli(root, ["freeform-check"], SESSION_B);

    expect(r.out).toContain("REFUSED");
    expect(r.out).toContain(AUTO);
    expect(r.out).toContain(EXPLICIT);
    expect(branches(root)).toEqual(before);
    expect(worktreeCount(root)).toBe(1);
  });

  it("worktree start refuses without writing a pointer into the second session", async () => {
    const root = await project();
    liveSession(root, SESSION_A);
    liveSession(root, SESSION_B);
    expect(cli(root, ["claim", "001-a.md"], SESSION_A).out).toContain("claimed");
    expect(cli(root, ["claim", "002-b.md"], SESSION_B).out).toContain("claimed");

    cli(root, ["worktree", "002-b.md"], SESSION_B);

    expect(worktreeCount(root)).toBe(1);
    expect(branches(root)).not.toContain("task-002");
  });
});

describe("origin/HEAD set to dev, adversarial (182 QA)", () => {
  it("switch-back when already on dev says it is the default branch from origin/HEAD", async () => {
    const root = await projectWithRemote();
    setHead(root, "dev");
    git(root, "switch", "-q", "dev");

    const r = cli(root, ["switch-back"]);

    expect(r.code).toBe(0);
    expect(r.out).toContain("already on dev (the default branch, origin/HEAD)");
  });

  it("worktree start falls back to origin/dev only when there is no local dev, and starts there", async () => {
    const root = await projectWithRemote();
    setHead(root, "dev");
    git(root, "branch", "-D", "dev");
    expect(branches(root)).not.toContain("dev");
    liveSession(root, SESSION_A);
    liveSession(root, SESSION_B);
    expect(cli(root, ["claim", "001-a.md"], SESSION_A).out).toContain("claimed");
    expect(cli(root, ["claim", "002-b.md"], SESSION_B).out).toContain("claimed");

    const r = cli(root, ["worktree", "002-b.md"], SESSION_B);

    expect(r.out).toContain("started from dev, the default branch from origin/HEAD");
    expect(git(root, "rev-parse", "task-002")).toBe(git(root, "rev-parse", "origin/dev"));
    expect(git(root, "rev-parse", "task-002")).not.toBe(git(root, "rev-parse", "main"));
  });

  it("the not-default refusal's switch-back hint names dev with its origin/HEAD provenance", async () => {
    const root = await projectWithRemote();
    setHead(root, "dev");
    workBranch(root, "task-001", "dev");
    git(root, "switch", "-q", "main");
    expect(cli(root, ["done", "001-a.md"]).code).toBe(0);

    const refused = cli(root, ["merge", "001-a.md"]);

    expect(refused.code).toBe(1);
    // Every landing message that names the default branch says where it comes from (AC 3).
    expect(lineWith(refused.out, "switch the main checkout back to dev")).toContain("origin/HEAD");
  });

  it("a switch-back that git refuses names dev with its origin/HEAD provenance", async () => {
    const root = await projectWithRemote();
    setHead(root, "dev");
    git(root, "switch", "-q", "-c", "feature");
    // An untracked file where dev's tracked dev.txt would land makes `git switch dev` refuse.
    fs.writeFileSync(path.join(root, "dev.txt"), "untracked\n");

    const r = cli(root, ["switch-back"]);

    expect(r.code).toBe(1);
    expect(r.out).toContain("switch-back FAILED");
    expect(lineWith(r.out, "switch-back FAILED")).toContain("(origin/HEAD)");
    expect(current(root)).toBe("feature");
  });
});

describe("origin/HEAD dangling, adversarial (182 QA)", () => {
  it("a worktree start creates nothing and does not fall back to main", async () => {
    const root = await projectWithRemote();
    // origin/HEAD points at a branch the clone never fetched: the ref is written, the target is not.
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/ghost");
    git(root, "branch", "-D", "dev");
    liveSession(root, SESSION_A);
    liveSession(root, SESSION_B);
    expect(cli(root, ["claim", "001-a.md"], SESSION_A).out).toContain("claimed");
    expect(cli(root, ["claim", "002-b.md"], SESSION_B).out).toContain("claimed");

    const r = cli(root, ["worktree", "002-b.md"], SESSION_B);

    expect(r.out).not.toContain("started from main");
    expect(branches(root)).not.toContain("task-002");
    expect(worktreeCount(root)).toBe(1);
  });

  it("merge refuses while main is checked out and names the dangling origin/HEAD target", async () => {
    const root = await projectWithRemote();
    git(root, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/ghost");
    workBranch(root, "task-001", "main");
    git(root, "switch", "-q", "main");
    expect(cli(root, ["done", "001-a.md"]).code).toBe(0);
    const head = git(root, "rev-parse", "HEAD");

    const r = cli(root, ["merge", "001-a.md"]);

    expect(r.code).toBe(1);
    expect(r.out).toContain("not the default branch ghost (origin/HEAD)");
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
  });
});

describe("origin/HEAD set to main, adversarial (182 QA)", () => {
  it("a worktree start names main with its origin/HEAD provenance", async () => {
    const root = await projectWithRemote();
    setHead(root, "main");
    liveSession(root, SESSION_A);
    liveSession(root, SESSION_B);
    expect(cli(root, ["claim", "001-a.md"], SESSION_A).out).toContain("claimed");
    expect(cli(root, ["claim", "002-b.md"], SESSION_B).out).toContain("claimed");

    const r = cli(root, ["worktree", "002-b.md"], SESSION_B);

    expect(r.out).toContain("started from main, the default branch from origin/HEAD");
    expect(git(root, "rev-parse", "task-002")).toBe(git(root, "rev-parse", "main"));
  });
});

describe("skill and template prose on the default branch (182 QA)", () => {
  const read = (rel: string) => fs.readFileSync(path.join(PLUGIN_ROOT, rel), "utf8");
  // A fallback reads "else main" / "else master"; the prohibition "never fall back to `main` or `master`" is fine.
  const FALLBACK = /\belse\s+`?(main|master)`?\b/i;

  it("land-the-task's <DEFAULT> row takes the default branch only from origin/HEAD", () => {
    const row = read("skills/land-the-task/SKILL.md")
      .split("\n")
      .find((l) => l.includes("`<DEFAULT>`"));
    expect(row).toBeDefined();
    expect(row).toContain("origin/HEAD");
    expect(row).toContain(AUTO);
    expect(row).toContain(EXPLICIT);
    expect(row).not.toMatch(FALLBACK);
  });

  it("the maestro-manager merge plan and the orchestrator template name the set-head fix and no fallback", () => {
    for (const rel of ["skills/maestro-manager/SKILL.md", "templates/maestro/SKILL.md"]) {
      const text = read(rel);
      expect(text, rel).toContain(AUTO);
      expect(text, rel).not.toMatch(/\belse\s+`?(main|master)`?\b/i);
    }
  });
});
