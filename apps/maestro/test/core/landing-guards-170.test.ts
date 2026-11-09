// `170` through the REAL installed CLIs: `maestro-epic.cjs report` (the report guard) and
// `maestro-task-status.cjs merge | switch-back` (the target guard, verify-after-merge, the switch
// back). Real git repositories and real spawned node processes under os.tmpdir(); nothing mocked.
// HOME is pinned to a temp dir and CLAUDE_CODE_SESSION_ID is deleted (never inherited), per
// test-maestro's references/hook-script-tests.md.
//
// Three tests are PROBES of known gaps in the report guard. They assert the correct behaviour, so
// they FAIL until the backend fixes the gap; they are routed back to the backend, not skipped.

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
import { shaCandidates } from "../../src/core/landing-guards.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const REPO_ROOT = path.resolve(here, "../../../..");

let tmp: string;
let home: string;
// Directories a test made read-only, restored in afterEach so the temp tree can be removed.
const lockedDirs: string[] = [];

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-170-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home);
});

afterEach(() => {
  for (const d of lockedDirs.splice(0)) fs.chmodSync(d, 0o755);
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── helpers ─────────────────────────────────────────────────────────────────

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

function branchNames(root: string): string[] {
  return git(root, "branch", "--format=%(refname:short)").split("\n").filter(Boolean);
}

function currentBranch(root: string): string {
  return git(root, "rev-parse", "--abbrev-ref", "HEAD");
}

/** Spawn an installed script the way Claude Code would: project pinned, no session id inherited. */
function run(root: string, script: string, args: string[], opts: { input?: string; extra?: NodeJS.ProcessEnv } = {}) {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", script), ...args], {
    encoding: "utf8",
    input: opts.input ?? "",
    env: pinnedEnv(home, { ...GIT_IDENTITY, CLAUDE_PROJECT_DIR: root, ...(opts.extra ?? {}) }),
  });
  return { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}` };
}

const status = (root: string, ...args: string[]) => run(root, "maestro-task-status.cjs", args);
const epic = (root: string, ...args: string[]) => run(root, "maestro-epic.cjs", args);
const epicWithBody = (root: string, body: string, ...args: string[]) =>
  run(root, "maestro-epic.cjs", args, { input: body });

/** Same quoting rule as the script's shellQuote, for asserting the exact `!` command. */
function sq(s: string): string {
  return /^[A-Za-z0-9_./@:=+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`;
}

/** Projects the repo with two tasks, epic `e1` holding both, and one commit on main. */
async function project(opts: { verifyCommand?: string; pkg?: Record<string, unknown> } = {}): Promise<string> {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeConfig(root, {
    ...defaultish,
    ...(opts.verifyCommand !== undefined ? { verify_command: opts.verifyCommand } : {}),
  });
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  fs.writeFileSync(path.join(root, "app.txt"), "main\n");
  if (opts.pkg) fs.writeFileSync(path.join(root, "package.json"), JSON.stringify(opts.pkg, null, 2));
  for (const [file, title] of [
    ["001-a.md", "A"],
    ["002-b.md", "B"],
  ] as const) {
    fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", file), `# ${title}\n\n## Blocked by\n\nNone\n`);
  }
  expect(epic(root, "create", "e1").code).toBe(0);
  expect(epic(root, "link", "e1", "001-a.md", "002-b.md").code).toBe(0);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

/**
 * Creates `name` at main's HEAD, commits one file on it, and leaves the checkout on main. Returns
 * the new commit's full SHA.
 */
function workBranch(root: string, name: string): string {
  git(root, "switch", "-q", "-c", name);
  fs.writeFileSync(path.join(root, `${name}.txt`), `${name}\n`);
  git(root, "add", `${name}.txt`);
  git(root, "commit", "-q", "-m", `work on ${name}`);
  const sha = git(root, "rev-parse", "HEAD");
  git(root, "switch", "-q", "main");
  return sha;
}

// ── the epic report guard (170) ─────────────────────────────────────────────

describe("epic report guard (170)", () => {
  it("refuses a done report that names no commit, and writes nothing", async () => {
    const root = await project();
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);

    const r = epicWithBody(root, "Outcome: done\nAll green.\n", "report", "--task", "001-a.md", "--file", "-");

    expect(r.code).toBe(1);
    expect(r.out).toContain("report REFUSED");
    expect(r.out).toContain("001-a.md");
    expect(r.out).toContain("names no commit SHA");
    expect(epic(root, "reports", "e1").out).toContain("no unacknowledged reports");
  });

  it("refuses a report whose SHA does not exist, and names what was checked", async () => {
    const root = await project();
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);
    const fake = "0123456789abcdef0123456789abcdef01234567";

    const r = epicWithBody(root, `Outcome: done\nCommit ${fake}\n`, "report", "--task", "001-a.md", "--file", "-");

    expect(r.code).toBe(1);
    expect(r.out).toContain("no commit named in it exists");
    expect(r.out).toContain(fake.slice(0, 7));
    expect(epic(root, "reports", "e1").out).toContain("no unacknowledged reports");
  });

  it("refuses a SHA that is on neither the task branch nor the default branch", async () => {
    const root = await project();
    workBranch(root, "task-001");
    git(root, "switch", "-q", "-c", "other");
    fs.writeFileSync(path.join(root, "other.txt"), "o\n");
    git(root, "add", "other.txt");
    git(root, "commit", "-q", "-m", "unrelated");
    const otherSha = git(root, "rev-parse", "--short", "HEAD");
    git(root, "switch", "-q", "main");
    expect(status(root, "done", "001-a.md").code).toBe(0);

    const r = epicWithBody(root, `Outcome: done\nCommit ${otherSha}\n`, "report", "--task", "001-a.md", "--file", "-");

    expect(r.code).toBe(1);
    expect(r.out).toContain(`commit ${otherSha} is not on the task branch task-001`);
  });

  it("refuses the default-branch commit the task started from, when the task branch holds its work", async () => {
    const root = await project();
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);
    const baseShort = git(root, "rev-parse", "--short", "HEAD");

    const r = epicWithBody(root, `Outcome: done\nCommit ${baseShort}\n`, "report", "--task", "001-a.md", "--file", "-");

    expect(r.code).toBe(1);
    expect(r.out).toContain(`commit ${baseShort} is already on main`);
    expect(r.out).toContain("what task-001 started from");
  });

  it("accepts a report naming the task branch's commit, and writes it", async () => {
    const root = await project();
    const taskSha = workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);

    const r = epicWithBody(
      root,
      `Outcome: done\nCommit ${taskSha.slice(0, 9)}\nVerified: pnpm verify green.\n`,
      "report",
      "--task",
      "001-a.md",
      "--file",
      "-"
    );

    expect(r.code).toBe(0);
    expect(r.out).toContain("written to");
    expect(epic(root, "reports", "e1").out).toContain("r001");
  });

  it("does not check a report for a task that is not done", async () => {
    const root = await project();

    const r = epicWithBody(
      root,
      "Outcome: partial\nNo commit yet, still in progress.\n",
      "report",
      "--task",
      "002-b.md",
      "--file",
      "-"
    );

    expect(r.code).toBe(0);
    expect(r.out).toContain("written to");
  });

  it("checks a task the tracker marks done even when the body has no done line", async () => {
    const root = await project();
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);

    const r = epicWithBody(root, "Ran the suite. Everything passed.\n", "report", "--task", "001-a.md", "--file", "-");

    expect(r.code).toBe(1);
    expect(r.out).toContain("names no commit SHA");
  });

  // PROBE (gap): an uppercase SHA is not a SHA candidate (SHA_CANDIDATE is lowercase only), so a
  // report naming a real commit in uppercase is refused as "names no commit SHA". git itself
  // resolves uppercase hex, so the refusal is false.
  it("PROBE accepts an uppercase SHA that git resolves to a task-branch commit", async () => {
    const root = await project();
    const taskSha = workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);
    const upper = taskSha.slice(0, 10).toUpperCase();

    const r = epicWithBody(root, `Outcome: done\nCommit ${upper}\n`, "report", "--task", "001-a.md", "--file", "-");

    expect(r.out).not.toContain("names no commit SHA");
    expect(r.code).toBe(0);
  });

  // PROBE (gap): the task branch exists but has no commit of its own (created at main's HEAD and
  // never committed to). The base commit is an ancestor of the branch and, because the branch is
  // then "merged" (same commit as main), the default-branch exclusion does not apply, so the base
  // commit passes as the task's work.
  it("PROBE refuses the base commit when the task branch has no commit of its own", async () => {
    const root = await project();
    git(root, "branch", "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);
    const baseShort = git(root, "rev-parse", "--short", "HEAD");

    const r = epicWithBody(root, `Outcome: done\nCommit ${baseShort}\n`, "report", "--task", "001-a.md", "--file", "-");

    expect(r.code).toBe(1);
    expect(r.out).toContain("task-001");
  });

  // PROBE (gap, needs a backend decision): the task has no task branch (merged and deleted, or never
  // created). The guard then accepts ANY commit on the default branch, including the pre-task base,
  // because it checks only ancestry and never that the commit is the task's own work.
  it("PROBE refuses the pre-task base commit when there is no task branch", async () => {
    const root = await project();
    expect(branchNames(root)).not.toContain("task-002");
    expect(status(root, "done", "002-b.md").code).toBe(0);
    const baseShort = git(root, "rev-parse", "--short", "HEAD");

    const r = epicWithBody(root, `Outcome: done\nCommit ${baseShort}\n`, "report", "--task", "002-b.md", "--file", "-");

    expect(r.code).toBe(1);
    expect(r.out).toContain("no task branch task-002");
  });
});

// ── the merge target guard and verify-after-merge (170) ─────────────────────

describe("merge refuses an unsafe target checkout (170)", () => {
  it("refuses when the main checkout is not on the default branch, and points at switch-back", async () => {
    const root = await project();
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);
    git(root, "switch", "-q", "-c", "feature");

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain("merge REFUSED");
    expect(r.out).toContain("is on branch feature, not the default branch main");
    expect(r.out).toContain("switch-back");
    expect(currentBranch(root)).toBe("feature");
    expect(branchNames(root)).toContain("task-001");
  });

  it("refuses when a tracked file outside Maestro's state changed, and changes nothing", async () => {
    const root = await project();
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);
    fs.writeFileSync(path.join(root, "app.txt"), "edited by hand\n");
    const headBefore = git(root, "rev-parse", "HEAD");

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain("uncommitted changes to 1 tracked path(s) (e.g. app.txt)");
    expect(git(root, "rev-parse", "HEAD")).toBe(headBefore);
    expect(branchNames(root)).toContain("task-001");
  });

  it("ignores Maestro's tracker and epic state files, but not other config", async () => {
    const root = await project();
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0); // rewrites the tracked tracker
    fs.appendFileSync(path.join(root, ".claude", "epics", "e1", "EPIC.md"), "\nnote written by a live session\n");

    const ok = status(root, "merge", "001-a.md");
    expect(ok.code).toBe(0);
    expect(ok.out).toContain("merged task-001 into main");

    // Same shape, but a path that is NOT Maestro state: refused.
    workBranch(root, "task-002");
    expect(status(root, "done", "002-b.md").code).toBe(0);
    fs.appendFileSync(path.join(root, ".claude", "maestro.json"), "\n");
    const refused = status(root, "merge", "002-b.md");
    expect(refused.code).toBe(1);
    expect(refused.out).toContain("(e.g. .claude/maestro.json)");
  });
});

describe("merge verifies the merged result (170)", () => {
  it("runs verify_command from maestro.json after a merge and reports PASSED", async () => {
    const root = await project({ verifyCommand: 'node -e "process.exit(0)"' });
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(0);
    expect(r.out).toContain("merged task-001 into main");
    expect(r.out).toContain("VERIFY PASSED");
    expect(r.out).toContain("verify_command in .claude/maestro.json");
    // --no-ff: the merge is a two-parent commit, and the branch is gone.
    expect(git(root, "log", "-1", "--format=%P").split(" ")).toHaveLength(2);
    expect(branchNames(root)).not.toContain("task-001");
  });

  it("reports VERIFY FAILED with the exit code, and leaves the merge in place", async () => {
    const root = await project({ verifyCommand: 'node -e "process.exit(3)"' });
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain("VERIFY FAILED (exit 3)");
    expect(r.out).not.toContain("VERIFY PASSED");
    expect(r.out).toContain("The merge is in place");
    expect(git(root, "log", "-1", "--format=%P").split(" ")).toHaveLength(2);
    expect(branchNames(root)).not.toContain("task-001");
  });

  it("reports VERIFY NOT CONFIGURED, never a pass, when there is nothing to run", async () => {
    const root = await project();
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(0);
    expect(r.out).toContain("VERIFY NOT CONFIGURED");
    expect(r.out).toContain("UNVERIFIED");
    expect(r.out).not.toContain("VERIFY PASSED");
  });

  it("detects a package.json verify script when verify_command is unset, run with the package manager", async () => {
    const root = await project({ pkg: { name: "fixture", scripts: { verify: 'node -e "process.exit(0)"' } } });
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);

    const r = run(root, "maestro-task-status.cjs", ["merge", "001-a.md"], {
      extra: { NPM_CONFIG_UPDATE_NOTIFIER: "false" },
    });

    expect(r.code).toBe(0);
    expect(r.out).toContain("`npm run verify` (the verify script in package.json)");
    expect(r.out).toContain("VERIFY PASSED");
  });

  it("does not take a placeholder test script (npm's 'no test specified') as a verify command", async () => {
    const root = await project({
      pkg: { name: "fixture", scripts: { test: 'echo "Error: no test specified" && exit 1' } },
    });
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(0);
    expect(r.out).toContain("VERIFY NOT CONFIGURED");
    expect(r.out).not.toContain("npm run test");
  });

  it("prefers verify_command over a package.json verify script", async () => {
    const root = await project({
      verifyCommand: 'node -e "process.exit(3)"',
      pkg: { name: "fixture", scripts: { verify: 'node -e "process.exit(0)"' } },
    });
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain("VERIFY FAILED (exit 3)");
  });
});

// ── switch-back (170) ───────────────────────────────────────────────────────

describe("switch-back prints the exact ! command when the switch cannot complete (170)", () => {
  it("switches a clean main checkout back to the default branch", async () => {
    const root = await project();
    git(root, "switch", "-q", "-c", "feature");

    const r = status(root, "switch-back");

    expect(r.code).toBe(0);
    expect(r.out).toContain("switched the main checkout");
    expect(currentBranch(root)).toBe("main");
  });

  it("prints the exact ! command when the sandbox denies a path the switch rewrites", async () => {
    const root = await project();
    git(root, "switch", "-q", "-c", "feature");
    fs.mkdirSync(path.join(root, "locked"));
    fs.writeFileSync(path.join(root, "locked", "file.txt"), "on feature\n");
    git(root, "add", "locked/file.txt");
    git(root, "commit", "-q", "-m", "feature file");
    // Read-only directory: the switch to main would remove locked/file.txt, which this process cannot.
    fs.chmodSync(path.join(root, "locked"), 0o555);
    lockedDirs.push(path.join(root, "locked"));

    const r = status(root, "switch-back");

    expect(r.code).toBe(1);
    expect(r.out).toContain("switch-back SANDBOX-BLOCKED");
    expect(r.out).toContain(`! git -C ${sq(root)} switch main`);
    expect(r.out).toContain("Do NOT retry it from this session");
    expect(currentBranch(root)).toBe("feature");
  });

  it("prints the exact ! command when git refuses the switch, and leaves the checkout unchanged", async () => {
    const root = await project();
    git(root, "switch", "-q", "-c", "feature");
    git(root, "rm", "-q", "app.txt");
    git(root, "commit", "-q", "-m", "drop app.txt on feature");
    // main has app.txt tracked; an untracked app.txt here makes `git switch main` refuse.
    fs.writeFileSync(path.join(root, "app.txt"), "untracked clash\n");

    const r = status(root, "switch-back");

    expect(r.code).toBe(1);
    expect(r.out).toContain("switch-back FAILED");
    expect(r.out).toContain("the main checkout is unchanged on feature");
    expect(r.out).toContain(`! git -C ${sq(root)} switch main`);
    expect(currentBranch(root)).toBe("feature");
    expect(fs.readFileSync(path.join(root, "app.txt"), "utf8")).toBe("untracked clash\n");
  });
});

// ── round 2: the no-branch and empty-branch report rules, commit-message naming (170) ──

/** Commits `file` on the current branch with `msg` and returns the full SHA. */
function commitHere(root: string, file: string, msg: string): string {
  fs.writeFileSync(path.join(root, file), `${msg}\n`);
  git(root, "add", file);
  git(root, "commit", "-q", "-m", msg);
  return git(root, "rev-parse", "HEAD");
}

/** Alternates the case of each hex digit, so the SHA is mixed-case throughout. */
function mixedCase(sha: string): string {
  return [...sha].map((c, i) => (i % 2 ? c.toUpperCase() : c.toLowerCase())).join("");
}

describe("epic report guard, no-branch and empty-branch rules (170 round 2)", () => {
  it("refuses the base commit when the task branch exists but holds no commits of its own", async () => {
    const root = await project();
    git(root, "branch", "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);
    const baseShort = git(root, "rev-parse", "--short", "HEAD");

    const r = epicWithBody(root, `Outcome: done\nCommit ${baseShort}\n`, "report", "--task", "001-a.md", "--file", "-");

    expect(r.code).toBe(1);
    expect(r.out).toContain("report REFUSED");
    expect(r.out).toContain("the task branch task-001 has no commits of its own beyond main");
    expect(r.out).toContain("could be the commit the task started from");
    expect(epic(root, "reports", "e1").out).toContain("no unacknowledged reports");
  });

  it("refuses the base commit when there is no task branch and the message names nothing", async () => {
    const root = await project();
    expect(branchNames(root)).not.toContain("task-002");
    expect(status(root, "done", "002-b.md").code).toBe(0);
    const baseShort = git(root, "rev-parse", "--short", "HEAD");

    const r = epicWithBody(root, `Outcome: done\nCommit ${baseShort}\n`, "report", "--task", "002-b.md", "--file", "-");

    expect(r.code).toBe(1);
    expect(r.out).toContain("there is no task branch task-002");
    expect(r.out).toContain("a commit whose message names task-002 or 002-b.md");
    expect(r.out).toContain("could be the commit the task started from");
  });

  it("accepts the Merge task-NNN commit on main once the task branch is merged and deleted", async () => {
    const root = await project();
    workBranch(root, "task-001");
    git(root, "merge", "-q", "--no-ff", "-m", "Merge task-001 (001-a.md)", "task-001");
    git(root, "branch", "-D", "task-001");
    const mergeSha = git(root, "rev-parse", "--short", "HEAD");
    expect(branchNames(root)).not.toContain("task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);

    const r = epicWithBody(root, `Outcome: done\nCommit ${mergeSha}\n`, "report", "--task", "001-a.md", "--file", "-");

    expect(r.code).toBe(0);
    expect(r.out).toContain("written to");
    expect(epic(root, "reports", "e1").out).toContain("r001");
  });

  it("accepts a squash commit on main whose message names the task file, with no task branch", async () => {
    const root = await project();
    expect(branchNames(root)).not.toContain("task-002");
    const squashSha = commitHere(root, "squash.txt", "feat: squash of 002-b.md");
    expect(status(root, "done", "002-b.md").code).toBe(0);

    const r = epicWithBody(
      root,
      `Outcome: done\nCommit ${squashSha.slice(0, 8)}\n`,
      "report",
      "--task",
      "002-b.md",
      "--file",
      "-"
    );

    expect(r.code).toBe(0);
    expect(r.out).toContain("written to");
  });

  it("does not count a commit naming task-0012 or subtask-001 as naming task-001", async () => {
    const root = await project();
    const longer = commitHere(root, "longer.txt", "feat: task-0012 unrelated");
    const subtask = commitHere(root, "subtask.txt", "fix: subtask-001 unrelated");
    const suffixed = commitHere(root, "suffixed.txt", "chore: task-001x unrelated");
    expect(status(root, "done", "001-a.md").code).toBe(0);

    for (const sha of [longer, subtask, suffixed]) {
      const r = epicWithBody(
        root,
        `Outcome: done\nCommit ${sha.slice(0, 9)}\n`,
        "report",
        "--task",
        "001-a.md",
        "--file",
        "-"
      );
      expect(r.code).toBe(1);
      expect(r.out).toContain("report REFUSED");
      expect(r.out).toContain("is not the `Merge task-001` commit");
    }
    expect(epic(root, "reports", "e1").out).toContain("no unacknowledged reports");
  });

  it("still accepts a commit that names task-001 as a whole word on main", async () => {
    const root = await project();
    const named = commitHere(root, "named.txt", "feat: task-001 hand merge");
    expect(status(root, "done", "001-a.md").code).toBe(0);

    const r = epicWithBody(
      root,
      `Outcome: done\nCommit ${named.slice(0, 9)}\n`,
      "report",
      "--task",
      "001-a.md",
      "--file",
      "-"
    );

    expect(r.code).toBe(0);
  });

  it("accepts a mixed-case SHA that names a commit on the task branch", async () => {
    const root = await project();
    const taskSha = workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);
    // A SHA of only digits would be unchanged by the case mix, so require letters to make it a real test.
    expect(taskSha).toMatch(/[a-f]/);
    const mixed = mixedCase(taskSha);
    expect(mixed).not.toBe(taskSha);
    expect(mixed).toMatch(/[A-F]/);

    const r = epicWithBody(root, `Outcome: done\nCommit ${mixed}\n`, "report", "--task", "001-a.md", "--file", "-");

    expect(r.code).toBe(0);
    expect(r.out).toContain("written to");
  });

  it("refuses a mixed-case SHA of the base commit, the same as its lowercase form", async () => {
    const root = await project();
    workBranch(root, "task-001");
    expect(status(root, "done", "001-a.md").code).toBe(0);
    const baseFull = git(root, "rev-parse", "HEAD");
    expect(baseFull).toMatch(/[a-f]/);
    const mixed = mixedCase(baseFull.slice(0, 12));
    expect(mixed).not.toBe(baseFull.slice(0, 12));

    const r = epicWithBody(root, `Outcome: done\nCommit ${mixed}\n`, "report", "--task", "001-a.md", "--file", "-");

    expect(r.code).toBe(1);
    expect(r.out).toContain(`commit ${mixed.toLowerCase()} is already on main`);
  });
});

describe("SHA candidates in report bodies (170 round 2)", () => {
  it("returns case-insensitive candidates lowercased, and one entry for a SHA written in both cases", () => {
    expect(shaCandidates("A1b2C3d4 and a1B2c3D4 and 0123456789ABCDEF0")).toEqual(["a1b2c3d4", "0123456789abcdef0"]);
  });

  it("rejects fewer than 7 hex characters and hex touching a letter or digit", () => {
    expect(shaCandidates("abc123 and deadbeeX and xdeadbeef")).toEqual([]);
  });
});

describe("switch-back STOPPED PARTWAY offers no ready-to-run discard command (170 round 2)", () => {
  it("prints the status check, not a ! discard command, when git switch fails after moving HEAD", async () => {
    const root = await project();
    git(root, "switch", "-q", "-c", "feature");
    // A post-checkout hook runs after HEAD has moved and exits non-zero, so `git switch main` fails
    // with HEAD on main: the STOPPED PARTWAY path, reached by real git rather than a mock.
    fs.writeFileSync(path.join(root, ".git", "hooks", "post-checkout"), "#!/bin/sh\necho hook refused >&2\nexit 1\n", {
      mode: 0o755,
    });

    const r = status(root, "switch-back");

    expect(r.code).toBe(1);
    expect(r.out).toContain("switch-back STOPPED PARTWAY");
    expect(r.out).toContain("HEAD is now main");
    // The status line is quoted by the script's own shellQuote, so match its shape rather than sq().
    expect(r.out).toMatch(/^\s*! git -C \S+ status$/m);
    expect(r.out).toContain(root.split("/").pop() as string);
    expect(r.out).toContain("the user decides and runs it");
    expect(r.out).not.toMatch(/!\s*git[^\n]*--discard-changes/);
    expect(currentBranch(root)).toBe("main");
  });
});

// ── the land-the-task skill wiring (170) ────────────────────────────────────

describe("land-the-task skill ships and is wired to the guarded scripts (170)", () => {
  const skillPath = path.join(REPO_ROOT, "plugins", "maestro", "skills", "land-the-task", "SKILL.md");

  it("is a published plugin skill that calls the guarded report, merge and switch-back commands", () => {
    const text = fs.readFileSync(skillPath, "utf8");
    expect(text).toMatch(/^---\nname: land-the-task\n/m);
    expect(text).toContain("maestro-epic.cjs");
    expect(text).toContain("maestro-task-status.cjs");
    expect(text).toContain("switch-back");
    expect(text).toContain("merge");
    expect(text).toContain("VERIFY NOT CONFIGURED");
    // The skill's apostrophe is typographic, so match it with a wildcard.
    // The sentence wraps across a line break in the skill, so allow any whitespace there.
    expect(text).toMatch(/Never commit, merge or\s+push without the user.s explicit approval/);
  });

  it("is listed in this repo's end_skills.maestro", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, ".claude", "maestro.json"), "utf8")) as {
      end_skills?: { maestro?: string[] };
    };
    expect(cfg.end_skills?.maestro).toContain("maestro:land-the-task");
  });
});
