// `boundary <slug> start|end [--force]` through the REAL installed CLI, spawned against temp
// projects as a manager session would run it, with real git repositories. Same harness rules as
// epics-cli.test.ts: HOME pinned, CLAUDE_CODE_SESSION_ID always set, never inherited.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const SESSION = "sess-boundary-1";
const NONE = "nothing to run";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-boundary-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(root: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
    cwd: root,
    encoding: "utf8",
  }).trim();
}

function commitAll(root: string, message: string): string {
  git(root, "add", "-A");
  git(root, "commit", "-q", "--allow-empty", "-m", message);
  return git(root, "rev-parse", "HEAD");
}

interface Lists {
  start?: string[];
  end?: string[];
}

/**
 * An installed project with the given manager lists, one commit and the epic `e1`. `nested` puts
 * the project at `sub/proj` inside its repository, as a monorepo app with its own config sits.
 */
async function project(
  lists: Lists = { start: ["scan"], end: ["sweep"] },
  opts: { repo?: boolean; nested?: boolean } = {}
) {
  const repo = path.join(tmp, "p");
  const root = opts.nested ? path.join(repo, "sub", "proj") : repo;
  fs.mkdirSync(root, { recursive: true });
  if (opts.repo !== false) execFileSync("git", ["init", "-q"], { cwd: repo });
  writeConfig(root, {
    ...defaultish,
    start_skills: { maestro: [], to_maestro_tasks: [], maestro_manager: lists.start ?? [] },
    end_skills: { maestro: [], maestro_manager: lists.end ?? [] },
  });
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  if (opts.repo !== false) commitAll(repo, "init");
  expect(cli(root, ["create", "e1"]).code).toBe(0);
  return root;
}

function run(root: string, script: string, args: string[], input = "") {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", script), ...args], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp, CLAUDE_CODE_SESSION_ID: SESSION },
    input,
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const cli = (root: string, args: string[], input?: string) => run(root, "maestro-epic.cjs", args, input);
const boundary = (root: string, phase: string, ...flags: string[]) => cli(root, ["boundary", "e1", phase, ...flags]);

/** The same CLI spawned without waiting, so several callers can race on one epic. */
function cliAsync(root: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [path.join(root, ".claude", "scripts", "maestro-epic.cjs"), ...args], {
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp, CLAUDE_CODE_SESSION_ID: SESSION },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

const epicDir = (root: string) => path.join(root, ".claude", "epics", "e1");
const statePath = (root: string) => path.join(epicDir(root), "state.json");
const state = (root: string) => JSON.parse(fs.readFileSync(statePath(root), "utf8"));
const tasksDir = (root: string) => path.join(root, ".claude", "maestro-tasks");
const statusPath = (root: string) => path.join(tasksDir(root), "status.json");

/** Writes the task files, syncs the tracker and links them to `e1`. `surfaces` become the section. */
function addTasks(root: string, tasks: Record<string, string[] | null>) {
  fs.mkdirSync(tasksDir(root), { recursive: true });
  for (const [name, surfaces] of Object.entries(tasks)) {
    const section = surfaces ? `## Touched surfaces\n\n${surfaces.map((s) => `- ${s}`).join("\n")}\n\n` : "";
    fs.writeFileSync(path.join(tasksDir(root), name), `# ${name}\n\n${section}## Blocked by\n\nNone\n`);
  }
  expect(run(root, "maestro-task-status.cjs", ["sync"]).code).toBe(0);
  expect(cli(root, ["link", "e1", ...Object.keys(tasks)]).code).toBe(0);
}

function setTask(root: string, task: string, patch: Record<string, unknown>) {
  const map = JSON.parse(fs.readFileSync(statusPath(root), "utf8"));
  map[task] = { ...map[task], ...patch };
  fs.writeFileSync(statusPath(root), JSON.stringify(map, null, 2));
}

function write(root: string, rel: string, content = "x\n") {
  fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
  fs.writeFileSync(path.join(root, rel), content);
}

/** The scope file named on a `run` line, and its path count as printed. */
function scopeOf(stdout: string): { file: string; lines: string[]; count: number } {
  const m = /with scope file (.+) \((\d+) paths\)\n$/.exec(stdout);
  if (!m) throw new Error(`not a run line: ${stdout}`);
  const text = fs.readFileSync(m[1], "utf8");
  return { file: m[1], lines: text.split("\n").filter(Boolean), count: Number(m[2]) };
}

function ranBoundary(root: string, phase: string) {
  return fs.existsSync(path.join(epicDir(root), "boundary", `${phase}-1`));
}

describe("boundary: arguments", () => {
  it("exits 1 on an unknown epic, a bad phase and a missing phase, and writes nothing", async () => {
    const root = await project();
    expect(cli(root, ["boundary", "nope", "start"]).code).toBe(1);
    expect(cli(root, ["boundary", "../x", "start"]).code).toBe(1);
    expect(boundary(root, "middle").code).toBe(1);
    expect(cli(root, ["boundary", "e1"]).code).toBe(1);
    expect(state(root).boundaries).toBeUndefined();
  });

  it("accepts --force before the phase too", async () => {
    const root = await project();
    addTasks(root, { "001-a.md": null });
    expect(cli(root, ["boundary", "e1", "--force", "start"]).stdout).toContain("run scan");
  });
});

describe("boundary: nothing configured", () => {
  it("reports nothing to run for both phases, whatever the flags, and writes nothing", async () => {
    const root = await project({});
    addTasks(root, { "001-a.md": null });
    const before = fs.readFileSync(statePath(root), "utf8");
    for (const args of [["start"], ["end"], ["start", "--force"], ["end", "--force"]]) {
      const r = boundary(root, args[0], ...args.slice(1));
      expect(r.code).toBe(0);
      expect(r.stdout).toContain(NONE);
    }
    expect(fs.readFileSync(statePath(root), "utf8")).toBe(before);
    expect(fs.existsSync(path.join(epicDir(root), "boundary"))).toBe(false);
  });

  it("still exits 1 on an unknown epic", async () => {
    const root = await project({});
    expect(cli(root, ["boundary", "nope", "end"]).code).toBe(1);
  });
});

describe("boundary start: due once, just before the first spawn", () => {
  it("runs once with the skills in order, then reports it already ran, without moving the base", async () => {
    const root = await project({ start: ["b:two", "a-one"] });
    write(root, "src/a.ts");
    const head = commitAll(root, "code");
    addTasks(root, { "001-a.md": ["src/a.ts"] });

    const first = boundary(root, "start");
    expect(first.code).toBe(0);
    expect(first.stdout).toContain("run b:two, a-one with scope file");
    expect(first.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(state(root).boundaries.base).toBe(head);
    expect(scopeOf(first.stdout).file).toBe(path.join(epicDir(root), "boundary", "start-1", "scope.txt"));

    commitAll(root, "later");
    const second = boundary(root, "start");
    expect(second.code).toBe(0);
    expect(second.stdout).toContain(`already ran at ${state(root).boundaries.start.at}`);
    expect(state(root).boundaries.base).toBe(head);
    expect(ranBoundary(root, "start")).toBe(true);
    expect(fs.existsSync(path.join(epicDir(root), "boundary", "start-2"))).toBe(false);
  });

  it("is already-ran on resume, once workers exist", async () => {
    const root = await project();
    addTasks(root, { "001-a.md": null });
    boundary(root, "start");
    cli(root, ["add-worker", "e1", "w1", "--task", "001-a.md"]);
    expect(boundary(root, "start").stdout).toContain("already ran");
  });

  it("is not due with no tasks, and is due once they are linked", async () => {
    const root = await project();
    const r = boundary(root, "start");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("not due: the epic has no tasks yet");
    expect(state(root).boundaries?.start).toBeUndefined();
    addTasks(root, { "001-a.md": null });
    expect(boundary(root, "start").stdout).toContain("run scan");
  });

  it("is not due on an already-running epic: a recorded worker", async () => {
    const root = await project();
    addTasks(root, { "001-a.md": null });
    cli(root, ["add-worker", "e1", "w1"]);
    expect(boundary(root, "start").stdout).toContain("not due: the epic already has workers");
    expect(ranBoundary(root, "start")).toBe(false);
  });

  it("is not due on an already-running epic: a live claim, not a stale one", async () => {
    const root = await project();
    addTasks(root, { "001-a.md": null, "002-b.md": null });
    const sessionDir = path.join(root, ".claude", "maestro_sessions", SESSION);
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, "log.jsonl"), '{"kind":"tool_call"}\n');
    expect(run(root, "maestro-task-status.cjs", ["claim", "001-a.md"]).code).toBe(0);
    expect(boundary(root, "start").stdout).toContain("not due: already running: 001-a.md");
  });

  it("is not due with a done task", async () => {
    const root = await project();
    addTasks(root, { "001-a.md": null, "002-b.md": null });
    setTask(root, "002-b.md", { status: "done" });
    expect(boundary(root, "start").stdout).toContain("not due: already done: 002-b.md");
    expect(state(root).boundaries?.base).toBeUndefined();
  });
});

describe("boundary end: due once the epic is finished", () => {
  async function finished(lists?: Lists) {
    const root = await project(lists);
    addTasks(root, { "001-a.md": ["README.md"], "002-b.md": null });
    setTask(root, "001-a.md", { status: "done" });
    setTask(root, "002-b.md", { status: "done" });
    return root;
  }

  it("is not due with no tasks", async () => {
    const root = await project();
    expect(boundary(root, "end").stdout).toContain("not due: the epic has no tasks");
  });

  it("is not due while a task is not done", async () => {
    const root = await finished();
    setTask(root, "002-b.md", { status: "ready" });
    expect(boundary(root, "end").stdout).toContain("not due: not done: 002-b.md");
  });

  it("is not due while a done task is unmerged, and is due after the merge", async () => {
    const root = await finished();
    setTask(root, "001-a.md", { unmerged: true });
    expect(boundary(root, "end").stdout).toContain("not due: not merged: 001-a.md");
    setTask(root, "001-a.md", { unmerged: false });
    expect(boundary(root, "end").stdout).toContain("run sweep");
  });

  it("is not due with an unacknowledged report, and is due after the ack", async () => {
    const root = await finished();
    // `170`: a done task's report must name its commit; with no task branch, a default-branch commit
    // whose message names the task.
    const sha = commitAll(root, "feat: 001-a.md work").slice(0, 10);
    expect(cli(root, ["report", "--task", "001-a.md", "--file", "-"], `Verified commit ${sha}`).code).toBe(0);
    expect(boundary(root, "end").stdout).toContain("not due: not acknowledged: r001");
    cli(root, ["ack", "e1", "r001"]);
    expect(boundary(root, "end").stdout).toContain("run sweep");
  });

  it("is not due with an unacknowledged note", async () => {
    const root = await finished();
    cli(root, ["create", "other"]);
    expect(cli(root, ["note", "e1", "--from-epic", "other", "--file", "-"], "body").code).toBe(0);
    expect(boundary(root, "end").stdout).toContain("not due: not acknowledged: n001");
  });

  it("does not wait for a manager review request", async () => {
    const root = await finished();
    write(root, ".claude/maestro-tasks/001-a.review.md", "brief");
    const request = cli(root, [
      "review-request",
      "--task",
      "001-a.md",
      "--file",
      ".claude/maestro-tasks/001-a.review.md",
    ]);
    expect(request.code).toBe(0);
    expect(boundary(root, "end").stdout).toContain("run sweep");
  });

  it("runs once; tasks added afterwards need --force", async () => {
    const root = await finished();
    expect(boundary(root, "end").stdout).toContain("run sweep");
    expect(boundary(root, "end").stdout).toContain("already ran");

    addTasks(root, { "003-c.md": null });
    expect(boundary(root, "end").stdout).toContain("already ran");
    const forced = boundary(root, "end", "--force");
    expect(forced.stdout).toContain("run sweep");
    expect(scopeOf(forced.stdout).file).toBe(path.join(epicDir(root), "boundary", "end-2", "scope.txt"));
  });
});

describe("boundary --force", () => {
  it("can't start a boundary that was never due", async () => {
    const root = await project();
    expect(boundary(root, "start", "--force").stdout).toContain("not due");
    addTasks(root, { "001-a.md": null });
    expect(boundary(root, "end", "--force").stdout).toContain("not due");
    expect(fs.existsSync(path.join(epicDir(root), "boundary"))).toBe(false);
  });

  it("re-runs a claimed start in a new folder, keeps the base and the earlier output", async () => {
    const root = await project();
    write(root, "src/a.ts");
    const base = commitAll(root, "code");
    addTasks(root, { "001-a.md": ["src/a.ts"] });
    const first = scopeOf(boundary(root, "start").stdout);
    write(path.dirname(first.file), "scan.md", "first output");
    cli(root, ["add-worker", "e1", "w1"]);

    write(root, "src/b.ts");
    commitAll(root, "more");
    const forced = scopeOf(boundary(root, "start", "--force").stdout);
    expect(forced.file).toBe(path.join(epicDir(root), "boundary", "start-2", "scope.txt"));
    expect(forced.lines).toEqual(["src/a.ts"]);
    expect(state(root).boundaries.base).toBe(base);
    expect(fs.readFileSync(path.join(path.dirname(first.file), "scan.md"), "utf8")).toBe("first output");

    setTask(root, "001-a.md", { status: "done" });
    expect(scopeOf(boundary(root, "end").stdout).lines).toContain("src/b.ts");
  });
});

describe("boundary scope", () => {
  it("start: bare and backticked paths only, sorted and de-duplicated, existing files only", async () => {
    const root = await project();
    write(root, "src/a.ts");
    write(root, "src/b.ts");
    write(root, "src/c.ts");
    write(root, "src/noted.ts");
    write(root, "routes/[id].tsx");
    addTasks(root, {
      "001-a.md": [
        "src/b.ts",
        "`src/a.ts`",
        "./src/c.ts",
        "src/noted.ts (version)",
        "`src/noted.ts` and its mirror",
        "src/*.ts",
        "src/**",
        "src",
        "src/",
        "src/missing.ts",
        "../p/src/a.ts",
        "src/../src/a.ts",
        path.join(root, "src", "a.ts"),
        "routes/[id].tsx",
        "the settings page",
      ],
      "002-b.md": ["src/a.ts"],
      "003-old.md": null,
    });
    const scope = scopeOf(boundary(root, "start").stdout);
    expect(scope.lines).toEqual(["routes/[id].tsx", "src/a.ts", "src/b.ts", "src/c.ts"]);
    expect(scope.count).toBe(4);
  });

  it("start: a claimed run with no paths still writes an empty scope file", async () => {
    const root = await project();
    addTasks(root, { "001-a.md": null });
    const scope = scopeOf(boundary(root, "start").stdout);
    expect(scope.count).toBe(0);
    expect(fs.readFileSync(scope.file, "utf8")).toBe("");
  });

  it("end: the existing files changed since the base on the merged result, in no task's surfaces", async () => {
    const root = await project();
    write(root, "keep.ts");
    write(root, "gone.ts");
    write(root, "touched-only.ts");
    commitAll(root, "code");
    addTasks(root, { "001-a.md": ["touched-only.ts"] });
    boundary(root, "start");

    write(root, "keep.ts", "changed\n");
    write(root, "new file.ts");
    write(root, "uncommitted.ts", "not in the diff\n");
    fs.rmSync(path.join(root, "gone.ts"));
    fs.rmSync(path.join(root, "uncommitted.ts"));
    commitAll(root, "merged work");
    write(root, "uncommitted.ts");
    setTask(root, "001-a.md", { status: "done" });

    const scope = scopeOf(boundary(root, "end").stdout);
    expect(scope.lines.filter((l) => !l.startsWith(".claude/"))).toEqual(["keep.ts", "new file.ts"]);
  });

  it("end: no recorded commit falls back to Touched surfaces", async () => {
    const root = await project();
    write(root, "src/a.ts");
    commitAll(root, "code");
    addTasks(root, { "001-a.md": ["src/a.ts", "src/missing.ts"] });
    cli(root, ["add-worker", "e1", "w1"]);
    expect(boundary(root, "start").stdout).toContain("not due");
    setTask(root, "001-a.md", { status: "done" });
    expect(scopeOf(boundary(root, "end").stdout).lines).toEqual(["src/a.ts"]);
  });

  it("end: an unreachable base falls back to Touched surfaces", async () => {
    const root = await project();
    write(root, "src/a.ts");
    commitAll(root, "code");
    addTasks(root, { "001-a.md": ["src/a.ts"] });
    boundary(root, "start");
    const s = state(root);
    s.boundaries.base = "0123456789012345678901234567890123456789";
    fs.writeFileSync(statePath(root), JSON.stringify(s));
    setTask(root, "001-a.md", { status: "done" });
    expect(scopeOf(boundary(root, "end").stdout).lines).toEqual(["src/a.ts"]);
  });

  it("end: a project nested in its repository gets paths relative to the git root, and only its own", async () => {
    const root = await project(undefined, { nested: true });
    const repo = path.dirname(path.dirname(root));
    write(root, "src/a.ts");
    write(root, "same-name.ts");
    write(repo, "same-name.ts");
    commitAll(repo, "code");
    addTasks(root, { "001-a.md": ["src/a.ts"] });
    expect(scopeOf(boundary(root, "start").stdout).lines).toEqual(["sub/proj/src/a.ts"]);

    write(root, "src/a.ts", "changed\n");
    write(root, "src/new.ts");
    write(repo, "same-name.ts", "changed outside the project\n");
    commitAll(repo, "merged work");
    setTask(root, "001-a.md", { status: "done" });

    const scope = scopeOf(boundary(root, "end").stdout);
    expect(scope.lines.filter((l) => !l.startsWith("sub/proj/.claude/"))).toEqual([
      "sub/proj/src/a.ts",
      "sub/proj/src/new.ts",
    ]);
    expect(scope.lines.every((l) => l.startsWith("sub/proj/"))).toBe(true);
    expect(scope.count).toBe(scope.lines.length);
  });

  it("end: a nested project user's diff.relative setting does not change the paths", async () => {
    const root = await project(undefined, { nested: true });
    const repo = path.dirname(path.dirname(root));
    git(repo, "config", "diff.relative", "true");
    write(root, "src/a.ts");
    commitAll(repo, "code");
    addTasks(root, { "001-a.md": ["src/a.ts"] });
    boundary(root, "start");
    write(root, "src/a.ts", "changed\n");
    commitAll(repo, "merged work");
    setTask(root, "001-a.md", { status: "done" });
    const scope = scopeOf(boundary(root, "end").stdout);
    expect(scope.lines.filter((l) => !l.startsWith("sub/proj/.claude/"))).toEqual(["sub/proj/src/a.ts"]);
  });

  it("end: a rename across the nested project's edge counts only on its inside end", async () => {
    const root = await project(undefined, { nested: true });
    const repo = path.dirname(path.dirname(root));
    write(root, "src/leaving.ts", "leaving the project\nline two\nline three\n");
    write(repo, "arriving.ts", "arriving in the project\nline two\nline three\n");
    write(root, "src/stay.ts", "stay\n");
    commitAll(repo, "code");
    addTasks(root, { "001-a.md": ["src/stay.ts"] });
    boundary(root, "start");

    git(repo, "mv", "sub/proj/src/leaving.ts", "left.ts");
    git(repo, "mv", "arriving.ts", "sub/proj/src/arrived.ts");
    commitAll(repo, "renames");
    setTask(root, "001-a.md", { status: "done" });

    const scope = scopeOf(boundary(root, "end").stdout);
    expect(scope.lines.filter((l) => !l.startsWith("sub/proj/.claude/"))).toEqual(["sub/proj/src/arrived.ts"]);
  });

  it("start: a nested project resolves each entry against the project, then the git root", async () => {
    const root = await project(undefined, { nested: true });
    const repo = path.dirname(path.dirname(root));
    write(root, "src/a.ts");
    write(root, "src/b.ts");
    write(root, "same-name.ts");
    write(repo, "same-name.ts");
    write(repo, "top-only.ts");
    write(repo, "other/c.ts");
    commitAll(repo, "code");
    addTasks(root, {
      "001-a.md": [
        "src/a.ts",
        "same-name.ts",
        "top-only.ts",
        "other/c.ts",
        "sub/proj/src/b.ts",
        "sub/proj",
        "src/missing.ts",
        "../../top-only.ts",
        "../same-name.ts",
        path.join(repo, "top-only.ts"),
        "other/*.ts",
      ],
    });
    const scope = scopeOf(boundary(root, "start").stdout);
    expect(scope.lines).toEqual([
      "other/c.ts",
      "sub/proj/same-name.ts",
      "sub/proj/src/a.ts",
      "sub/proj/src/b.ts",
      "top-only.ts",
    ]);
    expect(scope.count).toBe(5);
  });

  it("prints the scope file as an absolute path when the project root comes in relative", async () => {
    const root = await project(undefined, { nested: true });
    const repo = path.dirname(path.dirname(root));
    write(root, "src/a.ts");
    commitAll(repo, "code");
    addTasks(root, { "001-a.md": ["src/a.ts"] });
    const script = path.join(root, ".claude", "scripts", "maestro-epic.cjs");
    // A relative CLAUDE_PROJECT_DIR, then no CLAUDE_PROJECT_DIR at all (the cwd): runs 1 and 2.
    const calls: [string, string | undefined][] = [
      [repo, "sub/proj"],
      [root, undefined],
    ];
    for (const [i, [cwd, dir]] of calls.entries()) {
      const env: NodeJS.ProcessEnv = { ...process.env, HOME: tmp, CLAUDE_CODE_SESSION_ID: SESSION };
      if (dir) env.CLAUDE_PROJECT_DIR = dir;
      else delete env.CLAUDE_PROJECT_DIR;
      const res = spawnSync("node", [script, "boundary", "e1", "start", "--force"], { cwd, env, encoding: "utf8" });
      expect(res.status).toBe(0);
      const scope = scopeOf(res.stdout);
      expect(path.isAbsolute(scope.file)).toBe(true);
      expect(fs.realpathSync(scope.file)).toBe(
        fs.realpathSync(path.join(epicDir(root), "boundary", `start-${i + 1}`, "scope.txt"))
      );
      expect(scope.lines).toEqual(["sub/proj/src/a.ts"]);
    }
  });

  it("end: a nested project whose base is unreachable falls back to its Touched surfaces", async () => {
    const root = await project(undefined, { nested: true });
    const repo = path.dirname(path.dirname(root));
    write(root, "src/a.ts");
    write(repo, "same-name.ts");
    commitAll(repo, "code");
    addTasks(root, { "001-a.md": ["src/a.ts", "src/missing.ts"] });
    boundary(root, "start");
    const s = state(root);
    s.boundaries.base = "0123456789012345678901234567890123456789";
    fs.writeFileSync(statePath(root), JSON.stringify(s));

    write(repo, "same-name.ts", "changed outside the project\n");
    commitAll(repo, "merged work");
    setTask(root, "001-a.md", { status: "done" });

    const scope = scopeOf(boundary(root, "end").stdout);
    expect(scope.lines).toEqual(["sub/proj/src/a.ts"]);
    expect(scope.count).toBe(1);
  });

  it("a non-git project claims both boundaries on the Touched surfaces rule", async () => {
    const root = await project(undefined, { repo: false });
    write(root, "src/a.ts");
    addTasks(root, { "001-a.md": ["src/a.ts"] });
    expect(scopeOf(boundary(root, "start").stdout).lines).toEqual(["src/a.ts"]);
    expect(state(root).boundaries.base).toBeUndefined();
    setTask(root, "001-a.md", { status: "done" });
    expect(scopeOf(boundary(root, "end").stdout).lines).toEqual(["src/a.ts"]);
  });
});

describe("boundary: an empty start list with an end list configured", () => {
  it("records the base at the start moment, runs nothing and claims nothing, so the end scope works", async () => {
    const root = await project({ end: ["sweep"] });
    write(root, "a.ts");
    const base = commitAll(root, "code");
    addTasks(root, { "001-a.md": null });

    const r = boundary(root, "start");
    expect(r.code).toBe(0);
    expect(r.stdout).toContain(NONE);
    expect(state(root).boundaries).toEqual({ base });
    expect(ranBoundary(root, "start")).toBe(false);

    write(root, "a.ts", "changed\n");
    commitAll(root, "work");
    setTask(root, "001-a.md", { status: "done" });
    expect(scopeOf(boundary(root, "end").stdout).lines).toContain("a.ts");
  });

  it("records no base when the start moment has passed", async () => {
    const root = await project({ end: ["sweep"] });
    addTasks(root, { "001-a.md": null });
    cli(root, ["add-worker", "e1", "w1"]);
    expect(boundary(root, "start").stdout).toContain(NONE);
    expect(state(root).boundaries?.base).toBeUndefined();
  });

  it("an empty end list with a start list reports nothing to run and leaves the end unclaimed", async () => {
    const root = await project({ start: ["scan"] });
    addTasks(root, { "001-a.md": null });
    setTask(root, "001-a.md", { status: "done" });
    expect(boundary(root, "end").stdout).toContain(NONE);
    expect(state(root).boundaries).toBeUndefined();
  });
});

describe("boundary: claim and state", () => {
  it("records nothing when the scope can't be written, and the retry still runs", async () => {
    const root = await project();
    addTasks(root, { "001-a.md": null });
    write(root, ".claude/epics/e1/boundary", "a file where the folder goes");
    const failed = boundary(root, "start");
    expect(failed.code).toBe(1);
    expect(state(root).boundaries).toBeUndefined();

    fs.rmSync(path.join(epicDir(root), "boundary"));
    expect(boundary(root, "start").stdout).toContain("run scan");
  });

  it("survives every later state write", async () => {
    const root = await project();
    addTasks(root, { "001-a.md": null });
    boundary(root, "start");
    const before = state(root).boundaries;
    expect(before.start.at).toBeTruthy();

    cli(root, ["add-worker", "e1", "w1", "--task", "001-a.md"]);
    cli(root, ["set-manager", "e1", "boss"]);
    cli(root, ["report", "--task", "001-a.md", "--file", "-"], "body");
    cli(root, ["ack", "e1", "r001"]);
    cli(root, ["remove-worker", "e1", "w1"]);

    expect(state(root).boundaries).toEqual(before);
    expect(boundary(root, "start").stdout).toContain("already ran");
  });

  it("survives link, unlink, note, review-request and review-verdict too", async () => {
    const root = await project();
    addTasks(root, { "001-a.md": null, "002-b.md": null });
    expect(boundary(root, "start").stdout).toContain("run scan");
    const before = state(root).boundaries;

    cli(root, ["create", "other"]);
    expect(cli(root, ["link", "e1", "002-b.md"]).code).toBe(0);
    expect(cli(root, ["unlink", "002-b.md"]).code).toBe(0);
    expect(cli(root, ["note", "e1", "--from-epic", "other", "--file", "-"], "body").code).toBe(0);
    write(root, ".claude/maestro-tasks/001-a.review.md", "brief");
    expect(
      cli(root, ["review-request", "--task", "001-a.md", "--file", ".claude/maestro-tasks/001-a.review.md"]).code
    ).toBe(0);
    expect(cli(root, ["review-verdict", "--task", "001-a.md", "on-track"]).code).toBe(0);

    expect(state(root).boundaries).toEqual(before);
    expect(boundary(root, "start").stdout).toContain("already ran");
  });
});

describe("boundary: the claim is atomic", () => {
  it("concurrent start callers: exactly one runs, the rest see the claim, one folder", async () => {
    const root = await project();
    write(root, "src/a.ts");
    commitAll(root, "code");
    addTasks(root, { "001-a.md": ["src/a.ts"] });

    const results = await Promise.all(Array.from({ length: 8 }, () => cliAsync(root, ["boundary", "e1", "start"])));
    expect(results.map((r) => r.code)).toEqual(Array(8).fill(0));
    const runs = results.filter((r) => r.stdout.includes("run scan with scope file"));
    const ran = results.filter((r) => r.stdout.includes("already ran at"));
    expect(runs).toHaveLength(1);
    expect(ran).toHaveLength(7);
    for (const r of ran) expect(r.stdout).toContain(`already ran at ${state(root).boundaries.start.at}`);
    expect(fs.readdirSync(path.join(epicDir(root), "boundary"))).toEqual(["start-1"]);
    expect(scopeOf(runs[0].stdout).lines).toEqual(["src/a.ts"]);
  });

  it("concurrent end callers: exactly one runs, one folder", async () => {
    const root = await project();
    addTasks(root, { "001-a.md": null });
    setTask(root, "001-a.md", { status: "done" });

    const results = await Promise.all(Array.from({ length: 8 }, () => cliAsync(root, ["boundary", "e1", "end"])));
    expect(results.map((r) => r.code)).toEqual(Array(8).fill(0));
    expect(results.filter((r) => r.stdout.includes("run sweep with scope file"))).toHaveLength(1);
    expect(results.filter((r) => r.stdout.includes("already ran at"))).toHaveLength(7);
    expect(fs.readdirSync(path.join(epicDir(root), "boundary"))).toEqual(["end-1"]);
  });

  it("no end claim is left when the scope folder can't be created, and the retry runs", async () => {
    const root = await project();
    addTasks(root, { "001-a.md": null });
    setTask(root, "001-a.md", { status: "done" });
    write(root, ".claude/epics/e1/boundary", "a file where the folder goes");
    expect(boundary(root, "end").code).toBe(1);
    expect(state(root).boundaries).toBeUndefined();

    fs.rmSync(path.join(epicDir(root), "boundary"));
    expect(boundary(root, "end").stdout).toContain("run sweep");
  });
});

describe("boundary: a stale claim does not count as running", () => {
  it("a claim whose session directory is gone does not hold the start", async () => {
    const root = await project();
    addTasks(root, { "001-a.md": null });
    expect(run(root, "maestro-task-status.cjs", ["claim", "001-a.md"]).code).toBe(0);
    expect(boundary(root, "start").stdout).toContain("run scan");
  });
});

describe("boundary scope: edge cases", () => {
  it("start: ignores tasks of another epic and tasks linked to no epic", async () => {
    const root = await project();
    write(root, "src/mine.ts");
    write(root, "src/theirs.ts");
    write(root, "src/loose.ts");
    addTasks(root, { "001-a.md": ["src/mine.ts"] });
    cli(root, ["create", "e2"]);
    write(root, ".claude/maestro-tasks/010-other.md", "# other\n\n## Touched surfaces\n\n- src/theirs.ts\n");
    write(root, ".claude/maestro-tasks/020-loose.md", "# loose\n\n## Touched surfaces\n\n- src/loose.ts\n");
    expect(run(root, "maestro-task-status.cjs", ["sync"]).code).toBe(0);
    expect(cli(root, ["link", "e2", "010-other.md"]).code).toBe(0);

    expect(scopeOf(boundary(root, "start").stdout).lines).toEqual(["src/mine.ts"]);
  });

  it("end: nothing changed since the base is a run with zero paths and an empty file", async () => {
    const root = await project();
    write(root, "a.ts");
    commitAll(root, "code");
    addTasks(root, { "001-a.md": ["a.ts"] });
    boundary(root, "start");
    setTask(root, "001-a.md", { status: "done" });

    const scope = scopeOf(boundary(root, "end").stdout);
    expect(scope.count).toBe(0);
    expect(fs.readFileSync(scope.file, "utf8")).toBe("");
  });

  it("end: a recorded base that is not a commit id never reaches git, and falls back to Touched surfaces", async () => {
    const root = await project();
    write(root, "src/a.ts");
    commitAll(root, "code");
    addTasks(root, { "001-a.md": ["src/a.ts"] });
    boundary(root, "start");
    const pwned = path.join(tmp, "pwned.txt");
    const s = state(root);
    s.boundaries.base = `--output=${pwned}`;
    fs.writeFileSync(statePath(root), JSON.stringify(s));
    write(root, "src/b.ts");
    commitAll(root, "more");
    setTask(root, "001-a.md", { status: "done" });

    expect(scopeOf(boundary(root, "end").stdout).lines).toEqual(["src/a.ts"]);
    expect(fs.existsSync(pwned)).toBe(false);
  });
});

describe("boundary: one line for every outcome", () => {
  it.each([
    ["none", () => project({})],
    ["not-due", () => project()],
  ])("prints a single newline-terminated line for %s", async (_name, make) => {
    const root = await make();
    const r = boundary(root, "start");
    expect(r.code).toBe(0);
    expect(r.stdout.endsWith("\n")).toBe(true);
    expect(r.stdout.trimEnd().split("\n")).toHaveLength(1);
  });

  it("prints a single line for already-ran and for a run", async () => {
    const root = await project();
    addTasks(root, { "001-a.md": null });
    const ran = boundary(root, "start");
    expect(ran.stdout.trimEnd().split("\n")).toHaveLength(1);
    const again = boundary(root, "start");
    expect(again.stdout).toContain("already ran");
    expect(again.stdout.trimEnd().split("\n")).toHaveLength(1);
  });
});

describe("boundary: the mechanism names no skill", () => {
  it("the command, the manager skill and the core module contain no skill-specific name", () => {
    const files = [
      path.join(here, "..", "..", "src", "core", "epic-boundary.ts"),
      path.join(here, "..", "..", "src", "core", "plugin-entries", "maestro-epic.ts"),
      path.join(PLUGIN_ROOT, "scripts", "maestro-epic.cjs"),
      path.join(PLUGIN_ROOT, "skills", "maestro-manager", "SKILL.md"),
    ];
    for (const file of files) {
      expect(fs.readFileSync(file, "utf8"), file).not.toMatch(/scout|refactor|code-graph/i);
    }
  });

  it("the manager skill calls the boundary command for start and end", () => {
    const skill = fs.readFileSync(path.join(PLUGIN_ROOT, "skills", "maestro-manager", "SKILL.md"), "utf8");
    expect(skill).toContain("boundary <slug> start");
    expect(skill).toContain("boundary <slug> end");
  });
});

describe("boundary scope: a linked worktree and a symlinked project", () => {
  it("a linked worktree as the project: the epic, tasks and scope are the main checkout's", async () => {
    const repo = await project();
    write(repo, "src/a.ts");
    commitAll(repo, "code");
    const wt = path.join(tmp, "wt");
    execFileSync("git", ["worktree", "add", "-q", "-b", "wt1", wt], { cwd: repo });
    write(wt, "src/a.ts", "changed in the worktree\n");
    write(wt, "src/wt-only.ts");
    commitAll(wt, "worktree work");
    addTasks(repo, { "001-a.md": ["src/a.ts", "src/wt-only.ts"] });

    // The CLI spawned from inside the worktree, as a manager session in that worktree would run it.
    const fromWorktree = (args: string[]) => {
      const res = spawnSync("node", [path.join(repo, ".claude", "scripts", "maestro-epic.cjs"), ...args], {
        cwd: wt,
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: wt, HOME: tmp, CLAUDE_CODE_SESSION_ID: SESSION },
      });
      return { code: res.status ?? -1, stdout: res.stdout ?? "" };
    };

    const start = fromWorktree(["boundary", "e1", "start"]);
    expect(start.code).toBe(0);
    const startScope = scopeOf(start.stdout);
    expect(path.isAbsolute(startScope.file)).toBe(true);
    expect(fs.realpathSync(startScope.file)).toBe(
      fs.realpathSync(path.join(epicDir(repo), "boundary", "start-1", "scope.txt"))
    );
    // Only the main checkout's files: src/wt-only.ts exists on the worktree branch alone.
    expect(startScope.lines).toEqual(["src/a.ts"]);

    git(repo, "merge", "-q", "--no-edit", "wt1");
    setTask(repo, "001-a.md", { status: "done" });
    const end = fromWorktree(["boundary", "e1", "end"]);
    expect(end.code).toBe(0);
    const endScope = scopeOf(end.stdout);
    expect(fs.realpathSync(endScope.file)).toBe(
      fs.realpathSync(path.join(epicDir(repo), "boundary", "end-1", "scope.txt"))
    );
    expect(endScope.lines.filter((l) => !l.startsWith(".claude/"))).toEqual(["src/a.ts", "src/wt-only.ts"]);
  });

  it("a nested project reached through a symlink gets the same repo-relative paths", async () => {
    const root = await project(undefined, { nested: true });
    const repo = path.dirname(path.dirname(root));
    write(root, "src/a.ts");
    commitAll(repo, "code");
    addTasks(root, { "001-a.md": ["src/a.ts"] });
    const link = path.join(tmp, "link");
    fs.symlinkSync(root, link, "dir");

    const scope = scopeOf(boundary(link, "start").stdout);
    expect(scope.lines).toEqual(["sub/proj/src/a.ts"]);
    expect(fs.realpathSync(scope.file)).toBe(
      fs.realpathSync(path.join(epicDir(root), "boundary", "start-1", "scope.txt"))
    );
  });
});
