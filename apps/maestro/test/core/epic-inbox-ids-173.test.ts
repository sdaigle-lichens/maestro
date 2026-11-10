// `173`: the epic inbox fixes `171` left open, through the REAL installed maestro-epic.cjs.
//
//   * Review ids (mNNN) are allocated like report ids: from the log AND the inbox files, each claimed
//     by an exclusive file create, so a state.json put back to an older copy never reissues one.
//   * The epic-end boundary counts unacknowledged inbox report files the log no longer lists, and
//     names each by its handle.
//
// Same harness as epic-boundary-cli.test.ts: real git repos under os.tmpdir(), HOME pinned,
// CLAUDE_CODE_SESSION_ID set (never inherited).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const SESSION = "sess-173-aaa";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-173-epic-"));
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

function run(root: string, script: string, args: string[], input = "") {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", script), ...args], {
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp, CLAUDE_CODE_SESSION_ID: SESSION },
    input,
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const cli = (root: string, args: string[], input?: string) => run(root, "maestro-epic.cjs", args, input);
const epicDir = (root: string) => path.join(root, ".claude", "epics", "e1");
const statePath = (root: string) => path.join(epicDir(root), "state.json");
const tasksDir = (root: string) => path.join(root, ".claude", "maestro-tasks");
const statusPath = (root: string) => path.join(tasksDir(root), "status.json");
const inboxNames = (root: string) => fs.readdirSync(path.join(epicDir(root), "inbox")).sort();

/** An installed, committed project with epic `e1` (manager end skill `sweep`) holding the tasks. */
async function project(...tasks: string[]): Promise<string> {
  const root = path.join(tmp, "p");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
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
  fs.mkdirSync(tasksDir(root), { recursive: true });
  for (const t of tasks) fs.writeFileSync(path.join(tasksDir(root), t), `# ${t}\n\n## Blocked by\n\nNone\n`);
  expect(run(root, "maestro-task-status.cjs", ["sync"]).code).toBe(0);
  expect(cli(root, ["create", "e1", "--manager", "boss"]).code).toBe(0);
  if (tasks.length) expect(cli(root, ["link", "e1", ...tasks]).code).toBe(0);
  commitAll(root, "init");
  return root;
}

function setDone(root: string, ...tasks: string[]) {
  const map = JSON.parse(fs.readFileSync(statusPath(root), "utf8"));
  for (const t of tasks) map[t] = { ...map[t], status: "done" };
  fs.writeFileSync(statusPath(root), JSON.stringify(map, null, 2));
}

/** Writes `<task stem>.review[-N].md` next to the task file and records the request. */
function reviewRequest(root: string, task: string, round: number) {
  const name = `${task.replace(/\.md$/, "")}.review${round > 1 ? `-${round}` : ""}.md`;
  fs.writeFileSync(path.join(tasksDir(root), name), `# Brief round ${round}\n`);
  return cli(root, ["review-request", "--task", task, "--file", path.join(".claude", "maestro-tasks", name)]);
}

describe("review ids never repeat (173)", () => {
  it("each review request claims its id with an inbox file, so a state.json that lost the entry does not reissue it", async () => {
    const root = await project("001-a.md");
    const first = reviewRequest(root, "001-a.md", 1);
    expect(first.code, first.stderr).toBe(0);
    expect(first.stdout).toContain("review request recorded: m001");
    expect(cli(root, ["review-verdict", "--task", "001-a.md", "redirect"]).code).toBe(0);
    const committed = fs.readFileSync(statePath(root), "utf8"); // what `git commit` captured

    expect(reviewRequest(root, "001-a.md", 2).stdout).toContain("review request recorded: m002");
    // A stash / checkout puts the committed state.json back; the m002 inbox file stays.
    fs.writeFileSync(statePath(root), committed);

    const third = reviewRequest(root, "001-a.md", 3);
    expect(third.code, third.stderr).toBe(0);
    expect(third.stdout).toContain("review request recorded: m003");
    expect(inboxNames(root)).toEqual(["m001-001-a.md", "m002-001-a.md", "m003-001-a.md"]);
    // The pointer file names the brief; the brief itself stays next to the task file.
    expect(fs.readFileSync(path.join(epicDir(root), "inbox", "m003-001-a.md"), "utf8")).toContain(
      "- Review file: .claude/maestro-tasks/001-a.review-3.md"
    );
  });

  it("a review pointer file is never listed as an orphaned report or note", async () => {
    const root = await project("001-a.md");
    expect(reviewRequest(root, "001-a.md", 1).code).toBe(0);
    const show = JSON.parse(cli(root, ["show", "e1", "--json"]).stdout) as {
      unacknowledged: Array<{ id: string; kind: string }>;
    };
    expect(show.unacknowledged.map((e) => `${e.kind} ${e.id}`)).toEqual(["review m001"]);
  });

  it("report ids take the same protection: after a lost log entry the next report takes the next id", async () => {
    const root = await project("001-a.md");
    setDone(root, "001-a.md");
    const sha = commitAll(root, "feat: 001-a.md work").slice(0, 10);
    const before = fs.readFileSync(statePath(root), "utf8");
    expect(cli(root, ["report", "--task", "001-a.md", "--file", "-"], `Verified commit ${sha}`).code).toBe(0);
    fs.writeFileSync(statePath(root), before); // the log lost r001; its file stays

    expect(cli(root, ["report", "--task", "001-a.md", "--file", "-"], `Verified commit ${sha}`).code).toBe(0);
    expect(inboxNames(root)).toEqual(["r001-001-a.md", "r002-001-a.md"]);
  });

  it("a re-sent request for the same open brief writes no second file", async () => {
    const root = await project("001-a.md");
    expect(reviewRequest(root, "001-a.md", 1).code).toBe(0);
    const again = reviewRequest(root, "001-a.md", 1);
    expect(again.stdout).toContain("already recorded");
    expect(inboxNames(root)).toEqual(["m001-001-a.md"]);
  });
});

describe("the epic-end check counts inbox report files the log lost (173)", () => {
  it("is not due while a report file the log no longer lists is unacknowledged, and is due after its ack", async () => {
    const root = await project("001-a.md", "002-b.md");
    setDone(root, "001-a.md", "002-b.md");
    const sha = commitAll(root, "feat: 001-a.md work").slice(0, 10);
    const before = fs.readFileSync(statePath(root), "utf8");
    expect(cli(root, ["report", "--task", "001-a.md", "--file", "-"], `Verified commit ${sha}`).code).toBe(0);
    fs.writeFileSync(statePath(root), before); // the log lost r001; its file stays

    const end = cli(root, ["boundary", "e1", "end"]);
    expect(end.stdout).toContain("not due: not acknowledged: r001");

    expect(cli(root, ["ack", "e1", "r001"]).code).toBe(0);
    expect(cli(root, ["boundary", "e1", "end"]).stdout).toContain("run sweep");
  });

  it("names both reports by their handles when two share an id", async () => {
    const root = await project("001-a.md", "002-b.md");
    setDone(root, "001-a.md", "002-b.md");
    const sha = commitAll(root, "feat: 001-a.md and 002-b.md work").slice(0, 10);
    const before = fs.readFileSync(statePath(root), "utf8");
    expect(cli(root, ["report", "--task", "001-a.md", "--file", "-"], `Verified commit ${sha}`).code).toBe(0);
    fs.writeFileSync(statePath(root), before);
    // A pre-`171` writer reissued r001 for the other task (the incident): two files, one id.
    const inbox = path.join(epicDir(root), "inbox");
    fs.writeFileSync(
      path.join(inbox, "r001-002-b.md"),
      `# Report r001: 002-b.md\n\n- Task: 002-b.md\n- Written: 2099-01-01T00:00:00.000Z\n\nbody\n`
    );

    const end = cli(root, ["boundary", "e1", "end"]);
    expect(end.stdout).toContain("not due: not acknowledged: r001-001, r001-002");

    expect(cli(root, ["ack", "e1", "r001-001"]).code).toBe(0);
    expect(cli(root, ["boundary", "e1", "end"]).stdout).toContain("not due: not acknowledged: r001-002");
    expect(cli(root, ["ack", "e1", "r001-002"]).code).toBe(0);
    expect(cli(root, ["boundary", "e1", "end"]).stdout).toContain("run sweep");
  });
});
