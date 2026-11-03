// `141` through the shipped runtime, under real conditions:
//
//   1. The hand-written CJS twin of `isSessionLive` (maestro-task-status.cjs, installed into a temp
//      project) reaches the same verdict as claims.ts for every heartbeat scenario, through both the
//      `claim` command and the worktree decision (`worktree`, `freeform-check`).
//   2. The real SessionStart hook (plugins/maestro/scripts/maestro-session-heartbeat.js) run from a
//      short-lived stand-in parent: the hook returns promptly, its detached child keeps `heartbeat`
//      fresh, zeroes it and exits once the parent is killed, and a second SessionStart takes over.
//
// Nothing is mocked: real files, real mtimes, real spawned processes. HOME is pinned and
// CLAUDE_CODE_SESSION_ID is always set or deleted (test-maestro's hook-script-tests rules). Every
// spawned process — stand-in parents AND the detached heartbeat children — is killed in afterEach.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn, spawnSync, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { isSessionLive } from "../../src/core/claims.js";
import { defaultish } from "./fixtures/configs.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const HOOK = path.join(PLUGIN_ROOT, "scripts", "maestro-session-heartbeat.js");

const A = "sess-aaa-141";
const B = "sess-bbb-141";
const MIN = 60 * 1000;

let tmp: string;
const standIns: ChildProcess[] = [];
const detachedPids = new Set<number>();

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-141-cli-"));
});

afterEach(async () => {
  for (const p of standIns.splice(0)) {
    if (p.exitCode === null && p.signalCode === null) {
      p.kill("SIGKILL");
      await new Promise((r) => p.once("exit", r));
    }
  }
  for (const pid of detachedPids) {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      // already gone
    }
  }
  detachedPids.clear();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── helpers ──────────────────────────────────────────────────────────────────────────────────────

async function installed(name: string): Promise<string> {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeConfig(root, defaultish);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "reports.sqlite"),
    path.join(tmp, "tags.sqlite"),
    path.join(tmp, "handoffs.sqlite")
  );
  // A commit, so the worktree decision can actually create a worktree when it decides to.
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init"], {
    cwd: root,
  });
  return root;
}

function cli(root: string, args: string[], sessionId: string) {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-task-status.cjs"), ...args], {
    encoding: "utf8",
    env: pinnedEnv(tmp, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: sessionId }),
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const claudeDirOf = (root: string) => path.join(root, ".claude");
const tasksDir = (root: string) => path.join(root, ".claude", "maestro-tasks");
const claimPath = (root: string, f: string) => path.join(tasksDir(root), "claims", `${f}.json`);
const sessionDir = (root: string, id: string) => path.join(root, ".claude", "maestro_sessions", id);
const hbFile = (root: string, id: string) => path.join(sessionDir(root, id), "heartbeat");
const pidFileOf = (root: string, id: string) => path.join(sessionDir(root, id), "heartbeat.pid");

function writeTask(root: string, filename: string) {
  fs.mkdirSync(tasksDir(root), { recursive: true });
  fs.writeFileSync(path.join(tasksDir(root), filename), `# ${filename}\n\n## Blocked by\n\nNone\n`);
}

function setMtime(file: string, ms: number) {
  if (!fs.existsSync(file)) fs.writeFileSync(file, "");
  fs.utimesSync(file, new Date(ms), new Date(ms));
}

type Scenario = {
  name: string;
  /** Build session A's dir (or not) in `root`. */
  build: (root: string, now: number) => void;
  live: boolean;
};

const SCENARIOS: Scenario[] = [
  {
    name: "fresh heartbeat + log idle 20 min",
    build: (root, now) => {
      fs.mkdirSync(sessionDir(root, A), { recursive: true });
      setMtime(hbFile(root, A), now - 5000);
      setMtime(path.join(sessionDir(root, A), "log.jsonl"), now - 20 * MIN);
    },
    live: true,
  },
  {
    name: "fresh heartbeat, no log at all",
    build: (root, now) => {
      fs.mkdirSync(sessionDir(root, A), { recursive: true });
      setMtime(hbFile(root, A), now);
    },
    live: true,
  },
  {
    name: "heartbeat at mtime 0 + fresh log",
    build: (root, now) => {
      fs.mkdirSync(sessionDir(root, A), { recursive: true });
      setMtime(hbFile(root, A), 0);
      setMtime(path.join(sessionDir(root, A), "log.jsonl"), now);
    },
    live: false,
  },
  {
    name: "heartbeat 4 min old (past HEARTBEAT_STALE_MS) + fresh log",
    build: (root, now) => {
      fs.mkdirSync(sessionDir(root, A), { recursive: true });
      setMtime(hbFile(root, A), now - 4 * MIN);
      setMtime(path.join(sessionDir(root, A), "log.jsonl"), now);
    },
    live: false,
  },
  {
    name: "no heartbeat, fresh log (old rule: live)",
    build: (root, now) => {
      fs.mkdirSync(sessionDir(root, A), { recursive: true });
      setMtime(path.join(sessionDir(root, A), "log.jsonl"), now - 5 * MIN);
    },
    live: true,
  },
  {
    name: "no heartbeat, log idle 20 min (old rule: dead)",
    build: (root, now) => {
      fs.mkdirSync(sessionDir(root, A), { recursive: true });
      setMtime(path.join(sessionDir(root, A), "log.jsonl"), now - 20 * MIN);
    },
    live: false,
  },
  {
    name: "no heartbeat and no log",
    build: (root) => {
      fs.mkdirSync(sessionDir(root, A), { recursive: true });
    },
    live: false,
  },
  {
    name: "missing session dir",
    build: () => {},
    live: false,
  },
];

function plantClaim(root: string, filename: string, sessionId: string) {
  fs.mkdirSync(path.join(tasksDir(root), "claims"), { recursive: true });
  fs.writeFileSync(
    claimPath(root, filename),
    JSON.stringify({ session_id: sessionId, claimed_at: new Date().toISOString(), project_root: root })
  );
}

function liveB(root: string) {
  fs.mkdirSync(sessionDir(root, B), { recursive: true });
  setMtime(hbFile(root, B), Date.now());
}

// ── 1. CJS twin agrees with claims.ts ───────────────────────────────────────────────────────────

describe("maestro-task-status.cjs claim agrees with claims.ts isSessionLive (141)", () => {
  for (const s of SCENARIOS) {
    it(`${s.name} → ${s.live ? "live: claim refused" : "dead: claim reaped and won at once"}`, async () => {
      const root = await installed("claim");
      writeTask(root, "001-a.md");
      s.build(root, Date.now());
      plantClaim(root, "001-a.md", A);
      liveB(root);

      expect(isSessionLive(claudeDirOf(root), A)).toBe(s.live); // TS verdict on the same fixture (read-only)
      const run = cli(root, ["claim", "001-a.md"], B);

      expect(run.code).toBe(0);
      const holder = JSON.parse(fs.readFileSync(claimPath(root, "001-a.md"), "utf8")).session_id;
      if (s.live) {
        expect(run.stdout).toContain("already claimed");
        expect(holder).toBe(A);
      } else {
        expect(run.stdout).toContain("claimed");
        expect(run.stdout).not.toContain("already claimed");
        expect(holder).toBe(B);
      }
    });
  }
});

describe("maestro-task-status.cjs worktree decision honours the heartbeat (141)", () => {
  for (const s of SCENARIOS) {
    it(`worktree: ${s.name} → ${s.live ? "sees the other session" : "main checkout"}`, async () => {
      const root = await installed("wt");
      writeTask(root, "001-a.md");
      writeTask(root, "002-b.md");
      s.build(root, Date.now());
      plantClaim(root, "001-a.md", A);
      liveB(root);

      expect(isSessionLive(claudeDirOf(root), A)).toBe(s.live);
      const run = cli(root, ["worktree", "002-b.md"], B);

      expect(run.code).toBe(0);
      if (s.live) {
        expect(run.stdout).not.toContain("no other live session");
        expect(run.stdout).toContain("worktree");
        expect(fs.existsSync(path.join(sessionDir(root, B), "worktree.json"))).toBe(true);
      } else {
        expect(run.stdout).toContain("no other live session");
        expect(fs.existsSync(path.join(sessionDir(root, B), "worktree.json"))).toBe(false);
      }
    });
  }

  it("freeform-check: a freeform session with only a fresh heartbeat (no log, no claim) counts as live", async () => {
    const root = await installed("ff");
    fs.mkdirSync(sessionDir(root, A), { recursive: true });
    fs.writeFileSync(path.join(sessionDir(root, A), "session.json"), JSON.stringify({ workflow: "default" }));
    setMtime(hbFile(root, A), Date.now());
    liveB(root);

    const run = cli(root, ["freeform-check"], B);
    expect(run.code).toBe(0);
    expect(run.stdout).not.toContain("no other live session");

    // Zero A's heartbeat (its process ended): a fresh freeform-check from a third session sees nobody.
    setMtime(hbFile(root, A), 0);
    const C = "sess-ccc-141";
    fs.mkdirSync(sessionDir(root, C), { recursive: true });
    const again = cli(root, ["freeform-check"], C);
    // A is dead, and B (moved into a worktree above) recorded no workflow and holds no claim, so C
    // works in the main checkout.
    expect(again.stdout).toContain("no other live session");
  });
});

// ── 2. The real heartbeat process ────────────────────────────────────────────────────────────────

const STAND_IN = `
const { spawn } = require("child_process");
const [hook, payload] = process.argv.slice(2);
const t0 = Date.now();
const h = spawn(process.execPath, [hook], { stdio: ["pipe", "ignore", "ignore"], env: process.env });
h.stdin.end(payload);
h.on("exit", (code) => process.stdout.write(JSON.stringify({ hookMs: Date.now() - t0, code }) + "\\n"));
setInterval(() => {}, 1 << 30);
`;

function procState(pid: number): string | null {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
    return stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3);
  } catch {
    return null;
  }
}

/** Running, and not a zombie waiting on a reaper that is not us. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  const st = procState(pid);
  return st !== "Z" && st !== "X";
}

async function until<T>(label: string, fn: () => T | null | undefined | false, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${label}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

function heartbeatProject(name: string): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  writeConfig(root, defaultish);
  return root;
}

/** Start a stand-in "claude" that runs the hook once and stays alive; resolves with the hook's result. */
async function startSession(root: string, sessionId: string, intervalMs = 200) {
  const script = path.join(tmp, "stand-in.cjs");
  if (!fs.existsSync(script)) fs.writeFileSync(script, STAND_IN);
  const payload = JSON.stringify({
    hook_event_name: "SessionStart",
    session_id: sessionId,
    cwd: root,
    source: "startup",
  });
  const env = pinnedEnv(tmp, { MAESTRO_HEARTBEAT_INTERVAL_MS: String(intervalMs) });
  delete env.CLAUDE_PROJECT_DIR;
  const p = spawn(process.execPath, [script, HOOK, payload], { stdio: ["ignore", "pipe", "ignore"], env });
  standIns.push(p);
  let out = "";
  p.stdout!.on("data", (d) => (out += String(d)));
  const result = await until("hook exit reported by the stand-in", () =>
    out.includes("\n") ? (JSON.parse(out.split("\n")[0]!) as { hookMs: number; code: number }) : null
  );
  return { parent: p, ...result };
}

async function killAndReap(p: ChildProcess) {
  const exited = new Promise((r) => p.once("exit", r));
  p.kill("SIGKILL");
  await exited;
}

function readPid(file: string): number | null {
  try {
    const n = Number.parseInt(fs.readFileSync(file, "utf8").trim(), 10);
    return Number.isInteger(n) ? n : null;
  } catch {
    return null;
  }
}

const mtime = (f: string) => {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return null;
  }
};

describe("maestro-session-heartbeat.js as a real process (141)", () => {
  it("returns promptly, keeps heartbeat fresh, then zeroes it and exits once the parent dies", async () => {
    const root = heartbeatProject("live");
    const s = await startSession(root, A);
    expect(s.code).toBe(0);
    expect(s.hookMs).toBeLessThan(3000); // does not wait on the detached child

    const child = await until("heartbeat.pid written", () => readPid(pidFileOf(root, A)));
    detachedPids.add(child);
    expect(child).not.toBe(s.parent.pid);
    expect(alive(child)).toBe(true);

    const m1 = await until("first heartbeat", () => mtime(hbFile(root, A)));
    const m2 = await until("heartbeat advances", () => {
      const m = mtime(hbFile(root, A));
      return m !== null && m > m1 ? m : null;
    });
    expect(Date.now() - m2).toBeLessThan(5000);
    expect(isSessionLive(claudeDirOf(root), A)).toBe(true); // no log.jsonl at all — the heartbeat alone

    await killAndReap(s.parent);

    await until("heartbeat zeroed", () => mtime(hbFile(root, A)) === 0);
    await until("heartbeat child exits", () => !alive(child));
    expect(isSessionLive(claudeDirOf(root), A)).toBe(false);
    expect(fs.existsSync(sessionDir(root, A))).toBe(true); // the dir is left for SessionEnd, not removed
  }, 30_000);

  it("a second SessionStart takes over heartbeat.pid; the older watcher stops and its parent's death no longer zeroes", async () => {
    const root = heartbeatProject("takeover");
    const first = await startSession(root, A);
    const child1 = await until("first heartbeat.pid", () => readPid(pidFileOf(root, A)));
    detachedPids.add(child1);

    const second = await startSession(root, A);
    const child2 = await until("heartbeat.pid taken over", () => {
      const p = readPid(pidFileOf(root, A));
      return p !== null && p !== child1 ? p : null;
    });
    detachedPids.add(child2);

    // The older watcher stops at its next tick (plus its 2 s confirm, since its parent is still alive).
    await until("older watcher exits", () => !alive(child1), 15_000);
    expect(alive(child2)).toBe(true);

    // Kill the OLDER parent: nobody watches it any more, so the session stays live.
    await killAndReap(first.parent);
    const after = Date.now();
    await until("heartbeat still advancing after the old parent died", () => {
      const m = mtime(hbFile(root, A));
      return m !== null && m >= after - 50 ? m : null;
    });
    expect(mtime(hbFile(root, A))).not.toBe(0);
    expect(isSessionLive(claudeDirOf(root), A)).toBe(true);

    // The current parent dies: zeroed, child exits.
    await killAndReap(second.parent);
    await until("heartbeat zeroed", () => mtime(hbFile(root, A)) === 0);
    await until("current watcher exits", () => !alive(child2));
  }, 40_000);

  it("the watcher stops, without recreating anything, when the session dir is removed (final SessionEnd)", async () => {
    const root = heartbeatProject("end");
    await startSession(root, A);
    const child = await until("heartbeat.pid written", () => readPid(pidFileOf(root, A)));
    detachedPids.add(child);
    await until("first heartbeat", () => mtime(hbFile(root, A)));

    fs.rmSync(sessionDir(root, A), { recursive: true, force: true });
    await until("watcher exits after its dir is gone", () => !alive(child), 15_000);
    expect(fs.existsSync(sessionDir(root, A))).toBe(false);
  }, 30_000);

  it("no-ops without .claude/maestro.json: exit 0, no session dir, no watcher", async () => {
    const root = path.join(tmp, "bare");
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    const s = await startSession(root, A);
    expect(s.code).toBe(0);
    // Give a would-be child several intervals to show up.
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline) await new Promise((r) => setTimeout(r, 50));
    expect(fs.existsSync(path.join(root, ".claude", "maestro_sessions"))).toBe(false);
  }, 15_000);

  it("ignores a non-SessionStart event and bad stdin", () => {
    const root = heartbeatProject("other-event");
    const env = pinnedEnv(tmp, { MAESTRO_HEARTBEAT_INTERVAL_MS: "200" });
    for (const input of [
      JSON.stringify({ hook_event_name: "UserPromptSubmit", session_id: A, cwd: root }),
      "not json",
      "",
    ]) {
      const r = spawnSync(process.execPath, [HOOK], { input, encoding: "utf8", env, timeout: 10_000 });
      expect(r.status).toBe(0);
      expect(r.stdout).toBe("");
    }
    expect(fs.existsSync(sessionDir(root, A))).toBe(false);
  });
});
