// `171`: epic report ids are unique within an inbox, and an ack addresses exactly one entry.
//
// Driven through the REAL installed maestro-epic.cjs, spawned against temp projects as a session
// would run it. The duplicate `r009` this task fixes came from a `state.json` that lost its latest
// entry while the report file stayed in the inbox (the epic state is committed, so a stash, checkout
// or merge in the main checkout puts an older one back); the next writer then reused the id. Same
// harness rules as epics-cli.test.ts: HOME pinned, CLAUDE_CODE_SESSION_ID always set, never inherited.

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
const SESSION = "sess-171-aaa";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-171-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function env(root: string): NodeJS.ProcessEnv {
  return { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp, CLAUDE_CODE_SESSION_ID: SESSION };
}

function run(root: string, script: string, args: string[], input = "") {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", script), ...args], {
    encoding: "utf8",
    env: env(root),
    input,
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const epic = (root: string, args: string[], input?: string) => run(root, "maestro-epic.cjs", args, input);
const epicDir = (root: string, slug = "e1") => path.join(root, ".claude", "epics", slug);
const statePath = (root: string, slug = "e1") => path.join(epicDir(root, slug), "state.json");
const stateOf = (root: string, slug = "e1") => JSON.parse(fs.readFileSync(statePath(root, slug), "utf8"));
const unacked = (root: string) =>
  JSON.parse(epic(root, ["show", "e1", "--json"]).stdout).unacknowledged as Array<{
    id: string;
    task: string;
    handle?: string;
  }>;

async function project(...tasks: string[]): Promise<string> {
  const root = path.join(tmp, "p");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeConfig(root, defaultish);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  const dir = path.join(root, ".claude", "maestro-tasks");
  fs.mkdirSync(dir, { recursive: true });
  for (const t of tasks) fs.writeFileSync(path.join(dir, t), `# ${t}\n\n## Blocked by\n\nNone\n`);
  expect(run(root, "maestro-task-status.cjs", ["sync"]).code).toBe(0);
  expect(epic(root, ["create", "e1", "--manager", "boss"]).code).toBe(0);
  if (tasks.length) expect(epic(root, ["link", "e1", ...tasks]).code).toBe(0);
  return root;
}

/** A report file as `writeReport` lays it out, for an inbox that predates `171`. */
function writeReportFile(root: string, id: string, task: string, at: string, from?: string): string {
  const rel = `inbox/${id}-${task.replace(/\.md$/, "")}.md`;
  fs.mkdirSync(path.join(epicDir(root), "inbox"), { recursive: true });
  fs.writeFileSync(
    path.join(epicDir(root), rel),
    `# Report ${id}: ${task}\n\n- Task: ${task}\n- Written: ${at}\n${from ? `- From session: ${from}\n` : ""}\nbody of ${task}\n`
  );
  return rel;
}

describe("report ids never repeat (171)", () => {
  it("back-to-back reports for two tasks get different ids", async () => {
    const root = await project("166-a.md", "167-b.md");
    const first = epic(root, ["report", "--task", "166-a.md"], "one");
    const second = epic(root, ["report", "--task", "167-b.md"], "two");
    expect(first.stdout).toContain("report r001 ");
    expect(second.stdout).toContain("report r002 ");
    expect(
      stateOf(root)
        .log.filter((e: { kind: string }) => e.kind === "report")
        .map((e: { id: string }) => e.id)
    ).toEqual(["r001", "r002"]);
  });

  it("a state.json put back to an older copy (the r009 incident) does not hand the next writer a used id", async () => {
    const root = await project("166-a.md", "167-b.md", "168-c.md");
    expect(epic(root, ["report", "--task", "166-a.md"], "one").code).toBe(0);
    const committed = fs.readFileSync(statePath(root), "utf8"); // what `git commit` captured
    expect(epic(root, ["report", "--task", "167-b.md"], "two").stdout).toContain("report r002 ");

    // A stash / checkout in the main checkout restores the committed state.json; the untracked
    // r002 file stays in the inbox.
    fs.writeFileSync(statePath(root), committed);
    const third = epic(root, ["report", "--task", "168-c.md"], "three");
    expect(third.code, third.stderr).toBe(0);
    expect(third.stdout).toContain("report r003 ");

    const ids = fs
      .readdirSync(path.join(epicDir(root), "inbox"))
      .map((f) => f.slice(0, 4))
      .sort();
    expect(ids).toEqual(["r001", "r002", "r003"]);
    // The entry the reset dropped is still listed (from its file), so the manager still sees it.
    expect(unacked(root).map((r) => `${r.id} ${r.task}`)).toEqual(["r001 166-a.md", "r003 168-c.md", "r002 167-b.md"]);
  });

  it("a note id likewise counts the note files the log lost", async () => {
    const root = await project();
    expect(epic(root, ["create", "billing"]).code).toBe(0);
    const note = () => epic(root, ["note", "e1", "--from-epic", "billing", "--file", "-"], "heads up");
    expect(note().stdout).toContain("n001");
    const committed = fs.readFileSync(statePath(root), "utf8");
    expect(note().stdout).toContain("n002");
    fs.writeFileSync(statePath(root), committed);
    expect(note().stdout).toContain("n003");
  });

  it("two workers reporting at the same moment, over and over, never share an id", async () => {
    const tasks = Array.from({ length: 8 }, (_, i) => `${String(i + 160).padStart(3, "0")}-t.md`);
    const root = await project(...tasks);
    const script = path.join(root, ".claude", "scripts", "maestro-epic.cjs");
    const launch = (task: string) =>
      new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
        const child = spawn("node", [script, "report", "--task", task, "--file", "-"], {
          env: env(root),
          stdio: ["pipe", "pipe", "pipe"],
        });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("close", (code) => resolve({ code, out, err }));
        child.stdin.end(`done ${task}\n`);
      });
    // Four rounds of two simultaneous writers, as two worker sessions finishing together would be.
    const printed: string[] = [];
    for (let i = 0; i < tasks.length; i += 2) {
      const pair = await Promise.all([launch(tasks[i] as string), launch(tasks[i + 1] as string)]);
      for (const r of pair) {
        expect(r.code, r.err).toBe(0);
        printed.push(/report (r\d{3}) /.exec(r.out)?.[1] ?? "?");
      }
    }
    expect(new Set(printed).size).toBe(tasks.length);
    const log = stateOf(root).log.filter((e: { kind: string }) => e.kind === "report");
    expect(new Set(log.map((e: { id: string }) => e.id)).size).toBe(tasks.length);
    expect(fs.readdirSync(path.join(epicDir(root), "inbox"))).toHaveLength(tasks.length);
    expect(fs.existsSync(path.join(epicDir(root), ".lock"))).toBe(false);
  });
});

describe("an ack addresses exactly one report (171)", () => {
  /** The worktree-handoff-fixes shape: two logged r009s, the manager's id-only ack after the second. */
  async function duplicateInbox(withLegacyAck: boolean): Promise<string> {
    const root = await project("166-a.md", "167-b.md");
    const f166 = writeReportFile(root, "r009", "166-a.md", "2026-11-09T15:00:50.840Z", "w-166");
    const f167 = writeReportFile(root, "r009", "167-b.md", "2026-11-09T15:27:22.221Z", "w-167");
    const s = stateOf(root);
    s.log.push(
      { kind: "report", id: "r009", task: "166-a.md", file: f166, at: "2026-11-09T15:00:50.840Z", from: "w-166" },
      { kind: "report", id: "r009", task: "167-b.md", file: f167, at: "2026-11-09T15:27:22.221Z", from: "w-167" }
    );
    if (withLegacyAck) s.log.push({ kind: "ack", id: "r009", at: "2026-11-09T15:28:38.787Z", by: "boss" });
    fs.writeFileSync(statePath(root), JSON.stringify(s, null, 2));
    return root;
  }

  it("an old id-only ack covers only the report logged just before it; the other stays listed", async () => {
    const root = await duplicateInbox(true);
    expect(unacked(root).map((r) => [r.task, r.handle])).toEqual([["166-a.md", "r009-166"]]);
    expect(epic(root, ["reports", "e1"]).stdout).toContain("r009-166  166-a.md");
  });

  it("a shared id is refused, naming each handle, and writes nothing", async () => {
    const root = await duplicateInbox(false);
    const before = fs.readFileSync(statePath(root), "utf8");
    const r = epic(root, ["ack", "e1", "r009"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('"r009" names 2 entries');
    expect(r.stderr).toContain("r009-166");
    expect(r.stderr).toContain("r009-167");
    expect(fs.readFileSync(statePath(root), "utf8")).toBe(before);
    expect(unacked(root).map((x) => x.handle)).toEqual(["r009-166", "r009-167"]);
  });

  it("acking one handle clears that report alone, records its file, and is idempotent", async () => {
    const root = await duplicateInbox(false);
    expect(epic(root, ["ack", "e1", "r009-167", "--by", "boss"]).stdout).toContain("acknowledged r009-167");
    expect(unacked(root).map((r) => r.task)).toEqual(["166-a.md"]);
    expect(epic(root, ["ack", "e1", "r009-167"]).stdout).toContain("already acknowledged");

    // The file name (with or without inbox/ and .md) names the other one just as well.
    expect(epic(root, ["ack", "e1", "inbox/r009-166-a.md"]).stdout).toContain("acknowledged");
    expect(unacked(root)).toEqual([]);
    const acks = stateOf(root).log.filter((e: { kind: string }) => e.kind === "ack");
    expect(acks.map((a: { id: string; file: string }) => `${a.id} ${a.file}`)).toEqual([
      "r009 inbox/r009-167-b.md",
      "r009 inbox/r009-166-a.md",
    ]);
  });

  it("a handle cut inside a name segment names nothing", async () => {
    const root = await duplicateInbox(false);
    const r = epic(root, ["ack", "e1", "r009-16"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('has no report or note "r009-16"');
  });

  it("a fresh report's ack records its file, and a unique id still acks as before", async () => {
    const root = await project("001-a.md");
    epic(root, ["report", "--task", "001-a.md"], "one");
    expect(unacked(root).map((r) => r.handle)).toEqual(["r001"]);
    expect(epic(root, ["ack", "e1", "r001"]).stdout).toContain("acknowledged r001");
    expect(stateOf(root).log.at(-1)).toMatchObject({ kind: "ack", id: "r001", file: "inbox/r001-001-a.md" });
  });

  it("a report file the log lost (the real incident) is listed, acked by its handle, and put back in the log", async () => {
    const root = await project("166-a.md", "167-b.md");
    // On disk: both r009 files. In the log: only 167's, then the manager's id-only ack of it.
    writeReportFile(root, "r009", "166-a.md", "2026-11-09T15:00:50.840Z", "w-166");
    const f167 = writeReportFile(root, "r009", "167-b.md", "2026-11-09T15:27:22.221Z", "w-167");
    const s = stateOf(root);
    s.log.push(
      { kind: "report", id: "r009", task: "167-b.md", file: f167, at: "2026-11-09T15:27:22.221Z" },
      { kind: "ack", id: "r009", at: "2026-11-09T15:28:38.787Z", by: "boss" }
    );
    fs.writeFileSync(statePath(root), JSON.stringify(s, null, 2));

    expect(unacked(root)).toEqual([
      expect.objectContaining({ id: "r009", task: "166-a.md", from: "w-166", handle: "r009-166" }),
    ]);
    expect(JSON.parse(epic(root, ["list", "--json"]).stdout)).toContainEqual({
      slug: "e1",
      manager: "boss",
      unacknowledged: 1,
    });
    expect(epic(root, ["ack", "e1", "r009"]).code).toBe(1); // still two entries share it
    expect(epic(root, ["ack", "e1", "r009-166"]).stdout).toContain("acknowledged r009-166");
    expect(unacked(root)).toEqual([]);
    const log = stateOf(root).log;
    expect(log.filter((e: { kind: string }) => e.kind === "report").map((e: { task: string }) => e.task)).toEqual([
      "167-b.md",
      "166-a.md",
    ]);
    // And the next report skips past both files.
    expect(epic(root, ["report", "--task", "166-a.md"], "again").stdout).toContain("report r010 ");
  });

  it("an old id-only ack logged between two r009s covers the first only; the later duplicate stays listed", async () => {
    const root = await project("166-a.md", "167-b.md");
    const f166 = writeReportFile(root, "r009", "166-a.md", "2026-11-09T15:00:50.840Z", "w-166");
    const f167 = writeReportFile(root, "r009", "167-b.md", "2026-11-09T15:27:22.221Z", "w-167");
    const s = stateOf(root);
    s.log.push(
      { kind: "report", id: "r009", task: "166-a.md", file: f166, at: "2026-11-09T15:00:50.840Z", from: "w-166" },
      { kind: "ack", id: "r009", at: "2026-11-09T15:10:00.000Z", by: "boss" },
      { kind: "report", id: "r009", task: "167-b.md", file: f167, at: "2026-11-09T15:27:22.221Z", from: "w-167" }
    );
    fs.writeFileSync(statePath(root), JSON.stringify(s, null, 2));

    expect(unacked(root).map((r) => [r.task, r.handle])).toEqual([["167-b.md", "r009-167"]]);
    expect(epic(root, ["ack", "e1", "r009-167"]).stdout).toContain("acknowledged r009-167");
    expect(unacked(root)).toEqual([]);
  });
});
