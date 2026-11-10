// `173` QA round 2: the nested layout (a Maestro project one directory below the git top level), through
// the REAL installed scripts in real git repositories under os.tmpdir(). Nothing mocked. HOME is pinned
// to a temp dir and CLAUDE_CODE_SESSION_ID is deleted (never inherited), as in landing-guards-173.test.ts.
//
// Each test is one condition edge of the round-1 fix (project prefix from `git rev-parse --show-prefix`,
// `ls-files --full-name` for untracked paths):
//   * merge + switch-back with the project below the top level (tracker, state files, overwrite naming)
//   * the untracked-path note and its exclusion of Maestro's state
//   * a Maestro state file that is only modified locally (exempt) vs an outer-repo state-looking dir (not)
//   * a locally modified epic file the branch also changes, named with its top-relative path
//   * an untracked file on the branch that collides with the main checkout's untracked copy
//   * switch-back with a read-only tracked path under the nested project
//   * review ids and the epic-end check in a nested project

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
const SESSION = "sess-173-nested";

let tmp: string;
let home: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-173-nest-")));
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

function run(root: string, script: string, args: string[], input = "") {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", script), ...args], {
    encoding: "utf8",
    env: pinnedEnv(home, { ...GIT_IDENTITY, CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: SESSION }),
    input,
  });
  return { code: res.status ?? -1, out: `${res.stdout ?? ""}${res.stderr ?? ""}`, stdout: res.stdout ?? "" };
}

const status = (root: string, ...args: string[]) => run(root, "maestro-task-status.cjs", args);
const cli = (root: string, args: string[], input?: string) => run(root, "maestro-epic.cjs", args, input);
const trackerPath = (root: string) => path.join(root, ".claude", "maestro-tasks", "status.json");
const tracker = (root: string) =>
  JSON.parse(fs.readFileSync(trackerPath(root), "utf8")) as Record<string, { status: string }>;
const branches = (root: string) => git(root, "branch", "--format=%(refname:short)").split("\n").filter(Boolean);
const epicDir = (root: string) => path.join(root, ".claude", "epics", "e1");
const statePath = (root: string) => path.join(epicDir(root), "state.json");

/**
 * The project one directory below the git top level: `<tmp>/outer` is the repository, `<tmp>/outer/sub`
 * the Maestro project, with tasks 001 and 002 in epic `e1` and everything committed on main.
 */
async function nestedProject(opts: { tasks?: string[]; epic?: boolean } = {}): Promise<{ repo: string; root: string }> {
  const { tasks = ["001-a.md", "002-b.md"], epic = true } = opts;
  const repo = path.join(tmp, "outer");
  const root = path.join(repo, "sub");
  fs.mkdirSync(root, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  writeConfig(root, {
    ...defaultish,
    start_skills: { maestro: [], to_maestro_tasks: [], maestro_manager: [] },
    end_skills: { maestro: [], maestro_manager: ["sweep"] },
  });
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
  for (const t of tasks) fs.writeFileSync(path.join(dir, t), `# ${t}\n\n## Blocked by\n\nNone\n`);
  expect(run(root, "maestro-task-status.cjs", ["sync"]).code).toBe(0);
  if (epic) {
    expect(cli(root, ["create", "e1", "--manager", "boss"]).code).toBe(0);
    if (tasks.length) expect(cli(root, ["link", "e1", ...tasks]).code).toBe(0);
  }
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "init");
  return { repo, root };
}

/** Task 001 worked in the nested main checkout: branch task-001 with `files`, marked done there, switched back. */
function workedInNestedCheckout(repo: string, root: string, files: Record<string, string>) {
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

describe("nested layout: merge lands and names files relative to the git top (173 round 2)", () => {
  it("lands the task after switch-back when a Maestro state file is only modified locally (exempt)", async () => {
    const { repo, root } = await nestedProject();
    workedInNestedCheckout(repo, root, { "a.txt": "a\n" });
    // Maestro's own epic state under the nested project, changed locally on main: not dirt.
    fs.appendFileSync(path.join(epicDir(root), "EPIC.md"), "\nlocal note\n");

    const r = status(root, "merge", "001-a.md");

    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("merged task-001 into main");
    expect(tracker(root)["001-a.md"]?.status).toBe("done");
  });

  it("still refuses an outer-repo file that merely looks like Maestro state (not under the project)", async () => {
    const { repo, root } = await nestedProject();
    workedInNestedCheckout(repo, root, { "a.txt": "a\n" });
    // A tracked file under the TOP level's .claude/maestro-tasks is not the project's tracker.
    fs.mkdirSync(path.join(repo, ".claude", "maestro-tasks"), { recursive: true });
    fs.writeFileSync(path.join(repo, ".claude", "maestro-tasks", "stray.json"), "{}\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "outer stray");
    fs.writeFileSync(path.join(repo, ".claude", "maestro-tasks", "stray.json"), '{"changed":true}\n');

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain("uncommitted changes to 1 tracked path(s) (e.g. .claude/maestro-tasks/stray.json)");
    expect(branches(root)).toContain("task-001");
  });

  it("names a locally modified epic file the branch also changes by its top-relative path, and the printed stash command resolves it", async () => {
    const { repo, root } = await nestedProject();
    const epicMd = "sub/.claude/epics/e1/EPIC.md";
    workedInNestedCheckout(repo, root, { ".claude/epics/e1/EPIC.md": "# e1\n\nedited on the branch\n" });
    fs.appendFileSync(path.join(epicDir(root), "EPIC.md"), "\nnote from a live manager\n");

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain(`${epicMd} — DIFFERENT from task-001's copy`);
    expect(r.out).toContain(`git -C ${repo} stash push -m 'before merging task-001' -- ${epicMd}`);
    const cmd = /^\s+(git -C .+ stash push .+)$/m.exec(r.out)?.[1];
    expect(cmd, r.out).toBeTruthy();
    execFileSync("sh", ["-c", cmd as string], { cwd: repo, stdio: "pipe" });

    const again = status(root, "merge", "001-a.md");
    expect(again.code, again.out).toBe(0);
    expect(git(repo, "stash", "list")).toContain("before merging task-001");
  });

  it("names a locally modified file the branch changes with the path from the top level (sub/app.txt)", async () => {
    const { repo, root } = await nestedProject();
    workedInNestedCheckout(repo, root, { "app.txt": "from the branch\n" });
    fs.writeFileSync(path.join(root, "app.txt"), "regenerated locally\n");

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain("sub/app.txt — DIFFERENT from task-001's copy");
    expect(r.out).toContain(`git -C ${repo} stash push -m 'before merging task-001' -- sub/app.txt`);
    expect(fs.readFileSync(path.join(root, "app.txt"), "utf8")).toBe("regenerated locally\n");
  });

  it("notes an untracked project file, and never lists Maestro's untracked state under the project", async () => {
    const { repo, root } = await nestedProject();
    workedInNestedCheckout(repo, root, { "a.txt": "a\n" });
    fs.writeFileSync(path.join(root, "loose.txt"), "not tracked\n");
    fs.mkdirSync(path.join(epicDir(root), "inbox"), { recursive: true });
    fs.writeFileSync(path.join(epicDir(root), "inbox", "zz-untracked.md"), "untracked review file\n");

    const r = status(root, "merge", "001-a.md");

    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("the main checkout also holds 1 untracked path(s) (e.g. sub/loose.txt)");
    expect(r.out).not.toContain("zz-untracked");
  });

  it("refuses an untracked file the branch also carries, naming it (the 083 collision check, nested)", async () => {
    const { repo, root } = await nestedProject();
    git(repo, "switch", "-q", "-c", "task-001");
    fs.writeFileSync(path.join(root, "new.txt"), "from the branch\n");
    expect(status(root, "done", "001-a.md").code).toBe(0);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "A (task 001)");
    expect(status(root, "switch-back").code).toBe(0);
    // The same path appears untracked in the main checkout (a background tool wrote it).
    fs.writeFileSync(path.join(root, "new.txt"), "a different local copy\n");

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toContain("untracked file(s) in the main checkout");
    expect(r.out).toMatch(/new\.txt — DIFFERENT from task-001's copy/);
    expect(fs.readFileSync(path.join(root, "new.txt"), "utf8")).toBe("a different local copy\n");
    expect(branches(root)).toContain("task-001");
  });

  it("says an untracked file identical to the branch's copy is identical, nested (same bytes, safe to delete)", async () => {
    const { repo, root } = await nestedProject();
    git(repo, "switch", "-q", "-c", "task-001");
    fs.writeFileSync(path.join(root, "new.txt"), "from the branch\n");
    expect(status(root, "done", "001-a.md").code).toBe(0);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "A (task 001)");
    expect(status(root, "switch-back").code).toBe(0);
    // A background tool wrote the very same bytes into the untracked path.
    fs.writeFileSync(path.join(root, "new.txt"), "from the branch\n");

    const r = status(root, "merge", "001-a.md");

    expect(r.code).toBe(1);
    expect(r.out).toMatch(/new\.txt — identical to task-001's copy \(safe to delete\)/);
  });

  it("switch-back refuses with SANDBOX-BLOCKED when a tracked path under the nested project is read-only", async () => {
    const { repo, root } = await nestedProject();
    // The task branch adds ro/x.txt, so switching back to main must DELETE it (an unlink needs the
    // directory writable; an in-place overwrite would not, so the probe has to be a deletion).
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

  it("control: the same read-only deletion is caught at the top level (the harness itself is sound)", async () => {
    const repo = path.join(tmp, "flat");
    fs.mkdirSync(repo, { recursive: true });
    git(repo, "init", "-q", "-b", "main");
    writeConfig(repo, defaultish);
    await installRuntime(
      repo,
      PLUGIN_ROOT,
      path.join(tmp, "report-defaults.sqlite"),
      path.join(tmp, "project-tags.sqlite"),
      path.join(tmp, "handoff-defaults.sqlite")
    );
    fs.writeFileSync(path.join(repo, "app.txt"), "main\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "init");
    git(repo, "switch", "-q", "-c", "task-001");
    fs.mkdirSync(path.join(repo, "ro"));
    fs.writeFileSync(path.join(repo, "ro", "x.txt"), "branch\n");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "branch adds ro/x.txt");
    fs.chmodSync(path.join(repo, "ro"), 0o555);
    try {
      const r = status(repo, "switch-back");
      expect(r.out).toContain("SANDBOX-BLOCKED");
      expect(r.out).toContain("ro/x.txt");
    } finally {
      fs.chmodSync(path.join(repo, "ro"), 0o755);
    }
  });
});

describe("nested layout: review ids and the epic-end check (173 round 2)", () => {
  it("never reissues a review id when the log lost an entry, in a nested project", async () => {
    const { root } = await nestedProject({ tasks: ["001-a.md"] });
    const req = (round: number) => {
      const name = `001-a.review${round > 1 ? `-${round}` : ""}.md`;
      fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", name), `# Brief ${round}\n`);
      return cli(root, ["review-request", "--task", "001-a.md", "--file", path.join(".claude", "maestro-tasks", name)]);
    };
    expect(req(1).stdout).toContain("review request recorded: m001");
    expect(cli(root, ["review-verdict", "--task", "001-a.md", "redirect"]).code).toBe(0);
    const committed = fs.readFileSync(statePath(root), "utf8");
    expect(req(2).stdout).toContain("review request recorded: m002");
    fs.writeFileSync(statePath(root), committed); // the log lost m002; its inbox file stays

    expect(req(3).stdout).toContain("review request recorded: m003");
    expect(fs.readdirSync(path.join(epicDir(root), "inbox")).sort()).toEqual([
      "m001-001-a.md",
      "m002-001-a.md",
      "m003-001-a.md",
    ]);
  });

  it("the epic-end check counts an unacknowledged report file the log lost, in a nested project", async () => {
    const { repo, root } = await nestedProject({ tasks: ["001-a.md"] });
    expect(status(root, "done", "001-a.md").code).toBe(0);
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "feat: 001-a.md work");
    const sha = git(repo, "rev-parse", "--short=10", "HEAD");
    const before = fs.readFileSync(statePath(root), "utf8");
    expect(cli(root, ["report", "--task", "001-a.md", "--file", "-"], `Verified commit ${sha}`).code).toBe(0);
    fs.writeFileSync(statePath(root), before); // the log lost r001; its file stays

    expect(cli(root, ["boundary", "e1", "end"]).stdout).toContain("not due: not acknowledged: r001");
    expect(cli(root, ["ack", "e1", "r001"]).code).toBe(0);
    expect(cli(root, ["boundary", "e1", "end"]).stdout).toContain("run sweep");
  });
});
