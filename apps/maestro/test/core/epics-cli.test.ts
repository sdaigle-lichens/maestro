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
    const by = Object.fromEntries(
      shown.tasks.map((t: { filename: string; running: unknown }) => [t.filename, t.running])
    );
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

describe("done prints the epic report command (100)", () => {
  it("a task in an epic: done prints the exact report command naming the epic, the manager and the claim's session name", async () => {
    const root = await withTasks("001-a.md");
    liveSession(root, SESSION_A);
    epic(root, ["create", "e1", "--manager", "boss"]);
    epic(root, ["link", "e1", "001-a.md"]);
    status(root, ["claim", "001-a.md", "--name", "worker-one"], SESSION_A);

    const done = status(root, ["done", "001-a.md"], SESSION_A);
    expect(done.code).toBe(0);
    expect(done.stdout).toContain('marked "001-a.md" done');
    expect(done.stdout).toContain('epic "e1"');
    expect(done.stdout).toContain('manager: "boss"');
    expect(done.stdout).toContain(
      'node .claude/scripts/maestro-epic.cjs report --task "001-a.md" --from "worker-one" --file -'
    );
    // `done` deleted the claim, yet the printed command still carries the sender.
    expect(fs.existsSync(path.join(tasksDir(root), "claims", "001-a.md.json"))).toBe(false);
  });

  it("an epic with no manager says so, and an unnamed claim leaves --from off", async () => {
    const root = await withTasks("001-a.md");
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "001-a.md"]);
    const done = status(root, ["done", "001-a.md"], SESSION_A);
    expect(done.stdout).toContain("no manager recorded");
    expect(done.stdout).toContain('report --task "001-a.md" --file -');
    expect(done.stdout).not.toContain("--from");
  });

  it("a task in no epic: done prints nothing new", async () => {
    const root = await withTasks("001-a.md");
    const done = status(root, ["done", "001-a.md"], SESSION_A);
    expect(done.code).toBe(0);
    expect(done.stdout).toMatch(/^Maestro tasks: marked "001-a.md" done — [^\n]*\n$/);
  });

  it("`of` prints the epic slug, or nothing for a task in no epic", async () => {
    const root = await withTasks("001-a.md", "002-b.md");
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "001-a.md"]);
    expect(epic(root, ["of", "001-a.md"]).stdout).toBe("e1\n");
    expect(epic(root, ["of", "002-b.md"]).stdout).toBe("");
  });
});

describe("a report written without a sender (100)", () => {
  it("uses the session name recorded on the task's claim", async () => {
    const root = await withTasks("001-a.md");
    liveSession(root, SESSION_A);
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "001-a.md"]);
    status(root, ["claim", "001-a.md", "--name", "worker-one"], SESSION_A);

    expect(epic(root, ["report", "--task", "001-a.md"], "body").code).toBe(0);
    const state = JSON.parse(fs.readFileSync(path.join(root, ".claude", "epics", "e1", "state.json"), "utf8"));
    expect(state.log[0].from).toBe("worker-one");
    expect(fs.readFileSync(path.join(root, ".claude", "epics", "e1", state.log[0].file), "utf8")).toContain(
      "From session: worker-one"
    );
  });

  it("an explicit --from wins over the claim, and no claim means no sender", async () => {
    const root = await withTasks("001-a.md", "002-b.md");
    liveSession(root, SESSION_A);
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "001-a.md", "002-b.md"]);
    status(root, ["claim", "001-a.md", "--name", "worker-one"], SESSION_A);

    epic(root, ["report", "--task", "001-a.md", "--from", "other"], "x");
    epic(root, ["report", "--task", "002-b.md"], "y");
    const log = JSON.parse(fs.readFileSync(path.join(root, ".claude", "epics", "e1", "state.json"), "utf8")).log;
    expect(log[0].from).toBe("other");
    expect(log[1].from).toBeUndefined();
  });
});

describe("the report inbox", () => {
  it("a report written with no manager survives, is listed unacknowledged, and is acknowledged once", async () => {
    const root = await withTasks("001-a.md");
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "001-a.md"]);

    const written = epic(
      root,
      ["report", "--task", "001-a.md", "--from", "worker-one"],
      "Outcome: shipped\nFinding: none\n"
    );
    expect(written.code).toBe(0);
    expect(written.stdout).toContain("No manager session is recorded");
    expect(written.stdout).not.toContain("SendMessage fails");
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

    // A failed send is recoverable: the printed step says how, and that the file is the delivery.
    for (const out of [first.stdout, second.stdout]) {
      expect(out).toContain("If that SendMessage fails, run ListAgents");
      expect(out).toContain("exactly one session plausibly matches");
      expect(out).toContain("ask the user before messaging it");
      expect(out).toContain("Never conclude the manager is gone from one failed send");
      expect(out).toContain("saved report file is the real delivery");
    }
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

// `085`: one epic's manager discovers the others and leaves a durable note in another epic's inbox.
describe("cross-epic notes", () => {
  const stateOf = (root: string, slug: string) =>
    JSON.parse(fs.readFileSync(path.join(root, ".claude", "epics", slug, "state.json"), "utf8"));
  const bodyFile = (text: string) => {
    const f = path.join(tmp, `note-${Math.random().toString(36).slice(2)}.md`);
    fs.writeFileSync(f, text);
    return f;
  };

  it("list shows each epic's manager and inbox backlog, as text and --json", async () => {
    const root = await installed();
    epic(root, ["create", "billing", "--manager", "boss-billing"]);
    epic(root, ["create", "search"]);

    const text = epic(root, ["list"]).stdout;
    expect(text).toContain("billing  manager: boss-billing  unacknowledged: 0");
    expect(text).toContain("search  manager: (none recorded)  unacknowledged: 0");
    expect(JSON.parse(epic(root, ["list", "--json"]).stdout)).toEqual([
      { slug: "billing", manager: "boss-billing", unacknowledged: 0 },
      { slug: "search", manager: null, unacknowledged: 0 },
    ]);
  });

  it("a note is on disk and logged when the command returns, and names the manager to message", async () => {
    const root = await installed();
    epic(root, ["create", "billing", "--manager", "boss-billing"]);
    epic(root, ["create", "search", "--manager", "boss-search"]);

    const sent = epic(root, [
      "note",
      "search",
      "--from-epic",
      "billing",
      "--from",
      "boss-billing",
      "--subject",
      "shared schema",
      "--file",
      bodyFile("I changed db/schema.ts\n"),
    ]);
    expect(sent.code).toBe(0);
    expect(sent.stdout).toContain("n001");
    expect(sent.stdout).toContain('"boss-search"');
    expect(sent.stdout).toContain("If that SendMessage fails, run ListAgents");
    expect(sent.stdout).toContain("ask the user before messaging it");
    expect(sent.stdout).toContain("Never conclude the manager is gone from one failed send");
    expect(sent.stdout).toContain("saved note file is the real delivery");

    const file = path.join(root, ".claude", "epics", "search", "inbox", "n001-from-billing.md");
    const content = fs.readFileSync(file, "utf8");
    expect(sent.stdout).toContain(file);
    expect(content).toContain("I changed db/schema.ts");
    expect(content).toContain("From epic: billing");
    expect(content).toContain("From session: boss-billing");
    expect(content).toContain("Subject: shared schema");
    expect(stateOf(root, "search").log).toEqual([
      expect.objectContaining({
        kind: "note",
        id: "n001",
        from_epic: "billing",
        from: "boss-billing",
        subject: "shared schema",
        file: "inbox/n001-from-billing.md",
      }),
    ]);
    expect(stateOf(root, "billing").log).toEqual([]); // the sender's own inbox is untouched

    // Its own counter, separate from reports, and ids never repeat; stdin works with "-".
    const second = epic(root, ["note", "search", "--from-epic", "billing", "--file", "-"], "again\n");
    expect(second.stdout).toContain("n002");
    expect(epic(root, ["list"]).stdout).toContain("search  manager: boss-search  unacknowledged: 2");
  });

  it("refuses an unknown receiver or sender, a note to its own epic, and an empty body, writing nothing", async () => {
    const root = await installed();
    epic(root, ["create", "billing"]);
    epic(root, ["create", "search"]);
    const body = bodyFile("hello\n");

    const cases: Array<[string[], string]> = [
      [["note", "nope", "--from-epic", "billing", "--file", body], "nope"],
      [["note", "../escape", "--from-epic", "billing", "--file", body], "../escape"],
      [["note", "search", "--from-epic", "ghost", "--file", body], "ghost"],
      [["note", "search", "--from-epic", "search", "--file", body], "search"],
      [["note", "search", "--from-epic", "billing", "--file", bodyFile("  \n")], "empty"],
      [["note", "search", "--file", body], "Usage"],
    ];
    for (const [args, named] of cases) {
      const r = epic(root, args);
      expect(r.code, args.join(" ")).toBe(1);
      expect(r.stderr).toContain(named);
    }
    expect(stateOf(root, "search").log).toEqual([]);
    expect(fs.readdirSync(path.join(root, ".claude", "epics", "search", "inbox"))).toEqual([]);
  });

  // A stdin held OPEN and never written: a refusal checked only after reading the body would hang.
  for (const [label, to, fromEpic] of [
    ["unknown receiver", "nope", "billing"],
    ["unknown sender", "search", "ghost"],
    ["own epic", "search", "search"],
  ]) {
    it(`note --file - with stdin held open: ${label} exits 1 promptly`, async () => {
      const root = await installed();
      epic(root, ["create", "billing"]);
      epic(root, ["create", "search"]);
      const script = path.join(root, ".claude", "scripts", "maestro-epic.cjs");
      const result = await new Promise<{ code: number | null; timedOut: boolean }>((resolve) => {
        const child = spawn("node", [script, "note", to, "--from-epic", fromEpic, "--file", "-"], {
          env: env(root, SESSION_A),
          stdio: ["pipe", "pipe", "pipe"], // stdin stays open; never ended
        });
        const timer = setTimeout(() => {
          child.kill("SIGKILL");
          resolve({ code: null, timedOut: true });
        }, 5000);
        child.on("close", (code) => {
          clearTimeout(timer);
          resolve({ code, timedOut: false });
        });
      });
      expect(result.timedOut).toBe(false);
      expect(result.code).toBe(1);
      expect(stateOf(root, "search").log).toEqual([]);
    });
  }

  // The route check must not short-circuit a VALID note: stdin that arrives late, in pieces, is
  // still read to EOF and written whole.
  it("a valid note --file - waits for a stdin written late and in chunks, then writes the whole body", async () => {
    const root = await installed();
    epic(root, ["create", "billing"]);
    epic(root, ["create", "search", "--manager", "boss-search"]);
    const script = path.join(root, ".claude", "scripts", "maestro-epic.cjs");
    const result = await new Promise<{ code: number | null; out: string; timedOut: boolean }>((resolve) => {
      const child = spawn("node", [script, "note", "search", "--from-epic", "billing", "--file", "-"], {
        env: env(root, SESSION_A),
        stdio: ["pipe", "pipe", "pipe"],
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
      setTimeout(() => child.stdin.write("first part\n"), 200);
      setTimeout(() => {
        child.stdin.write("second part\n");
        child.stdin.end();
      }, 400);
    });
    expect(result.timedOut).toBe(false);
    expect(result.code).toBe(0);
    expect(result.out).toContain('"boss-search"');
    const content = fs.readFileSync(
      path.join(root, ".claude", "epics", "search", "inbox", "n001-from-billing.md"),
      "utf8"
    );
    expect(content).toContain("first part\nsecond part");
    expect(stateOf(root, "search").log).toEqual([expect.objectContaining({ kind: "note", id: "n001" })]);
  });

  it("note --file - with an empty stdin passes the route check, then is refused as empty, writing nothing", async () => {
    const root = await installed();
    epic(root, ["create", "billing"]);
    epic(root, ["create", "search"]);
    const r = epic(root, ["note", "search", "--from-epic", "billing", "--file", "-"], " \n");
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("empty");
    expect(stateOf(root, "search").log).toEqual([]);
    expect(fs.readdirSync(path.join(root, ".claude", "epics", "search", "inbox"))).toEqual([]);
  });

  it("note --file <relative path> resolves against the caller's cwd", async () => {
    const root = await installed();
    epic(root, ["create", "billing"]);
    epic(root, ["create", "search"]);
    const cwd = path.join(tmp, "work");
    fs.mkdirSync(cwd, { recursive: true });
    fs.writeFileSync(path.join(cwd, "body.md"), "relative body\n");
    const res = spawnSync(
      "node",
      [
        path.join(root, ".claude", "scripts", "maestro-epic.cjs"),
        "note",
        "search",
        "--from-epic",
        "billing",
        "--file",
        "body.md",
      ],
      { encoding: "utf8", cwd, env: env(root, SESSION_A), input: "" }
    );
    expect(res.status, res.stderr).toBe(0);
    const content = fs.readFileSync(
      path.join(root, ".claude", "epics", "search", "inbox", "n001-from-billing.md"),
      "utf8"
    );
    expect(content).toContain("relative body");
  });

  it("a note sent while the receiver has no manager waits unacknowledged for a resumed manager, then is acked once", async () => {
    const root = await withTasks("001-a.md");
    epic(root, ["create", "billing", "--manager", "boss-billing"]);
    epic(root, ["create", "search"]);
    epic(root, ["link", "search", "001-a.md"]);
    epic(root, ["report", "--task", "001-a.md"], "worker report\n");

    const sent = epic(root, [
      "note",
      "search",
      "--from-epic",
      "billing",
      "--from",
      "boss-billing",
      "--file",
      bodyFile("heads up\n"),
    ]);
    expect(sent.code).toBe(0);
    expect(sent.stdout).toContain("No manager session is recorded");
    expect(sent.stdout).not.toContain("SendMessage fails");

    // The manager resumes later: the report and the note are both waiting, oldest first.
    epic(root, ["set-manager", "search", "boss-search"]);
    const shown = JSON.parse(epic(root, ["show", "search", "--json"]).stdout);
    expect(shown.unacknowledged.map((e: { id: string }) => e.id)).toEqual(["r001", "n001"]);
    expect(shown.unacknowledged[1]).toMatchObject({ kind: "note", from_epic: "billing" });
    const noteLine = `n001  from epic billing (boss-billing)  ${path.join(root, ".claude", "epics", "search", "inbox", "n001-from-billing.md")}`;
    expect(epic(root, ["show", "search"]).stdout).toContain(noteLine);
    expect(epic(root, ["show", "search"]).stdout).toContain("r001  001-a.md");
    const reports = epic(root, ["reports", "search"]).stdout;
    expect(reports).toContain(noteLine);
    expect(reports.indexOf("r001")).toBeLessThan(reports.indexOf("n001"));

    expect(epic(root, ["ack", "search", "n001", "--by", "boss-search"]).stdout).toContain("acknowledged n001");
    expect(epic(root, ["ack", "search", "n001"]).stdout).toContain("already acknowledged");
    expect(epic(root, ["ack", "search", "n099"]).code).toBe(1);
    const after = JSON.parse(epic(root, ["show", "search", "--json"]).stdout);
    expect(after.unacknowledged.map((e: { id: string }) => e.id)).toEqual(["r001"]);
    expect(epic(root, ["reports", "search"]).stdout).not.toContain("n001");
    expect(stateOf(root, "search").log.filter((e: { kind: string }) => e.kind === "ack")).toHaveLength(1);
  });

  it("show lists the blockedBy edges that cross into another epic, in both directions", async () => {
    const root = await installed();
    const write = (name: string, blockers: string[]) => {
      fs.mkdirSync(tasksDir(root), { recursive: true });
      const refs = blockers.length ? blockers.map((b) => `- \`${b}\``).join("\n") : "None";
      fs.writeFileSync(path.join(tasksDir(root), name), `# ${name}\n\n## Blocked by\n\n${refs}\n`);
    };
    write("001-schema.md", []);
    write("002-api.md", ["001-schema.md"]); // billing waits on search
    write("003-index.md", ["002-api.md"]); // search waits on billing
    write("004-loose.md", ["002-api.md"]); // a task in no epic waits on billing
    write("005-done.md", []);
    write("006-uses-done.md", ["005-done.md"]); // blocker done: no live dependency
    expect(status(root, ["sync"]).code).toBe(0);
    expect(status(root, ["done", "005-done.md"]).code).toBe(0);
    epic(root, ["create", "billing"]);
    epic(root, ["create", "search"]);
    epic(root, ["link", "billing", "002-api.md", "006-uses-done.md"]);
    epic(root, ["link", "search", "001-schema.md", "003-index.md", "005-done.md"]);

    const shown = JSON.parse(epic(root, ["show", "billing", "--json"]).stdout);
    expect(shown.crossEpic).toEqual([
      { task: "002-api.md", blockedBy: "001-schema.md", otherEpic: "search", direction: "blocked-by-other" },
      { task: "003-index.md", blockedBy: "002-api.md", otherEpic: "search", direction: "blocks-other" },
      { task: "004-loose.md", blockedBy: "002-api.md", otherEpic: null, direction: "blocks-other" },
    ]);
    const text = epic(root, ["show", "billing"]).stdout;
    expect(text).toContain("cross-epic dependencies (3):");
    // The other side sees the same two epic-to-epic edges, mirrored; the epic-less 004 is not its edge.
    expect(JSON.parse(epic(root, ["show", "search", "--json"]).stdout).crossEpic).toEqual([
      { task: "002-api.md", blockedBy: "001-schema.md", otherEpic: "billing", direction: "blocks-other" },
      { task: "003-index.md", blockedBy: "002-api.md", otherEpic: "billing", direction: "blocked-by-other" },
    ]);
    expect(text).toContain("002-api.md  blocked by 001-schema.md (epic search)");
    expect(text).toContain("002-api.md  blocks 003-index.md (epic search)");
    expect(text).toContain("002-api.md  blocks 004-loose.md (no epic)");
  });

  it("report and note ids keep separate counters that never collide, and acks never free an id for reuse", async () => {
    const root = await withTasks("001-a.md", "002-b.md", "003-c.md");
    epic(root, ["create", "billing"]);
    epic(root, ["create", "search", "--manager", "boss-search"]);
    epic(root, ["link", "search", "001-a.md", "002-b.md", "003-c.md"]);
    const note = (text: string) => epic(root, ["note", "search", "--from-epic", "billing", "--file", "-"], text);

    // Interleaved: each kind counts on its own.
    expect(epic(root, ["report", "--task", "001-a.md"], "one\n").stdout).toContain("r001");
    expect(note("first\n").stdout).toContain("n001");
    expect(epic(root, ["report", "--task", "002-b.md"], "two\n").stdout).toContain("r002");
    expect(note("second\n").stdout).toContain("n002");

    // Acking r001 acks only r001, never the note that shares its number; one call can mix both kinds.
    epic(root, ["ack", "search", "r001"]);
    expect(
      stateOf(root, "search")
        .log.filter((e: { kind: string }) => e.kind === "ack")
        .map((e: { id: string }) => e.id)
    ).toEqual(["r001"]);
    const acked = epic(root, ["ack", "search", "n001", "n002", "r002"]);
    expect(acked.code).toBe(0);
    expect(JSON.parse(epic(root, ["show", "search", "--json"]).stdout).unacknowledged).toEqual([]);

    // With everything acknowledged, the next ids still move forward rather than restarting.
    expect(note("third\n").stdout).toContain("n003");
    expect(epic(root, ["report", "--task", "003-c.md"], "three\n").stdout).toContain("r003");

    const inbox = fs.readdirSync(path.join(root, ".claude", "epics", "search", "inbox")).sort();
    expect(inbox).toEqual([
      "n001-from-billing.md",
      "n002-from-billing.md",
      "n003-from-billing.md",
      "r001-001-a.md",
      "r002-002-b.md",
      "r003-003-c.md",
    ]);
    // Every file is still its own: a later write never overwrote an earlier one.
    const read = (f: string) => fs.readFileSync(path.join(root, ".claude", "epics", "search", "inbox", f), "utf8");
    expect(read("n001-from-billing.md")).toContain("first");
    expect(read("n003-from-billing.md")).toContain("third");
    expect(read("r001-001-a.md")).toContain("one");
    const ids = stateOf(root, "search")
      .log.filter((e: { kind: string }) => e.kind !== "ack")
      .map((e: { id: string }) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("a note id belongs to the receiving epic only: the sender cannot acknowledge it", async () => {
    const root = await installed();
    epic(root, ["create", "billing"]);
    epic(root, ["create", "search"]);
    epic(root, ["note", "search", "--from-epic", "billing", "--file", "-"], "hi\n");
    const r = epic(root, ["ack", "billing", "n001"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("n001");
    expect(stateOf(root, "billing").log).toEqual([]);
    expect(JSON.parse(epic(root, ["show", "search", "--json"]).stdout).unacknowledged).toHaveLength(1);
  });

  it("a refused note leaves the sender's epic untouched too, and an unreadable --file writes nothing", async () => {
    const root = await installed();
    epic(root, ["create", "billing"]);
    epic(root, ["create", "search"]);
    const snapshot = (slug: string) => fs.readFileSync(path.join(root, ".claude", "epics", slug, "state.json"), "utf8");
    const before = { billing: snapshot("billing"), search: snapshot("search") };

    for (const args of [
      ["note", "search", "--from-epic", "search", "--file", bodyFile("x\n")],
      ["note", "nope", "--from-epic", "billing", "--file", bodyFile("x\n")],
      ["note", "search", "--from-epic", "billing", "--file", path.join(tmp, "does-not-exist.md")],
      ["note", "search", "--from-epic", "billing", "--file"], // --file with no value: usage, not stdin
    ]) {
      const r = epic(root, args);
      expect(r.code, args.join(" ")).toBe(1);
    }
    expect(snapshot("billing")).toBe(before.billing);
    expect(snapshot("search")).toBe(before.search);
    for (const slug of ["billing", "search"]) {
      expect(fs.readdirSync(path.join(root, ".claude", "epics", slug, "inbox"))).toEqual([]);
      expect(fs.readdirSync(path.join(root, ".claude", "epics", slug)).sort()).toEqual([
        "EPIC.md",
        "inbox",
        "state.json",
      ]);
    }
    expect(fs.existsSync(path.join(root, ".claude", "epics", "nope"))).toBe(false);
  });

  it("concurrent note and report writers to the same epic keep every entry and every file", async () => {
    const tasks = Array.from({ length: 6 }, (_, i) => `${String(i + 1).padStart(3, "0")}-t${i + 1}.md`);
    const root = await withTasks(...tasks);
    for (const s of ["billing", "search", "infra"]) epic(root, ["create", s]);
    epic(root, ["link", "search", ...tasks]);

    // Real separate processes started together, all writing to search's state.json and inbox.
    const script = path.join(root, ".claude", "scripts", "maestro-epic.cjs");
    const launch = (args: string[], body: string) =>
      new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
        const child = spawn("node", [script, ...args], { env: env(root, SESSION_A), stdio: ["pipe", "pipe", "pipe"] });
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("close", (code) => resolve({ code, out, err }));
        child.stdin.end(body);
      });
    const jobs = [
      ...tasks.map((t) => launch(["report", "--task", t], `report body ${t}\n`)),
      ...Array.from({ length: 3 }, (_, i) =>
        launch(["note", "search", "--from-epic", "billing", "--file", "-"], `billing note ${i}\n`)
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        launch(["note", "search", "--from-epic", "infra", "--file", "-"], `infra note ${i}\n`)
      ),
    ];
    const results = await Promise.all(jobs);
    for (const r of results) expect(r.code, r.err).toBe(0);

    const log = stateOf(root, "search").log as Array<{ kind: string; id: string; file: string }>;
    const reports = log
      .filter((e) => e.kind === "report")
      .map((e) => e.id)
      .sort();
    const notes = log
      .filter((e) => e.kind === "note")
      .map((e) => e.id)
      .sort();
    expect(reports).toEqual(["r001", "r002", "r003", "r004", "r005", "r006"]);
    expect(notes).toEqual(["n001", "n002", "n003", "n004", "n005", "n006"]);

    // Each log entry's file exists, and the twelve bodies are all present exactly once.
    const dir = path.join(root, ".claude", "epics", "search");
    const bodies = log.map((e) => fs.readFileSync(path.join(dir, e.file), "utf8"));
    expect(fs.readdirSync(path.join(dir, "inbox"))).toHaveLength(12);
    for (const t of tasks) expect(bodies.filter((b) => b.includes(`report body ${t}`))).toHaveLength(1);
    for (const from of ["billing", "infra"])
      for (let i = 0; i < 3; i++) expect(bodies.filter((b) => b.includes(`${from} note ${i}`))).toHaveLength(1);
    expect(fs.existsSync(path.join(dir, ".lock"))).toBe(false);
    expect(JSON.parse(epic(root, ["list", "--json"]).stdout)).toContainEqual({
      slug: "search",
      manager: null,
      unacknowledged: 12,
    });
  });
});

describe("ready: the manager's spawn list (125)", () => {
  function writeBlocked(root: string, name: string, blockers: string[]) {
    fs.mkdirSync(tasksDir(root), { recursive: true });
    const refs = blockers.length ? blockers.map((b) => `- \`${b}\``).join("\n") : "None";
    fs.writeFileSync(path.join(tasksDir(root), name), `# ${name}\n\n## Blocked by\n\n${refs}\n`);
  }

  type ReadyJson = {
    slug: string;
    cwd: string;
    cap: number;
    slots: number;
    ready: Array<{ filename: string; worker: string; command: string; relativePath: string }>;
    running: Array<{ filename: string; sessionName: string | null }>;
    pending: Array<{ filename: string; worker: string }>;
  };
  const ready = (root: string, extra: string[] = []): ReadyJson =>
    JSON.parse(epic(root, ["ready", "e1", "--json", ...extra]).stdout);

  it("lists ready tasks, never blocked, claimed, done or other-epic ones", async () => {
    const root = await installed();
    writeBlocked(root, "001-free.md", []);
    writeBlocked(root, "002-claimed.md", []);
    writeBlocked(root, "003-blocked.md", ["001-free.md"]);
    writeBlocked(root, "004-done.md", []);
    writeBlocked(root, "005-after-done.md", ["004-done.md"]);
    writeBlocked(root, "006-other-epic.md", []);
    writeBlocked(root, "007-no-epic.md", []);
    expect(status(root, ["sync"]).code).toBe(0);
    expect(status(root, ["done", "004-done.md"]).code).toBe(0);
    epic(root, ["create", "e1"]);
    epic(root, ["create", "e2"]);
    epic(root, ["link", "e1", "001-free.md", "002-claimed.md", "003-blocked.md", "004-done.md", "005-after-done.md"]);
    epic(root, ["link", "e2", "006-other-epic.md"]);
    liveSession(root, SESSION_A);
    expect(status(root, ["claim", "002-claimed.md", "--name", "worker-one"], SESSION_A).code).toBe(0);

    const view = ready(root);
    expect(view.ready.map((t) => t.filename)).toEqual(["001-free.md", "005-after-done.md"]);
    expect(view.running).toEqual([{ filename: "002-claimed.md", sessionName: "worker-one" }]);
    expect(view.pending).toEqual([]);
    expect(view.cap).toBe(5);
    expect(view.slots).toBe(4);
    expect(fs.realpathSync(view.cwd)).toBe(fs.realpathSync(root));
    expect(view.ready[0]).toEqual({
      filename: "001-free.md",
      relativePath: ".claude/maestro-tasks/001-free.md",
      worker: "e1-001",
      command: "claude -n 'e1-001' '/maestro .claude/maestro-tasks/001-free.md'",
    });

    const text = epic(root, ["ready", "e1"]).stdout;
    expect(text).toContain("2 ready, unclaimed task(s); 1 running");
    expect(text).toContain("claude -n 'e1-001' '/maestro .claude/maestro-tasks/001-free.md'");
    expect(text).toContain('002-claimed.md  running in session "worker-one"');
    expect(text).not.toContain("003-blocked.md");
  });

  it("a dead claim does not hide a ready task, and closing its blocker makes a blocked task ready", async () => {
    const root = await installed();
    writeBlocked(root, "001-a.md", []);
    writeBlocked(root, "002-b.md", ["001-a.md"]);
    expect(status(root, ["sync"]).code).toBe(0);
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "001-a.md", "002-b.md"]);
    liveSession(root, SESSION_A);
    expect(status(root, ["claim", "001-a.md"], SESSION_A).code).toBe(0);
    expect(ready(root).ready).toEqual([]);

    // The claiming session ended: its directory is gone, so the claim is dead.
    fs.rmSync(path.join(root, ".claude", "maestro_sessions", SESSION_A), { recursive: true, force: true });
    expect(ready(root).ready.map((t) => t.filename)).toEqual(["001-a.md"]);

    expect(status(root, ["done", "001-a.md"]).code).toBe(0);
    expect(ready(root).ready.map((t) => t.filename)).toEqual(["002-b.md"]);
  });

  it("a task recorded on a spawned worker that has not claimed it yet is pending, not ready, and takes a slot", async () => {
    const root = await withTasks("001-a.md", "002-b.md");
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "001-a.md", "002-b.md"]);
    expect(epic(root, ["add-worker", "e1", "e1-001", "--task", "001-a.md"]).code).toBe(0);

    const view = ready(root, ["--cap", "2"]);
    expect(view.pending).toEqual([{ filename: "001-a.md", worker: "e1-001" }]);
    expect(view.ready.map((t) => t.filename)).toEqual(["002-b.md"]);
    expect(view.slots).toBe(1);
    expect(epic(root, ["ready", "e1"]).stdout).toContain('001-a.md  spawned as "e1-001", not claimed yet');

    // Removing the worker (it never started) makes the task ready again.
    epic(root, ["remove-worker", "e1", "e1-001"]);
    expect(ready(root).ready.map((t) => t.filename)).toEqual(["001-a.md", "002-b.md"]);
  });

  it("the cap limits the free slots, and the text marks which tasks wait for one", async () => {
    const names = ["001-a.md", "002-b.md", "003-c.md"];
    const root = await withTasks(...names);
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", ...names]);
    liveSession(root, SESSION_A);
    status(root, ["claim", "001-a.md", "--name", "w1"], SESSION_A);

    const view = ready(root, ["--cap", "2"]);
    expect(view.ready.map((t) => t.filename)).toEqual(["002-b.md", "003-c.md"]);
    expect(view.slots).toBe(1);
    const text = epic(root, ["ready", "e1", "--cap", "2"]).stdout;
    expect(text).toContain('002-b.md  worker "e1-002"  [spawn]');
    expect(text).toContain('003-c.md  worker "e1-003"  [waits for a slot]');

    expect(ready(root, ["--cap", "1"]).slots).toBe(0);
  });

  it("a stale 'ready' in the tracker never spawns a task whose blocker is not done", async () => {
    const root = await installed();
    writeBlocked(root, "001-a.md", []);
    writeBlocked(root, "002-b.md", ["001-a.md"]);
    expect(status(root, ["sync"]).code).toBe(0);
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "001-a.md", "002-b.md"]);
    // Hand-edit the tracker so 002 claims to be ready while its blocker 001 is still open.
    const tracker = statusJson(root);
    expect(tracker["002-b.md"].blockedBy).toEqual(["001-a.md"]);
    tracker["002-b.md"].status = "ready";
    fs.writeFileSync(path.join(tasksDir(root), "status.json"), JSON.stringify(tracker, null, 2));

    expect(ready(root).ready.map((t) => t.filename)).toEqual(["001-a.md"]);
  });

  it("a blocker in another epic (or in none) blocks until it is done", async () => {
    const root = await installed();
    writeBlocked(root, "001-other.md", []);
    writeBlocked(root, "002-loose.md", []);
    writeBlocked(root, "003-mine.md", ["001-other.md", "002-loose.md"]);
    expect(status(root, ["sync"]).code).toBe(0);
    epic(root, ["create", "e1"]);
    epic(root, ["create", "e2"]);
    epic(root, ["link", "e2", "001-other.md"]);
    epic(root, ["link", "e1", "003-mine.md"]);

    expect(ready(root).ready).toEqual([]);
    expect(status(root, ["done", "001-other.md"]).code).toBe(0);
    expect(ready(root).ready).toEqual([]);
    expect(status(root, ["done", "002-loose.md"]).code).toBe(0);
    expect(ready(root).ready.map((t) => t.filename)).toEqual(["003-mine.md"]);
  });

  it("a live claim wins over a recorded worker (running, not pending), and a done task is listed nowhere", async () => {
    const root = await withTasks("001-a.md", "002-b.md");
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "001-a.md", "002-b.md"]);
    liveSession(root, SESSION_A);
    expect(status(root, ["claim", "001-a.md", "--name", "e1-001"], SESSION_A).code).toBe(0);
    expect(epic(root, ["add-worker", "e1", "e1-001", "--task", "001-a.md"]).code).toBe(0);
    // A worker recorded with the path form of --task still matches its task.
    expect(epic(root, ["add-worker", "e1", "e1-002", "--task", ".claude/maestro-tasks/002-b.md"]).code).toBe(0);

    let view = ready(root);
    expect(view.running).toEqual([{ filename: "001-a.md", sessionName: "e1-001" }]);
    expect(view.pending).toEqual([{ filename: "002-b.md", worker: "e1-002" }]);
    expect(view.ready).toEqual([]);
    expect(view.slots).toBe(3);

    expect(status(root, ["done", "001-a.md"], SESSION_A).code).toBe(0);
    expect(status(root, ["done", "002-b.md"], SESSION_A).code).toBe(0);
    view = ready(root);
    expect(view).toMatchObject({ running: [], pending: [], ready: [], slots: 5 });
  });

  it("the default cap is 5: a sixth ready task waits, and slots never go below 0", async () => {
    const names = ["001-a.md", "002-b.md", "003-c.md", "004-d.md", "005-e.md", "006-f.md"];
    const root = await withTasks(...names);
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", ...names]);

    const view = ready(root);
    expect(view.cap).toBe(5);
    expect(view.slots).toBe(5);
    expect(view.ready).toHaveLength(6);
    const text = epic(root, ["ready", "e1"]).stdout;
    expect(text).toContain('005-e.md  worker "e1-005"  [spawn]');
    expect(text).toContain('006-f.md  worker "e1-006"  [waits for a slot]');
    expect(text.match(/\[spawn\]/g)).toHaveLength(5);

    // Over the cap: 1 running + 1 pending against a cap of 1 clamps to 0, never -1.
    liveSession(root, SESSION_A);
    expect(status(root, ["claim", "001-a.md", "--name", "w1"], SESSION_A).code).toBe(0);
    expect(epic(root, ["add-worker", "e1", "e1-002", "--task", "002-b.md"]).code).toBe(0);
    const over = ready(root, ["--cap", "1"]);
    expect(over.slots).toBe(0);
    expect(epic(root, ["ready", "e1", "--cap", "1"]).stdout).not.toContain("[spawn]");
  });

  it("names a worker for a task without a number after its basename", async () => {
    const root = await withTasks("cleanup.md");
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "cleanup.md"]);
    expect(ready(root).ready[0]).toMatchObject({
      worker: "e1-cleanup",
      command: "claude -n 'e1-cleanup' '/maestro .claude/maestro-tasks/cleanup.md'",
    });
  });

  it("run from a linked worktree, it prints the main checkout as the launch directory", async () => {
    const root = await withTasks("001-a.md");
    epic(root, ["create", "e1"]);
    epic(root, ["link", "e1", "001-a.md"]);
    execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], {
      cwd: root,
    });
    const wt = path.join(tmp, "wt");
    execFileSync("git", ["worktree", "add", "-q", wt], { cwd: root });

    const res = spawnSync(
      "node",
      [path.join(root, ".claude", "scripts", "maestro-epic.cjs"), "ready", "e1", "--json"],
      {
        encoding: "utf8",
        cwd: wt,
        env: env(wt, SESSION_A),
      }
    );
    expect(res.stderr).toBe("");
    expect(res.status).toBe(0);
    const view = JSON.parse(res.stdout) as ReadyJson;
    expect(fs.realpathSync(view.cwd)).toBe(fs.realpathSync(root));
    expect(view.ready.map((t) => t.filename)).toEqual(["001-a.md"]);
  });

  it("refuses a bad cap and an unknown epic", async () => {
    const root = await withTasks("001-a.md");
    epic(root, ["create", "e1"]);
    for (const cap of ["0", "-1", "two", "1.5"]) {
      const r = epic(root, ["ready", "e1", "--cap", cap]);
      expect(r.code).toBe(1);
      expect(r.stderr).toContain("--cap");
    }
    const none = epic(root, ["ready", "nope"]);
    expect(none.code).toBe(1);
    expect(none.stderr).toContain('no epic "nope"');
    expect(epic(root, ["ready"]).code).toBe(1);
  });
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
    const written = fs.existsSync(tasksDir(root))
      ? fs.readdirSync(tasksDir(root)).filter((f) => f.endsWith(".md"))
      : [];
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
