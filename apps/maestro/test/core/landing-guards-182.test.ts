// `182` through the REAL installed CLIs: the default branch comes ONLY from origin/HEAD. With it
// unset, `merge`, `switch-back` and the worktree start refuse, change nothing, and name the exact
// `git remote set-head` commands, even with a local main present. With it set (including overridden
// locally to a branch other than the remote's default) task branches start from, and merge into, that
// branch, and the messages say it comes from origin/HEAD. Real git repositories and real spawned node
// processes under os.tmpdir(); nothing mocked.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultBranch, originHeadUnsetMessage, type GitRunner } from "../../src/core/landing-guards.js";
import { defaultish } from "./fixtures/configs.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

const SESSION_A = "sess-aaa-111";
const SESSION_B = "sess-bbb-222";
const AUTO = "git remote set-head origin --auto";
const EXPLICIT = "git remote set-head origin <branch>";

let tmp: string;
let home: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-182-")));
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

describe("defaultBranch (182)", () => {
  const runner =
    (answers: Record<string, string>): GitRunner =>
    (_cwd, args) => {
      const key = args.join(" ");
      return key in answers ? { ok: true, out: answers[key] as string } : { ok: false, out: "" };
    };
  const SYMREF = "symbolic-ref --quiet --short refs/remotes/origin/HEAD";

  it("is what origin/HEAD points at, minus origin/", () => {
    expect(defaultBranch(runner({ [SYMREF]: "origin/dev" }), "/x")).toBe("dev");
  });

  it("is null when origin/HEAD is unset, even with local main and master branches present", () => {
    const answers = {
      "rev-parse --verify --quiet refs/heads/main": "abc",
      "rev-parse --verify --quiet refs/heads/master": "abc",
    };
    expect(defaultBranch(runner(answers), "/x")).toBeNull();
  });

  it("names both set-head commands in the refusal message", () => {
    const msg = originHeadUnsetMessage("/x");
    expect(msg).toContain("origin/HEAD is not set");
    expect(msg).toContain(`\`${AUTO}\``);
    expect(msg).toContain(`\`${EXPLICIT}\``);
  });
});

describe("origin/HEAD unset, a local main present (182)", () => {
  it("merge refuses, names both commands, and changes nothing", async () => {
    const root = await project();
    workBranch(root, "task-001", "main");
    git(root, "switch", "-q", "main");
    expect(cli(root, ["done", "001-a.md"]).code).toBe(0);
    const head = git(root, "rev-parse", "HEAD");

    const r = cli(root, ["merge", "001-a.md"]);

    expect(r.code).toBe(1);
    expect(r.out).toContain("merge REFUSED");
    expect(r.out).toContain("origin/HEAD is not set");
    expect(r.out).toContain(AUTO);
    expect(r.out).toContain(EXPLICIT);
    expect(git(root, "rev-parse", "HEAD")).toBe(head);
    expect(current(root)).toBe("main");
    expect(branches(root)).toContain("task-001");
  });

  it("switch-back refuses, names both commands, and stays on the current branch", async () => {
    const root = await project();
    git(root, "switch", "-q", "-c", "feature");

    const r = cli(root, ["switch-back"]);

    expect(r.code).toBe(1);
    expect(r.out).toContain("switch-back REFUSED");
    expect(r.out).toContain(AUTO);
    expect(r.out).toContain(EXPLICIT);
    expect(current(root)).toBe("feature");
  });

  it("starting a task branch and worktree refuses and creates neither", async () => {
    const root = await project();
    liveSession(root, SESSION_A);
    liveSession(root, SESSION_B);
    expect(cli(root, ["claim", "001-a.md"], SESSION_A).out).toContain("claimed");
    expect(cli(root, ["claim", "002-b.md"], SESSION_B).out).toContain("claimed");

    const r = cli(root, ["worktree", "002-b.md"], SESSION_B);

    expect(r.out).toContain("REFUSED");
    expect(r.out).toContain(AUTO);
    expect(r.out).toContain(EXPLICIT);
    expect(branches(root)).not.toContain("task-002");
    expect(fs.existsSync(path.join(tmp, "repo-task-002"))).toBe(false);
  });
});

describe("origin/HEAD set locally to dev while the remote's default is main (182)", () => {
  it("starts the task branch from dev, not from main or the checked-out branch", async () => {
    const root = await projectWithRemote();
    setHead(root, "dev"); // the clone's origin/HEAD now points at dev; the remote's own default is main
    expect(git(root, "symbolic-ref", "--short", "refs/remotes/origin/HEAD")).toBe("origin/dev");
    liveSession(root, SESSION_A);
    liveSession(root, SESSION_B);
    expect(cli(root, ["claim", "001-a.md"], SESSION_A).out).toContain("claimed");
    expect(cli(root, ["claim", "002-b.md"], SESSION_B).out).toContain("claimed");

    const r = cli(root, ["worktree", "002-b.md"], SESSION_B);

    expect(r.out).toContain("started from dev, the default branch from origin/HEAD");
    expect(git(root, "rev-parse", "task-002")).toBe(git(root, "rev-parse", "dev"));
    expect(git(root, "rev-parse", "task-002")).not.toBe(git(root, "rev-parse", "main"));
  });

  it("merges into dev, says it comes from origin/HEAD, and refuses while main is checked out", async () => {
    const root = await projectWithRemote();
    setHead(root, "dev");
    workBranch(root, "task-001", "dev");
    git(root, "switch", "-q", "main");
    expect(cli(root, ["done", "001-a.md"]).code).toBe(0);

    const refused = cli(root, ["merge", "001-a.md"]);
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("is on branch main, not the default branch dev (origin/HEAD)");

    const back = cli(root, ["switch-back"]);
    expect(back.code).toBe(0);
    expect(back.out).toContain("to dev (origin/HEAD)");
    expect(current(root)).toBe("dev");

    const ok = cli(root, ["merge", "001-a.md"]);
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("merged task-001 into dev (origin/HEAD)");
    expect(git(root, "log", "-1", "--format=%s", "main")).toBe("init");
    expect(git(root, "ls-tree", "--name-only", "dev")).toContain("task-001.txt");
  });
});

describe("origin/HEAD set to main (182, unchanged behaviour)", () => {
  it("merges into main and says the branch comes from origin/HEAD", async () => {
    const root = await projectWithRemote();
    setHead(root, "main");
    workBranch(root, "task-001", "main");
    git(root, "switch", "-q", "main");
    expect(cli(root, ["done", "001-a.md"]).code).toBe(0);

    const r = cli(root, ["merge", "001-a.md"]);

    expect(r.code).toBe(0);
    expect(r.out).toContain("merged task-001 into main (origin/HEAD)");
  });
});
