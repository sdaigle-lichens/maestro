// `146`: inside an epic a blocker satisfies its dependent only when it is done AND merged. Proven on
// BOTH implementations of the cascade with the same fixtures (src/core/tasks.ts and the hand-written
// twin plugins/maestro/scripts/lib/maestro-tasks.cjs), then through readyTasks and the real
// maestro-task-status.cjs / maestro-epic.cjs commands.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { listTasks, closeTask, tasksDirFor, readTaskTracker } from "../../src/core/tasks.js";
import { readyTasks, formatReady } from "../../src/core/epics.js";
import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const nodeRequire = createRequire(import.meta.url);
const twin = nodeRequire(path.join(PLUGIN_ROOT, "scripts", "lib", "maestro-tasks.cjs")) as {
  buildStatusMap: (root: string, done: Set<string>, previous?: object, unmerged?: Set<string>) => StatusMap;
  markDone: (root: string, file: string, opts?: { unmerged?: boolean }) => { map: StatusMap; marked: boolean };
  markMerged: (root: string, file: string) => { map: StatusMap; known: boolean; done: boolean; cleared: boolean };
  sync: (root: string) => StatusMap;
};

type StatusMap = Record<string, { status: string; blockedBy: string[]; epic?: string; unmerged?: true }>;

let tmp: string;
let root: string;
let dir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-146-"));
  root = path.join(tmp, "p");
  dir = tasksDirFor(root);
  fs.mkdirSync(dir, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeTask(name: string, blockedBy: string[] = []) {
  const refs = blockedBy.length ? blockedBy.map((b) => `- \`${b}\``).join("\n") : "None";
  fs.writeFileSync(path.join(dir, name), `# ${name}\n\n## Blocked by\n\n${refs}\n`);
}

function writeStatus(map: object) {
  fs.writeFileSync(path.join(dir, "status.json"), JSON.stringify(map, null, 2));
}
const readStatus = (): StatusMap => JSON.parse(fs.readFileSync(path.join(dir, "status.json"), "utf8"));

/** The shared fixture: 001 done+unmerged, 002 in epic e1 blocked by 001, 003 outside any epic blocked by 001. */
function fixture(unmerged: boolean) {
  writeTask("001-a.md");
  writeTask("002-b.md", ["001-a.md"]);
  writeTask("003-c.md", ["001-a.md"]);
  writeStatus({
    "001-a.md": { status: "done", blockedBy: [], epic: "e1", ...(unmerged ? { unmerged: true } : {}) },
    "002-b.md": { status: "blocked", blockedBy: ["001-a.md"], epic: "e1" },
    "003-c.md": { status: "blocked", blockedBy: ["001-a.md"] },
  });
}

describe("tasks.ts (the app)", () => {
  it("keeps an epic task blocked on a done-but-unmerged blocker and names it", () => {
    fixture(true);
    const tasks = Object.fromEntries(listTasks(root).map((t) => [t.filename, t]));
    expect(tasks["002-b.md"].status).toBe("blocked");
    expect(tasks["002-b.md"].unmergedBlockers).toEqual(["001-a.md"]);
  });

  it("a task outside an epic unblocks exactly as before", () => {
    fixture(true);
    const after = closeTask(root, "001-a.md");
    const byName = Object.fromEntries(after.map((t) => [t.filename, t]));
    expect(byName["003-c.md"].status).toBe("ready");
    expect(byName["003-c.md"].unmergedBlockers).toEqual([]);
    expect(byName["002-b.md"].status).toBe("blocked");
    // the rebuild preserved the flag; the UI close never sets one
    expect(readStatus()["001-a.md"].unmerged).toBe(true);
  });

  it("an entry without the flag reads as merged (legacy status.json needs no edit)", () => {
    fixture(false);
    const after = closeTask(root, "001-a.md");
    expect(after.find((t) => t.filename === "002-b.md")?.status).toBe("ready");
    expect(readStatus()["001-a.md"].unmerged).toBeUndefined();
  });

  it("closeTask never marks a task unmerged", () => {
    writeTask("001-a.md");
    closeTask(root, "001-a.md");
    expect(readStatus()["001-a.md"]).toEqual({ status: "done", blockedBy: [] });
  });

  it("a blocker whose file is gone is satisfied even in an epic", () => {
    writeTask("002-b.md", ["001-a.md"]);
    writeStatus({ "002-b.md": { status: "blocked", blockedBy: ["001-a.md"], epic: "e1" } });
    const after = closeTask(root, "002-b.md");
    expect(after[0].status).toBe("done");
    writeTask("003-c.md", ["009-gone.md"]);
    writeStatus({ "002-b.md": readStatus()["002-b.md"], "003-c.md": { status: "blocked", blockedBy: [], epic: "e1" } });
    expect(closeTask(root, "002-b.md").find((t) => t.filename === "003-c.md")?.status).toBe("ready");
  });

  it("a stale tracker `ready` does not outlive an unmerged blocker", () => {
    fixture(true);
    const map = readStatus();
    map["002-b.md"].status = "ready";
    writeStatus(map);
    expect(listTasks(root).find((t) => t.filename === "002-b.md")?.status).toBe("blocked");
  });

  it("exposes unmerged to the epic module through readTaskTracker", () => {
    fixture(true);
    expect(readTaskTracker(root)["001-a.md"].unmerged).toBe(true);
    expect(readTaskTracker(root)["002-b.md"].unmerged).toBe(false);
  });
});

describe("maestro-tasks.cjs (the orchestrator twin) agrees on the same fixtures", () => {
  it("keeps the epic task blocked while the blocker is unmerged; outside an epic it is ready", () => {
    fixture(true);
    const map = twin.sync(root);
    expect(map["002-b.md"].status).toBe("blocked");
    expect(map["003-c.md"].status).toBe("ready");
    expect(map["001-a.md"].unmerged).toBe(true);
    expect(map["001-a.md"].epic).toBe("e1");
  });

  it("legacy entries (no flag) read as merged", () => {
    fixture(false);
    expect(twin.sync(root)["002-b.md"].status).toBe("ready");
  });

  it("markDone with { unmerged } sets the flag; without it never does", () => {
    writeTask("001-a.md");
    writeTask("002-b.md", ["001-a.md"]);
    writeTask("003-c.md");
    writeStatus({
      "001-a.md": { status: "ready", blockedBy: [] },
      "002-b.md": { status: "blocked", blockedBy: ["001-a.md"], epic: "e1" },
      "003-c.md": { status: "ready", blockedBy: [] },
    });
    const first = twin.markDone(root, "001-a.md", { unmerged: true });
    expect(first.map["001-a.md"]).toMatchObject({ status: "done", unmerged: true });
    expect(first.map["002-b.md"].status).toBe("blocked");
    const second = twin.markDone(root, "003-c.md");
    expect(second.map["003-c.md"].unmerged).toBeUndefined();
    expect(second.map["001-a.md"].unmerged).toBe(true); // preserved by the rebuild
  });

  it("markMerged clears the flag, recomputes the cascade and refuses a task that is not done", () => {
    fixture(true);
    const refused = twin.markMerged(root, "002-b.md");
    expect(refused).toMatchObject({ done: false, known: true });
    expect(readStatus()["002-b.md"].status).toBe("blocked");

    const merged = twin.markMerged(root, "001-a.md");
    expect(merged).toMatchObject({ done: true, cleared: true });
    expect(merged.map["001-a.md"].unmerged).toBeUndefined();
    expect(merged.map["002-b.md"].status).toBe("ready");

    expect(twin.markMerged(root, "001-a.md")).toMatchObject({ done: true, cleared: false });
    expect(twin.markMerged(root, "099-nope.md")).toMatchObject({ done: false, known: false });
  });

  it("both implementations produce the same status map for the same fixture", () => {
    fixture(true);
    const fromTwin = twin.sync(root);
    fs.rmSync(path.join(dir, "status.json"));
    fixture(true);
    closeTask(root, "001-a.md"); // rebuild through tasks.ts
    expect(readStatus()).toEqual(fromTwin);
  });
});

describe("readyTasks (epics.ts)", () => {
  function epicFixture() {
    fs.mkdirSync(path.join(root, ".claude", "epics", "e1"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".claude", "epics", "e1", "state.json"),
      JSON.stringify({ slug: "e1", manager: null, workers: [], log: [] })
    );
  }

  it("does not list an epic task whose blocker is done but unmerged, and says why", () => {
    fixture(true);
    epicFixture();
    const view = readyTasks(root, "e1");
    expect(view.ready.map((t) => t.filename)).toEqual([]);
    expect(view.waitingOnMerge).toEqual([{ filename: "002-b.md", unmergedBlockers: ["001-a.md"] }]);
    const text = formatReady(view);
    expect(text).toContain("002-b.md  waiting on merge: 001-a.md");
  });

  it("lists it once the blocker is merged", () => {
    fixture(true);
    epicFixture();
    twin.markMerged(root, "001-a.md");
    const view = readyTasks(root, "e1");
    expect(view.ready.map((t) => t.filename)).toEqual(["002-b.md"]);
    expect(view.waitingOnMerge).toEqual([]);
  });

  it("legacy done blocker (no flag) is ready as before", () => {
    fixture(false);
    epicFixture();
    twin.sync(root);
    expect(readyTasks(root, "e1").ready.map((t) => t.filename)).toEqual(["002-b.md"]);
  });
});

describe("the real commands: done / mark-merged / merge", () => {
  const SESSION = "sess-146-aaa";
  let project: string;

  async function installed(): Promise<string> {
    const p = path.join(tmp, "proj");
    fs.mkdirSync(p, { recursive: true });
    execFileSync("git", ["init", "-q", "-b", "main"], { cwd: p });
    writeConfig(p, defaultish);
    await installRuntime(
      p,
      PLUGIN_ROOT,
      path.join(tmp, "report-defaults.sqlite"),
      path.join(tmp, "project-tags.sqlite"),
      path.join(tmp, "handoff-defaults.sqlite")
    );
    return p;
  }

  function cli(script: string, args: string[]) {
    const res = spawnSync("node", [path.join(project, ".claude", "scripts", script), ...args], {
      encoding: "utf8",
      env: {
        ...process.env,
        CLAUDE_PROJECT_DIR: project,
        HOME: tmp,
        CLAUDE_CODE_SESSION_ID: SESSION,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@t",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@t",
      },
    });
    return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
  }
  const projStatus = () =>
    JSON.parse(fs.readFileSync(path.join(project, ".claude", "maestro-tasks", "status.json"), "utf8")) as StatusMap;

  async function setup() {
    project = await installed();
    const tdir = path.join(project, ".claude", "maestro-tasks");
    fs.mkdirSync(tdir, { recursive: true });
    fs.writeFileSync(path.join(tdir, "001-a.md"), "# a\n\n## Blocked by\n\nNone\n");
    fs.writeFileSync(path.join(tdir, "002-b.md"), "# b\n\n## Blocked by\n\n- `001-a.md`\n");
    expect(cli("maestro-task-status.cjs", ["sync"]).code).toBe(0);
    expect(cli("maestro-epic.cjs", ["create", "e1"]).code).toBe(0);
    expect(cli("maestro-epic.cjs", ["link", "e1", "001-a.md", "002-b.md"]).code).toBe(0);
  }

  function pointAtWorktree(wt: string, branch: string) {
    const sdir = path.join(project, ".claude", "maestro_sessions", SESSION);
    fs.mkdirSync(sdir, { recursive: true });
    fs.writeFileSync(path.join(sdir, "log.jsonl"), '{"kind":"tool_call"}\n');
    fs.writeFileSync(
      path.join(sdir, "worktree.json"),
      JSON.stringify({ path: wt, branch, task: "001-a.md", main_root: project })
    );
  }

  it("done outside a worktree leaves the dependent ready; mark-merged refuses a task that is not done", async () => {
    await setup();
    expect(cli("maestro-task-status.cjs", ["mark-merged", "001-a.md"]).code).toBe(1);
    expect(cli("maestro-task-status.cjs", ["done", "001-a.md"]).code).toBe(0);
    expect(projStatus()["001-a.md"].unmerged).toBeUndefined();
    expect(projStatus()["002-b.md"].status).toBe("ready");
  });

  it("done in a worktree marks it unmerged and blocks the epic dependent until mark-merged", async () => {
    await setup();
    const wt = path.join(tmp, "wt");
    fs.mkdirSync(wt, { recursive: true });
    pointAtWorktree(wt, "task-001");

    const done = cli("maestro-task-status.cjs", ["done", "001-a.md"]);
    expect(done.code).toBe(0);
    expect(done.stdout).toContain("NOT merged");
    expect(projStatus()["001-a.md"]).toMatchObject({ status: "done", unmerged: true });
    expect(projStatus()["002-b.md"].status).toBe("blocked");

    const ready = cli("maestro-epic.cjs", ["ready", "e1"]);
    expect(ready.stdout).toContain("002-b.md  waiting on merge: 001-a.md");

    const marked = cli("maestro-task-status.cjs", ["mark-merged", "001"]);
    expect(marked.code).toBe(0);
    expect(projStatus()["001-a.md"].unmerged).toBeUndefined();
    expect(projStatus()["002-b.md"].status).toBe("ready");
  });

  it("merge clears the flag after the git merge and the dependent becomes ready", async () => {
    await setup();
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
    fs.writeFileSync(path.join(project, ".gitignore"), ".claude/\n");
    fs.writeFileSync(path.join(project, "README.md"), "x\n");
    git(project, "add", ".gitignore", "README.md");
    git(project, "commit", "-q", "-m", "init");
    const wt = path.join(tmp, "proj-task-001");
    git(project, "worktree", "add", "-q", "-b", "task-001", wt);
    fs.writeFileSync(path.join(wt, "feature.txt"), "work\n");
    git(wt, "add", "feature.txt");
    git(wt, "commit", "-q", "-m", "work");
    pointAtWorktree(wt, "task-001");

    expect(cli("maestro-task-status.cjs", ["done", "001-a.md"]).code).toBe(0);
    expect(projStatus()["002-b.md"].status).toBe("blocked");

    const merged = cli("maestro-task-status.cjs", ["merge", "001-a.md"]);
    expect(merged.stdout).toContain("merged task-001");
    expect(merged.code).toBe(0);
    expect(fs.existsSync(path.join(project, "feature.txt"))).toBe(true);
    expect(projStatus()["001-a.md"].unmerged).toBeUndefined();
    expect(projStatus()["002-b.md"].status).toBe("ready");
  });

  it("a conflicting merge leaves the flag set and the epic dependent blocked", async () => {
    await setup();
    const git = (cwd: string, ...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], { cwd, encoding: "utf8" });
    fs.writeFileSync(path.join(project, ".gitignore"), ".claude/\n");
    fs.writeFileSync(path.join(project, "shared.txt"), "base\n");
    git(project, "add", ".gitignore", "shared.txt");
    git(project, "commit", "-q", "-m", "init");
    const wt = path.join(tmp, "proj-task-001");
    git(project, "worktree", "add", "-q", "-b", "task-001", wt);
    fs.writeFileSync(path.join(wt, "shared.txt"), "from task\n");
    git(wt, "commit", "-q", "-am", "task change");
    fs.writeFileSync(path.join(project, "shared.txt"), "from main\n");
    git(project, "commit", "-q", "-am", "main change");
    pointAtWorktree(wt, "task-001");

    expect(cli("maestro-task-status.cjs", ["done", "001-a.md"]).code).toBe(0);
    const merged = cli("maestro-task-status.cjs", ["merge", "001-a.md"]);
    expect(merged.code).not.toBe(0);
    expect(projStatus()["001-a.md"]).toMatchObject({ status: "done", unmerged: true });
    expect(projStatus()["002-b.md"].status).toBe("blocked");
    expect(git(project, "status", "--porcelain")).not.toContain("UU");
  });

  it("done in a freeform worktree does not set unmerged", async () => {
    await setup();
    const wt = path.join(tmp, "wt-free");
    fs.mkdirSync(wt, { recursive: true });
    pointAtWorktree(wt, "freeform-sess");
    const sdir = path.join(project, ".claude", "maestro_sessions", SESSION);
    fs.writeFileSync(
      path.join(sdir, "worktree.json"),
      JSON.stringify({ path: wt, branch: "freeform-sess", main_root: project, freeform: true })
    );
    cli("maestro-task-status.cjs", ["done", "001-a.md"]);
    expect(projStatus()["001-a.md"].status).toBe("done");
    expect(projStatus()["001-a.md"].unmerged).toBeUndefined();
    expect(projStatus()["002-b.md"].status).toBe("ready");
  });

  it("mark-merged without an argument or on an unknown task exits 1", async () => {
    await setup();
    expect(cli("maestro-task-status.cjs", ["mark-merged"]).code).toBe(1);
    expect(cli("maestro-task-status.cjs", ["mark-merged", "099-nope.md"]).code).toBe(1);
  });
});

describe("edge cases on both implementations", () => {
  it("a task joining an epic after its blocker was done+unmerged is blocked on the next sync (twin) and in listTasks", () => {
    writeTask("001-a.md");
    writeTask("002-b.md", ["001-a.md"]);
    writeStatus({
      "001-a.md": { status: "done", blockedBy: [], unmerged: true },
      "002-b.md": { status: "ready", blockedBy: ["001-a.md"] },
    });
    expect(twin.sync(root)["002-b.md"].status).toBe("ready"); // no epic yet: plain rule
    const map = readStatus();
    map["002-b.md"].epic = "e1";
    writeStatus(map);
    expect(listTasks(root).find((t) => t.filename === "002-b.md")?.status).toBe("blocked");
    expect(twin.sync(root)["002-b.md"].status).toBe("blocked");
  });

  it("a deleted unmerged blocker no longer blocks an epic task, on both", () => {
    writeTask("002-b.md", ["001-a.md"]);
    writeStatus({
      "001-a.md": { status: "done", blockedBy: [], epic: "e1", unmerged: true },
      "002-b.md": { status: "blocked", blockedBy: ["001-a.md"], epic: "e1" },
    });
    expect(twin.sync(root)["002-b.md"].status).toBe("ready");
    expect(listTasks(root).find((t) => t.filename === "002-b.md")?.unmergedBlockers).toEqual([]);
  });

  it("the unmerged flag on a not-done task is dropped by both rebuilds", () => {
    writeTask("001-a.md");
    writeStatus({ "001-a.md": { status: "ready", blockedBy: [], unmerged: true } });
    expect(twin.sync(root)["001-a.md"].unmerged).toBeUndefined();
  });

  it("readyTasks: a task with one unmerged and one not-done blocker is neither ready nor waitingOnMerge", () => {
    writeTask("001-a.md");
    writeTask("002-b.md");
    writeTask("003-c.md", ["001-a.md", "002-b.md"]);
    writeStatus({
      "001-a.md": { status: "done", blockedBy: [], epic: "e1", unmerged: true },
      "002-b.md": { status: "ready", blockedBy: [], epic: "e1" },
      "003-c.md": { status: "blocked", blockedBy: ["001-a.md", "002-b.md"], epic: "e1" },
    });
    fs.mkdirSync(path.join(root, ".claude", "epics", "e1"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".claude", "epics", "e1", "state.json"),
      JSON.stringify({ slug: "e1", manager: null, workers: [], log: [] })
    );
    const view = readyTasks(root, "e1");
    expect(view.ready.map((t) => t.filename)).toEqual(["002-b.md"]);
    expect(view.waitingOnMerge).toEqual([]);
  });
});
