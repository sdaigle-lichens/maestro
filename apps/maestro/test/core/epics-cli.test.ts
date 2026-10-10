// `084` through the REAL installed commands: maestro-epic.cjs (create, link, unlink, show, report,
// ack), maestro-task-status.cjs (claim --name, sync, done) and maestro-write-tasks.cjs (--epic),
// spawned against temp projects exactly as a session would run them. Same harness rules as
// task-claims-cli.test.ts: HOME pinned, CLAUDE_CODE_SESSION_ID always set or deleted, never inherited.

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
const SESSION_A = "sess-aaa-111";
const SESSION_B = "sess-bbb-222";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-084-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function installed(): Promise<string> {
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
  return root;
}

function env(root: string, sessionId: string | null): NodeJS.ProcessEnv {
  const e: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp };
  if (sessionId === null) delete e.CLAUDE_CODE_SESSION_ID;
  else e.CLAUDE_CODE_SESSION_ID = sessionId;
  return e;
}

function run(root: string, script: string, args: string[], opts: { session?: string | null; input?: string } = {}) {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", script), ...args], {
    encoding: "utf8",
    env: env(root, opts.session === undefined ? SESSION_A : opts.session),
    input: opts.input ?? "",
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const epic = (root: string, args: string[], input?: string) => run(root, "maestro-epic.cjs", args, { input });
const status = (root: string, args: string[], session: string | null = SESSION_A) =>
  run(root, "maestro-task-status.cjs", args, { session });

const tasksDir = (root: string) => path.join(root, ".claude", "maestro-tasks");
const statusJson = (root: string) => JSON.parse(fs.readFileSync(path.join(tasksDir(root), "status.json"), "utf8"));

function writeTask(root: string, filename: string, title: string) {
  fs.mkdirSync(tasksDir(root), { recursive: true });
  fs.writeFileSync(path.join(tasksDir(root), filename), `# ${title}\n\n## Blocked by\n\nNone\n`);
}

function liveSession(root: string, id: string) {
  const dir = path.join(root, ".claude", "maestro_sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "log.jsonl"), '{"kind":"tool_call"}\n');
}

async function withTasks(...names: string[]): Promise<string> {
  const root = await installed();
  for (const n of names) writeTask(root, n, n);
  expect(status(root, ["sync"]).code).toBe(0);
  return root;
}

describe("maestro-epic.cjs create / link / unlink / show", () => {
  it("creates an epic with a human file and a state file, and refuses a duplicate or a bad name", async () => {
    const root = await installed();
    const created = epic(root, ["create", "billing", "--goal", "Ship billing", "--manager", "boss"]);
    expect(created.code).toBe(0);
    const dir = path.join(root, ".claude", "epics", "billing");
    expect(fs.readFileSync(path.join(dir, "EPIC.md"), "utf8")).toContain("Ship billing");
    expect(JSON.parse(fs.readFileSync(path.join(dir, "state.json"), "utf8"))).toMatchObject({
      slug: "billing",
      manager: { name: "boss" },
      workers: [],
      log: [],
    });
    expect(epic(root, ["create", "billing"]).code).toBe(1);
    expect(epic(root, ["create", "../escape"]).code).toBe(1);
    expect(epic(root, ["list"]).stdout).toContain("billing");
  });

  it("links and unlinks tasks through the tracker's epic field, and show lists them with statuses", async () => {
    const root = await withTasks("001-a.md", "002-b.md", "003-c.md");
    epic(root, ["create", "e1"]);

    expect(epic(root, ["link", "e1", "001-a.md", "002-b.md"]).code).toBe(0);
    expect(statusJson(root)["001-a.md"].epic).toBe("e1");
    expect(statusJson(root)["003-c.md"].epic).toBeUndefined();

    const shown = JSON.parse(epic(root, ["show", "e1", "--json"]).stdout);
    expect(shown.tasks.map((t: { filename: string; status: string }) => [t.filename, t.status])).toEqual([
      ["001-a.md", "ready"],
      ["002-b.md", "ready"],
    ]);

    expect(epic(root, ["unlink", "002-b.md"]).code).toBe(0);
    expect(statusJson(root)["002-b.md"].epic).toBeUndefined();
    expect(statusJson(root)["002-b.md"].status).toBe("ready");
    expect(JSON.parse(epic(root, ["show", "e1", "--json"]).stdout).tasks).toHaveLength(1);
  });

  it("refuses to link a task that does not exist, naming it and writing nothing", async () => {
    const root = await withTasks("001-a.md");
    epic(root, ["create", "e1"]);
    const before = fs.readFileSync(path.join(tasksDir(root), "status.json"), "utf8");

    const r = epic(root, ["link", "e1", "001-a.md", "999-ghost.md"]);

    expect(r.code).toBe(1);
    expect(r.stderr).toContain("999-ghost.md");
    expect(fs.readFileSync(path.join(tasksDir(root), "status.json"), "utf8")).toBe(before);
    expect(statusJson(root)).not.toHaveProperty("999-ghost.md");
  });

  it("refuses to link to an epic that does not exist", async () => {
    const root = await withTasks("001-a.md");
    const r = epic(root, ["link", "nope", "001-a.md"]);
    expect(r.code).toBe(1);
    expect(statusJson(root)["001-a.md"].epic).toBeUndefined();
  });
});

describe("the tracker keeps every writer's entries", () => {
  it("a link, then a sync, then a done, then another link lose no entry and no epic", async () => {
    const root = await withTasks("001-a.md", "002-b.md");
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "001-a.md"]);

    writeTask(root, "003-c.md", "C"); // a third writer adds a task file and syncs
    expect(status(root, ["sync"]).code).toBe(0);
    expect(statusJson(root)["001-a.md"].epic).toBe("e1");

    expect(status(root, ["done", "002-b.md"]).code).toBe(0);
    expect(epic(root, ["link", "e1", "003-c.md"]).code).toBe(0);

    const map = statusJson(root);
    expect(Object.keys(map).sort()).toEqual(["001-a.md", "002-b.md", "003-c.md"]);
    expect(map["001-a.md"].epic).toBe("e1");
    expect(map["003-c.md"].epic).toBe("e1");
    expect(map["002-b.md"].status).toBe("done");
    expect(map["002-b.md"].epic).toBeUndefined();
  });

  it("back-to-back link commands from separate processes each keep the earlier ones", async () => {
    const root = await withTasks("001-a.md", "002-b.md", "003-c.md", "004-d.md");
    epic(root, ["create", "e1"]);
    // Sequential writers, as the acceptance criteria say: each rereads the tracker before writing.
    for (const t of ["001-a.md", "002-b.md", "003-c.md", "004-d.md"]) {
      expect(epic(root, ["link", "e1", t]).code).toBe(0);
    }
    const map = statusJson(root);
    const linked = Object.keys(map).filter((k) => map[k].epic === "e1");
    expect(linked.sort()).toEqual(["001-a.md", "002-b.md", "003-c.md", "004-d.md"]);
  });
});

describe("claim records the session name", () => {
  it("a named claim stores the name, an unnamed one still works, and show lists both", async () => {
    const root = await withTasks("001-a.md", "002-b.md");
    liveSession(root, SESSION_A);
    liveSession(root, SESSION_B);
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "001-a.md", "002-b.md"]);

    const named = status(root, ["claim", "001-a.md", "--name", "worker-one"], SESSION_A);
    const unnamed = status(root, ["claim", "002-b.md"], SESSION_B);
    expect(named.code).toBe(0);
    expect(named.stdout).toContain("worker-one");
    expect(unnamed.code).toBe(0);
    expect(unnamed.stdout).toContain("unnamed");

    const claim = (f: string) => JSON.parse(fs.readFileSync(path.join(tasksDir(root), "claims", `${f}.json`), "utf8"));
    expect(claim("001-a.md").session_name).toBe("worker-one");
    expect(claim("002-b.md").session_name).toBeUndefined();

    const shown = JSON.parse(epic(root, ["show", "e1", "--json"]).stdout);
    const by = Object.fromEntries(shown.tasks.map((t: { filename: string; running: unknown }) => [t.filename, t.running]));
    expect(by["001-a.md"]).toEqual({ sessionId: SESSION_A, sessionName: "worker-one" });
    expect(by["002-b.md"]).toEqual({ sessionId: SESSION_B, sessionName: null });
    expect(epic(root, ["show", "e1"]).stdout).toContain('running in session "worker-one"');
    expect(epic(root, ["show", "e1"]).stdout).toContain("(unnamed)");
  });

  it("a losing claim names the holder", async () => {
    const root = await withTasks("001-a.md");
    liveSession(root, SESSION_A);
    liveSession(root, SESSION_B);
    status(root, ["claim", "001-a.md", "--name", "worker-one"], SESSION_A);
    const loser = status(root, ["claim", "001-a.md", "--name", "worker-two"], SESSION_B);
    expect(loser.code).toBe(0);
    expect(loser.stdout).toContain("worker-one");
  });
});

describe("the report inbox", () => {
  it("a report written with no manager survives, is listed unacknowledged, and is acknowledged once", async () => {
    const root = await withTasks("001-a.md");
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "001-a.md"]);

    const written = epic(root, ["report", "--task", "001-a.md", "--from", "worker-one"], "Outcome: shipped\nFinding: none\n");
    expect(written.code).toBe(0);
    expect(written.stdout).toContain("No manager session is recorded");
    const file = path.join(root, ".claude", "epics", "e1", "inbox", "r001-001-a.md");
    expect(fs.readFileSync(file, "utf8")).toContain("Outcome: shipped");

    // A manager resumes later: the report is still there, unacknowledged.
    expect(epic(root, ["set-manager", "e1", "boss"]).code).toBe(0);
    const shown = JSON.parse(epic(root, ["show", "e1", "--json"]).stdout);
    expect(shown.manager).toBe("boss");
    expect(shown.unacknowledged.map((r: { id: string }) => r.id)).toEqual(["r001"]);
    expect(epic(root, ["reports", "e1"]).stdout).toContain("r001");

    expect(epic(root, ["ack", "e1", "r001", "--by", "boss"]).stdout).toContain("acknowledged r001");
    expect(epic(root, ["ack", "e1", "r001"]).stdout).toContain("already acknowledged");
    expect(JSON.parse(epic(root, ["show", "e1", "--json"]).stdout).unacknowledged).toEqual([]);
    expect(epic(root, ["reports", "e1"]).stdout).toContain("no unacknowledged");
    const log = JSON.parse(fs.readFileSync(path.join(root, ".claude", "epics", "e1", "state.json"), "utf8")).log;
    expect(log.filter((e: { kind: string }) => e.kind === "ack")).toHaveLength(1);
  });

  it("with a manager recorded, the report command names the session to message", async () => {
    const root = await withTasks("001-a.md", "002-b.md");
    epic(root, ["create", "e1", "--manager", "boss"]);
    epic(root, ["link", "e1", "001-a.md", "002-b.md"]);

    const first = epic(root, ["report", "--task", "001-a.md"], "one");
    const second = epic(root, ["report", "--task", "002-b.md"], "two");

    expect(first.stdout).toContain('"boss"');
    expect(first.stdout).toContain("r001");
    expect(second.stdout).toContain("r002"); // ids never repeat
    expect(JSON.parse(epic(root, ["show", "e1", "--json"]).stdout).unacknowledged).toHaveLength(2);
  });

  it("an unknown report id cannot be acknowledged", async () => {
    const root = await withTasks("001-a.md");
    epic(root, ["create", "e1"]);
    const r = epic(root, ["ack", "e1", "r099"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("r099");
  });

  it("a task in no epic writes nothing and does not wait for stdin", async () => {
    const root = await withTasks("001-a.md");
    const r = epic(root, ["report", "--task", "001-a.md"]);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain("belongs to no epic");
    expect(fs.existsSync(path.join(root, ".claude", "epics"))).toBe(false);
  });

  // A stdin that is held OPEN and never written: a script that reads it before checking the epic
  // would block forever. Run the plugin script and the repo's tracked mirror, both against a temp project.
  const REPO_ROOT = path.resolve(PLUGIN_ROOT, "..", "..");
  const variants: Array<[string, string]> = [
    ["plugin script", path.join(PLUGIN_ROOT, "scripts", "maestro-epic.cjs")],
    [".claude/scripts mirror", path.join(REPO_ROOT, ".claude", "scripts", "maestro-epic.cjs")],
  ];
  for (const [label, script] of variants) {
    it(`${label}: report for a task in no epic returns with stdin held open`, async () => {
      const root = await withTasks("001-a.md");
      const result = await new Promise<{ code: number | null; out: string; timedOut: boolean }>((resolve) => {
        const child = spawn("node", [script, "report", "--task", "001-a.md"], {
          env: env(root, SESSION_A),
          stdio: ["pipe", "pipe", "pipe"], // stdin stays open; never ended
        });
        let out = "";
        child.stdout.on("data", (d) => (out += d));
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve({ code: null, out, timedOut: true });
        }, 5000);
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, out, timedOut: false });
        });
      });
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(0);
      expect(result.out).toContain("belongs to no epic");
      expect(fs.existsSync(path.join(root, ".claude", "epics"))).toBe(false);
    });
  }
});

describe("to-maestro-tasks linking", () => {
  const writer = (root: string, args: string[]) =>
    spawnSync("node", [path.join(PLUGIN_ROOT, "scripts", "maestro-write-tasks.cjs"), ...args], {
      encoding: "utf8",
      env: env(root, SESSION_A),
    });

  it("--epic links every written task, and a missing epic writes nothing", async () => {
    const root = await installed();
    epic(root, ["create", "e1"]);
    const spec = path.join(tmp, "slices.json");
    fs.writeFileSync(
      spec,
      JSON.stringify([
        { title: "First", whatToBuild: "x", acceptanceCriteria: ["a"], blockedBy: [] },
        { title: "Second", whatToBuild: "y", acceptanceCriteria: ["b"], blockedBy: [0] },
      ])
    );

    const bad = writer(root, [spec, "--epic", "nope"]);
    expect(bad.status).toBe(1);
    const written = fs.existsSync(tasksDir(root)) ? fs.readdirSync(tasksDir(root)).filter((f) => f.endsWith(".md")) : [];
    expect(written).toEqual([]);

    const ok = writer(root, [spec, "--epic", "e1"]);
    expect(ok.status).toBe(0);
    const map = statusJson(root);
    expect(Object.keys(map).every((k) => map[k].epic === "e1")).toBe(true);
    expect(Object.keys(map)).toHaveLength(2);

    const plain = writer(root, [spec]);
    expect(plain.status).toBe(0);
    expect(Object.values(statusJson(root)).filter((v) => (v as { epic?: string }).epic).length).toBe(2);
  });
});
