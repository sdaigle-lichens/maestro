// `141` at the unit level: the heartbeat rule `isSessionLive` (claims.ts) now applies, and the one
// heartbeat step (`heartbeatTick`) with an injected clock and parent liveness. Real temp dirs, real
// files and real mtimes — nothing about fs is mocked. The installed-CLI twin and the real detached
// process are in session-heartbeat-cli.test.ts.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { claimTask, isSessionLive, readClaims } from "../../src/core/claims.js";
import { CLAIM_IDLE_CAP_MS, HEARTBEAT_STALE_MS } from "../../src/core/handoff-channels.js";
import {
  heartbeatIntervalMs,
  heartbeatTargets,
  heartbeatTick,
  heartbeatVerdict,
  parentProbe,
  parsePsLine,
  watchedPid,
  type ProcessInfo,
} from "../../src/core/session-heartbeat.js";

const A = "sess-hb-aaa";
const B = "sess-hb-bbb";
const MIN = 60 * 1000;

let tmp: string;
let root: string;
let claudeDir: string;
let tasksDir: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-141-hb-"));
  root = path.join(tmp, "p");
  claudeDir = path.join(root, ".claude");
  tasksDir = path.join(claudeDir, "maestro-tasks");
  fs.mkdirSync(tasksDir, { recursive: true });
  fs.writeFileSync(path.join(tasksDir, "001-a.md"), "# A\n\n## Blocked by\n\nNone\n");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const sessionDir = (id: string) => path.join(claudeDir, "maestro_sessions", id);
const hbFile = (id: string) => path.join(sessionDir(id), "heartbeat");
const pidFile = (id: string) => path.join(sessionDir(id), "heartbeat.pid");
const logFile = (id: string) => path.join(sessionDir(id), "log.jsonl");

function setMtime(file: string, ms: number) {
  fs.writeFileSync(file, fs.existsSync(file) ? fs.readFileSync(file) : "");
  const t = new Date(ms);
  fs.utimesSync(file, t, t);
}

/** A session dir with optional heartbeat / log at given mtimes (null = no such file). */
function session(id: string, opts: { heartbeat?: number | null; log?: number | null }) {
  fs.mkdirSync(sessionDir(id), { recursive: true });
  if (opts.heartbeat != null) setMtime(hbFile(id), opts.heartbeat);
  if (opts.log != null) setMtime(logFile(id), opts.log);
}

describe("isSessionLive with a heartbeat (claims.ts, 141)", () => {
  it("fresh heartbeat + log idle 20 min (past the cap) is live; a second session's claim is refused", () => {
    const now = Date.now();
    session(A, { heartbeat: now - 10_000, log: now - 20 * MIN });
    session(B, { heartbeat: now, log: now });
    expect(now - (now - 20 * MIN)).toBeGreaterThan(CLAIM_IDLE_CAP_MS); // the scenario really is past the cap

    expect(isSessionLive(claudeDir, A, now)).toBe(true);
    expect(claimTask(root, tasksDir, "001-a.md", A, now)).toEqual({ outcome: "claimed" });
    const second = claimTask(root, tasksDir, "001-a.md", B, now);
    expect(second.outcome).toBe("already-claimed");
    expect(readClaims(root, tasksDir, now).get("001-a.md")).toMatchObject({ sessionId: A, live: true });
  });

  it("fresh heartbeat and NO log at all (a session that never dispatched an agent) is live", () => {
    const now = Date.now();
    session(A, { heartbeat: now });
    expect(isSessionLive(claudeDir, A, now)).toBe(true);
  });

  it("heartbeat at mtime 0 + fresh log is dead, reaped on read, and another session wins at once", () => {
    const now = Date.now();
    session(A, { heartbeat: now, log: now });
    expect(claimTask(root, tasksDir, "001-a.md", A, now)).toEqual({ outcome: "claimed" });
    setMtime(hbFile(A), 0); // what the heartbeat does when claude is gone

    expect(isSessionLive(claudeDir, A, now)).toBe(false);
    session(B, { heartbeat: now });
    expect(claimTask(root, tasksDir, "001-a.md", B, now)).toEqual({ outcome: "claimed" });
    expect(readClaims(root, tasksDir, now).get("001-a.md")).toMatchObject({ sessionId: B, live: true });
  });

  it("readClaims reaps a zeroed-heartbeat claim file from disk", () => {
    const now = Date.now();
    session(A, { heartbeat: 0, log: now });
    fs.mkdirSync(path.join(tasksDir, "claims"), { recursive: true });
    const claim = path.join(tasksDir, "claims", "001-a.md.json");
    fs.writeFileSync(
      claim,
      JSON.stringify({ session_id: A, claimed_at: new Date(now).toISOString(), project_root: root })
    );

    expect(readClaims(root, tasksDir, now).get("001-a.md")).toMatchObject({ live: false });
    expect(fs.existsSync(claim)).toBe(false);
  });

  it("heartbeat just past HEARTBEAT_STALE_MS is dead even with a fresh log; just inside is live", () => {
    const now = Date.now();
    session(A, { heartbeat: now - HEARTBEAT_STALE_MS - 1000, log: now });
    session(B, { heartbeat: now - HEARTBEAT_STALE_MS + 1000, log: null });
    expect(isSessionLive(claudeDir, A, now)).toBe(false);
    expect(isSessionLive(claudeDir, B, now)).toBe(true);
  });

  it("no heartbeat falls back to the 15-minute log rule (fresh log live, 20-min-old log dead)", () => {
    const now = Date.now();
    session(A, { log: now - 5 * MIN });
    session(B, { log: now - 20 * MIN });
    expect(isSessionLive(claudeDir, A, now)).toBe(true);
    expect(isSessionLive(claudeDir, B, now)).toBe(false);
  });

  it("no heartbeat and no log is dead; a missing session dir is dead; an invalid id is dead", () => {
    session(A, {});
    expect(isSessionLive(claudeDir, A)).toBe(false);
    expect(isSessionLive(claudeDir, "sess-never-existed")).toBe(false);
    expect(isSessionLive(claudeDir, "../escape")).toBe(false);
  });

  it("a heartbeat left behind in a removed session dir does not matter — the missing dir wins", () => {
    const now = Date.now();
    session(A, { heartbeat: now, log: now });
    fs.rmSync(sessionDir(A), { recursive: true });
    expect(isSessionLive(claudeDir, A, now)).toBe(false);
  });
});

describe("heartbeatVerdict / heartbeatIntervalMs", () => {
  it("null without a heartbeat file, true within the stale window, false beyond", () => {
    const now = Date.now();
    fs.mkdirSync(sessionDir(A), { recursive: true });
    expect(heartbeatVerdict(sessionDir(A), now)).toBeNull();
    setMtime(hbFile(A), now - MIN);
    expect(heartbeatVerdict(sessionDir(A), now)).toBe(true);
    setMtime(hbFile(A), now - 4 * MIN);
    expect(heartbeatVerdict(sessionDir(A), now)).toBe(false);
  });

  it("the env override wins only when it is a positive number", () => {
    expect(heartbeatIntervalMs({ MAESTRO_HEARTBEAT_INTERVAL_MS: "250" })).toBe(250);
    for (const bad of [undefined, "", "0", "-5", "abc", "Infinity"]) {
      expect(heartbeatIntervalMs({ MAESTRO_HEARTBEAT_INTERVAL_MS: bad })).toBe(60_000);
    }
  });
});

describe("heartbeatTick (141)", () => {
  const OWN = 424242;
  const NOW = Date.UTC(2026, 9, 28, 12, 0, 0);

  function targets(id = A) {
    return heartbeatTargets(claudeDir, id);
  }

  it("parent alive: stamps heartbeat at the injected `now` and continues", () => {
    fs.mkdirSync(sessionDir(A), { recursive: true });
    fs.writeFileSync(pidFile(A), `${OWN}\n`);
    const t = targets();
    expect(t.pidFile).toBe(pidFile(A));

    expect(heartbeatTick({ parentAlive: true, ownPid: OWN, ...t, now: NOW })).toBe("continue");
    expect(fs.statSync(hbFile(A)).mtimeMs).toBe(NOW);
  });

  it("parent dead: heartbeat goes to mtime 0 and the tick says stop; isSessionLive then reads dead", () => {
    session(A, { heartbeat: Date.now(), log: Date.now() });
    fs.writeFileSync(pidFile(A), `${OWN}\n`);

    expect(heartbeatTick({ parentAlive: false, ownPid: OWN, ...targets(), now: NOW })).toBe("stop");
    expect(fs.statSync(hbFile(A)).mtimeMs).toBe(0);
    expect(isSessionLive(claudeDir, A)).toBe(false);
  });

  it("no existing session dir: stop, and nothing is created (dir, heartbeat or pid file)", () => {
    for (const parentAlive of [true, false]) {
      expect(heartbeatTick({ parentAlive, ownPid: OWN, ...targets(), now: NOW })).toBe("stop");
      expect(fs.existsSync(sessionDir(A))).toBe(false);
      expect(fs.existsSync(path.join(claudeDir, "maestro_sessions"))).toBe(false);
    }
  });

  it("pid file naming another pid: stop and touch nothing — not even when the parent is dead", () => {
    const before = Date.now() - 30_000;
    session(A, { heartbeat: before });
    fs.writeFileSync(pidFile(A), "999999\n");
    const mtimeBefore = fs.statSync(hbFile(A)).mtimeMs;

    expect(heartbeatTick({ parentAlive: true, ownPid: OWN, ...targets(), now: NOW })).toBe("stop");
    expect(fs.statSync(hbFile(A)).mtimeMs).toBe(mtimeBefore);
    // A superseded watcher must not zero the NEW owner's heartbeat when its own parent died.
    expect(heartbeatTick({ parentAlive: false, ownPid: OWN, ...targets(), now: NOW })).toBe("stop");
    expect(fs.statSync(hbFile(A)).mtimeMs).toBe(mtimeBefore);
    expect(fs.readFileSync(pidFile(A), "utf8")).toBe("999999\n");
  });

  it("pid file naming another pid with no heartbeat file yet: no heartbeat is created", () => {
    fs.mkdirSync(sessionDir(A), { recursive: true });
    fs.writeFileSync(pidFile(A), "999999\n");
    expect(heartbeatTick({ parentAlive: true, ownPid: OWN, ...targets(), now: NOW })).toBe("stop");
    expect(fs.existsSync(hbFile(A))).toBe(false);
  });

  it("missing pid file is treated as own: continue and stamp", () => {
    fs.mkdirSync(sessionDir(A), { recursive: true });
    expect(heartbeatTick({ parentAlive: true, ownPid: OWN, ...targets(), now: NOW })).toBe("continue");
    expect(fs.statSync(hbFile(A)).mtimeMs).toBe(NOW);
    expect(fs.existsSync(pidFile(A))).toBe(false); // the tick never writes ownership itself
  });

  it("garbage in the pid file is not a takeover: continue", () => {
    fs.mkdirSync(sessionDir(A), { recursive: true });
    fs.writeFileSync(pidFile(A), "not-a-pid\n");
    expect(heartbeatTick({ parentAlive: true, ownPid: OWN, ...targets(), now: NOW })).toBe("continue");
  });

  it("several session dirs: stamps only the existing ones and never creates a missing one", () => {
    const a = path.join(tmp, "dir-a");
    const b = path.join(tmp, "dir-b-missing");
    fs.mkdirSync(a);
    expect(heartbeatTick({ parentAlive: true, ownPid: OWN, pidFile: null, sessionDirs: [a, b], now: NOW })).toBe(
      "continue"
    );
    expect(fs.statSync(path.join(a, "heartbeat")).mtimeMs).toBe(NOW);
    expect(fs.existsSync(b)).toBe(false);
  });

  it("successive ticks advance the mtime with the injected clock", () => {
    fs.mkdirSync(sessionDir(A), { recursive: true });
    heartbeatTick({ parentAlive: true, ownPid: OWN, ...targets(), now: NOW });
    heartbeatTick({ parentAlive: true, ownPid: OWN, ...targets(), now: NOW + MIN });
    expect(fs.statSync(hbFile(A)).mtimeMs).toBe(NOW + MIN);
  });
});

describe("watchedPid / parsePsLine / parentProbe", () => {
  const table = (rows: Record<number, ProcessInfo | null>) => (pid: number) => rows[pid] ?? null;

  it("skips shell parents up to the first non-shell, and stops at an unreadable process", () => {
    const infos = table({
      10: { ppid: 20, name: "bash", startTime: "1" },
      20: { ppid: 30, name: "sh", startTime: "1" },
      30: { ppid: 1, name: "claude", startTime: "1" },
    });
    expect(watchedPid(10, infos)).toBe(30);
    expect(watchedPid(30, infos)).toBe(30);
    expect(watchedPid(77, infos)).toBe(77);
  });

  it("never walks to init and gives up after a bounded number of shells", () => {
    expect(watchedPid(10, table({ 10: { ppid: 1, name: "bash", startTime: null } }))).toBe(10);
    const chain: Record<number, ProcessInfo> = {};
    for (let i = 1; i <= 10; i++) chain[100 + i] = { ppid: 100 + i + 1, name: "zsh", startTime: null };
    expect(watchedPid(101, table(chain))).toBe(105);
  });

  it("parsePsLine reads `ppid comm` output and rejects junk", () => {
    expect(parsePsLine("  123 /usr/bin/bash\n")).toEqual({ ppid: 123, name: "bash", startTime: null });
    expect(parsePsLine("")).toBeNull();
    expect(parsePsLine("PPID COMM")).toBeNull();
  });

  it("parentProbe goes false when the start time changes (pid reuse) or the pid is gone", () => {
    let start = "100";
    const probe = parentProbe(process.pid, () => ({ ppid: 1, name: "node", startTime: start }));
    expect(probe()).toBe(true);
    start = "200";
    expect(probe()).toBe(false);
    expect(parentProbe(2 ** 22 + 12345)()).toBe(false);
  });
});
