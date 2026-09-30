// session-sweep.ts (`068`): orphaned session directories are removed, live and ambiguous ones never.
// Real fs against temp projects. HOME and CLAUDE_CODE_SESSION_ID are pinned for the whole file so
// the developer's own session (set inside a real Claude Code session) can neither be swept nor
// change any result.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { sweepStaleSessions, deleteSession, listDeletableSessions, SESSION_SWEEP_IDLE_CAP_MS } from "../../src/core/session-sweep.js";
import { listSessionIds } from "../../src/core/session-paths.js";

const DAY = SESSION_SWEEP_IDLE_CAP_MS;
const OWN = "own-session-id";

let tmp: string;
let projA: string;
let projB: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-068-"));
  vi.stubEnv("HOME", path.join(tmp, "home"));
  vi.stubEnv("CLAUDE_CODE_SESSION_ID", OWN);
  projA = path.join(tmp, "a");
  projB = path.join(tmp, "b");
  fs.mkdirSync(path.join(projA, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(projB, ".claude"), { recursive: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const dirOf = (proj: string, id: string) => path.join(proj, ".claude", "maestro_sessions", id);
const ids = (proj: string) => listSessionIds(path.join(proj, ".claude"));

/** A session directory whose files AND directory all carry `ageMs` of idleness. */
function makeSession(proj: string, id: string, ageMs: number, files = ["log.jsonl", "session.json"]): void {
  const dir = dirOf(proj, id);
  fs.mkdirSync(dir, { recursive: true });
  const when = new Date(Date.now() - ageMs);
  for (const f of files) {
    fs.writeFileSync(path.join(dir, f), "{}\n");
    fs.utimesSync(path.join(dir, f), when, when);
  }
  fs.utimesSync(dir, when, when);
}

describe("sweepStaleSessions (068)", () => {
  it("removes an old directory and leaves a recently active one", () => {
    makeSession(projA, "old", DAY + 3_600_000);
    makeSession(projA, "fresh", 60_000);
    const res = sweepStaleSessions([projA]);
    expect(res.count).toBe(1);
    expect(res.removed).toEqual([{ projectRoot: projA, sessionId: "old" }]);
    expect(ids(projA)).toEqual(["fresh"]);
  });

  it("keeps a session whose log is stale but another file in it was touched recently", () => {
    makeSession(projA, "mixed", DAY + 3_600_000);
    const state = path.join(dirOf(projA, "mixed"), "session.json");
    fs.utimesSync(state, new Date(), new Date());
    expect(sweepStaleSessions([projA]).count).toBe(0);
    expect(ids(projA)).toEqual(["mixed"]);
  });

  it("treats a session with a fresh log as live even in a project other than the one being run from", () => {
    makeSession(projB, "other-project-live", 30_000);
    makeSession(projB, "other-project-dead", DAY * 3);
    expect(sweepStaleSessions([projA, projB]).count).toBe(1);
    expect(ids(projB)).toEqual(["other-project-live"]);
  });

  it("never removes the calling process's own session, however old", () => {
    makeSession(projA, OWN, DAY * 30);
    expect(sweepStaleSessions([projA]).count).toBe(0);
    expect(ids(projA)).toEqual([OWN]);
  });

  it("honours an injected env for the own-session check", () => {
    makeSession(projA, "mine", DAY * 30);
    expect(sweepStaleSessions([projA], { env: { CLAUDE_CODE_SESSION_ID: "mine" } }).count).toBe(0);
    expect(sweepStaleSessions([projA], { env: {} }).count).toBe(1);
  });

  it("cannot tell -> live: a future mtime is never swept", () => {
    makeSession(projA, "skewed", -DAY * 2);
    expect(sweepStaleSessions([projA]).count).toBe(0);
  });

  it("cannot tell -> live: a just-created empty directory is never swept", () => {
    fs.mkdirSync(dirOf(projA, "brand-new"), { recursive: true });
    expect(sweepStaleSessions([projA]).count).toBe(0);
    expect(ids(projA)).toEqual(["brand-new"]);
  });

  it("an old empty directory (no log ever written) is swept", () => {
    makeSession(projA, "empty-old", DAY * 2, []);
    expect(sweepStaleSessions([projA]).count).toBe(1);
  });

  it("cannot tell -> live: a symlinked session directory is neither followed nor removed", () => {
    const target = path.join(tmp, "elsewhere");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "precious"), "x");
    const root = path.join(projA, ".claude", "maestro_sessions");
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync(target, path.join(root, "linked"));
    expect(sweepStaleSessions([projA], { now: Date.now() + DAY * 10 }).count).toBe(0);
    expect(fs.existsSync(path.join(target, "precious"))).toBe(true);
  });

  it("ignores non-session entries in maestro_sessions/ (.gitignore, invalid names)", () => {
    const root = path.join(projA, ".claude", "maestro_sessions");
    fs.mkdirSync(path.join(root, "bad.name"), { recursive: true });
    fs.writeFileSync(path.join(root, ".gitignore"), "*\n");
    expect(sweepStaleSessions([projA], { now: Date.now() + DAY * 10 }).count).toBe(0);
    expect(fs.existsSync(path.join(root, "bad.name"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".gitignore"))).toBe(true);
  });

  it("is a no-op for a project with no sessions, a missing project, and a duplicated root", () => {
    expect(sweepStaleSessions([projA, path.join(tmp, "nope")]).count).toBe(0);
    makeSession(projA, "old", DAY * 2);
    expect(sweepStaleSessions([projA, projA]).count).toBe(1);
  });

  it("does not touch the legacy flat files", () => {
    const legacy = path.join(projA, ".claude", "maestro_session.log.jsonl");
    fs.writeFileSync(legacy, "{}\n");
    fs.utimesSync(legacy, new Date(0), new Date(0));
    sweepStaleSessions([projA]);
    expect(fs.existsSync(legacy)).toBe(true);
  });

  it("respects a custom idle cap and clock", () => {
    makeSession(projA, "s", 10_000);
    expect(sweepStaleSessions([projA], { idleCapMs: 5_000 }).count).toBe(1);
    makeSession(projA, "t", 10_000);
    expect(sweepStaleSessions([projA], { idleCapMs: 5_000, now: Date.now() - 60_000 }).count).toBe(0);
  });
});

describe("deleteSession / listDeletableSessions (068)", () => {
  const MIN = 60_000;
  it("deletes an idle session younger than the 24h sweep cap", () => {
    makeSession(projA, "idle", 30 * MIN);
    expect(deleteSession([projA], projA, "idle")).toEqual({ removed: true });
    expect(ids(projA)).toEqual([]);
  });

  it("refuses a running session, and keeps it", () => {
    makeSession(projA, "running", MIN);
    expect(deleteSession([projA], projA, "running")).toEqual({ removed: false, reason: "running" });
    expect(ids(projA)).toEqual(["running"]);
  });

  it("refuses the own session, invalid ids, and projects outside the allow-list", () => {
    makeSession(projA, OWN, DAY);
    expect(deleteSession([projA], projA, OWN)).toEqual({ removed: false, reason: "own-session" });
    expect(deleteSession([projA], projA, "../x")).toEqual({ removed: false, reason: "invalid" });
    makeSession(projB, "idle", DAY);
    expect(deleteSession([projA], projB, "idle")).toEqual({ removed: false, reason: "invalid" });
    expect(ids(projB)).toEqual(["idle"]);
  });

  it("reports not-found for a directory already gone, and refuses a symlink", () => {
    expect(deleteSession([projA], projA, "gone")).toEqual({ removed: false, reason: "not-found" });
    const target = path.join(tmp, "elsewhere");
    fs.mkdirSync(target);
    const root = path.join(projA, ".claude", "maestro_sessions");
    fs.mkdirSync(root, { recursive: true });
    fs.symlinkSync(target, path.join(root, "linked"));
    expect(deleteSession([projA], projA, "linked", { now: Date.now() + DAY }).removed).toBe(false);
    expect(fs.existsSync(target)).toBe(true);
  });

  it("listDeletableSessions matches exactly what deleteSession accepts", () => {
    makeSession(projA, "idle", 30 * MIN);
    makeSession(projA, "running", MIN);
    makeSession(projB, "idle-b", DAY);
    makeSession(projA, OWN, DAY);
    const list = listDeletableSessions([projA, projB]);
    expect(list).toEqual([
      { projectRoot: projA, sessionId: "idle" },
      { projectRoot: projB, sessionId: "idle-b" },
    ]);
    for (const s of list) expect(deleteSession([projA, projB], s.projectRoot, s.sessionId)).toEqual({ removed: true });
  });
});
