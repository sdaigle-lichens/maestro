// `152` item 5: session-sweep.ts now shares its option defaulting and removal loop, and the two
// idle caps must still differ on purpose: sweeping uses SESSION_SWEEP_IDLE_CAP_MS (24h), while
// deleting and listing use SESSION_DELETE_IDLE_CAP_MS (the claim cap, 15 min). The sessions below
// sit on each side of both boundaries, so a regression that gives the sweep the delete cap (or the
// reverse) changes at least one assertion. Real fs against temp projects; HOME and the own-session
// id are pinned so the developer's own session can neither be swept nor change a result.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  sweepStaleSessions,
  deleteSession,
  listDeletableSessions,
  SESSION_SWEEP_IDLE_CAP_MS,
  SESSION_DELETE_IDLE_CAP_MS,
} from "../../src/core/session-sweep.js";
import { listSessionIds } from "../../src/core/session-paths.js";

const MIN = 60_000;
const OWN = "own-session-152";

let tmp: string;
let proj: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-152-caps-"));
  vi.stubEnv("HOME", path.join(tmp, "home"));
  vi.stubEnv("CLAUDE_CODE_SESSION_ID", OWN);
  proj = path.join(tmp, "p");
  fs.mkdirSync(path.join(proj, ".claude"), { recursive: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const ids = () => listSessionIds(path.join(proj, ".claude"));

/** A session whose files and directory all carry `ageMs` of idleness. */
function makeSession(id: string, ageMs: number): void {
  const dir = path.join(proj, ".claude", "maestro_sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  const when = new Date(Date.now() - ageMs);
  const file = path.join(dir, "session.json");
  fs.writeFileSync(file, "{}\n");
  fs.utimesSync(file, when, when);
  fs.utimesSync(dir, when, when);
}

describe("the two idle caps are different values (152 item 5)", () => {
  it("sweeping is the 24h cap and deleting is the 15 min claim cap", () => {
    expect(SESSION_SWEEP_IDLE_CAP_MS).toBe(24 * 60 * MIN);
    expect(SESSION_DELETE_IDLE_CAP_MS).toBe(15 * MIN);
  });
});

describe("sweepStaleSessions uses the 24h cap, not the delete cap (152 item 5)", () => {
  it("keeps a 20 min idle session, which is past the delete cap but under the sweep cap", () => {
    makeSession("idle-20m", 20 * MIN);
    expect(sweepStaleSessions([proj]).count).toBe(0);
    expect(ids()).toEqual(["idle-20m"]);
  });

  it("keeps a 2h idle session, which is still under the sweep cap", () => {
    makeSession("idle-2h", 2 * 60 * MIN);
    expect(sweepStaleSessions([proj]).count).toBe(0);
  });

  it("removes a 25h idle session, past the sweep cap", () => {
    makeSession("idle-25h", 25 * 60 * MIN);
    expect(sweepStaleSessions([proj])).toMatchObject({ count: 1 });
    expect(ids()).toEqual([]);
  });

  it("an explicit idleCapMs replaces the 24h default", () => {
    makeSession("idle-20m", 20 * MIN);
    expect(sweepStaleSessions([proj], { idleCapMs: 15 * MIN }).count).toBe(1);
  });
});

describe("deleteSession and listDeletableSessions use the 15 min delete cap (152 item 5)", () => {
  it("deletes a 20 min idle session, past the delete cap", () => {
    makeSession("idle-20m", 20 * MIN);
    expect(deleteSession([proj], proj, "idle-20m")).toEqual({ removed: true });
    expect(ids()).toEqual([]);
  });

  it("refuses a 5 min idle session as running, under the delete cap", () => {
    makeSession("running-5m", 5 * MIN);
    expect(deleteSession([proj], proj, "running-5m")).toEqual({ removed: false, reason: "running" });
    expect(ids()).toEqual(["running-5m"]);
  });

  it("deletes a 25h idle session too: an older session is deletable, not only swept", () => {
    makeSession("idle-25h", 25 * 60 * MIN);
    expect(deleteSession([proj], proj, "idle-25h")).toEqual({ removed: true });
  });

  it("lists the 20 min idle session, and omits the 5 min running one", () => {
    makeSession("idle-20m", 20 * MIN);
    makeSession("running-5m", 5 * MIN);
    expect(listDeletableSessions([proj])).toEqual([{ projectRoot: proj, sessionId: "idle-20m" }]);
  });

  it("an explicit idleCapMs replaces the 15 min default for delete and list", () => {
    makeSession("idle-20m", 20 * MIN);
    expect(deleteSession([proj], proj, "idle-20m", { idleCapMs: 60 * MIN })).toEqual({
      removed: false,
      reason: "running",
    });
    expect(listDeletableSessions([proj], { idleCapMs: 60 * MIN })).toEqual([]);
    expect(listDeletableSessions([proj])).toEqual([{ projectRoot: proj, sessionId: "idle-20m" }]);
  });
});

describe("the shared removal and option defaults still honour the own-session guard (152 item 5)", () => {
  it("the sweep and the delete both refuse the own session, however old", () => {
    makeSession(OWN, 30 * 24 * 60 * MIN);
    expect(sweepStaleSessions([proj]).count).toBe(0);
    expect(deleteSession([proj], proj, OWN)).toEqual({ removed: false, reason: "own-session" });
    expect(ids()).toEqual([OWN]);
  });

  it("an injected env decides the own session for all three entry points", () => {
    makeSession("mine", 30 * 24 * 60 * MIN);
    const env = { CLAUDE_CODE_SESSION_ID: "mine" };
    expect(sweepStaleSessions([proj], { env }).count).toBe(0);
    expect(deleteSession([proj], proj, "mine", { env })).toEqual({ removed: false, reason: "own-session" });
    expect(listDeletableSessions([proj], { env })).toEqual([]);
    expect(sweepStaleSessions([proj], { env: {} }).count).toBe(1);
  });

  it("an injected clock moves all three entry points together", () => {
    makeSession("mid", 10 * MIN);
    const future = Date.now() + 60 * MIN;
    expect(sweepStaleSessions([proj], { now: future }).count).toBe(0);
    expect(listDeletableSessions([proj], { now: future })).toEqual([{ projectRoot: proj, sessionId: "mid" }]);
    expect(deleteSession([proj], proj, "mid", { now: future })).toEqual({ removed: true });
  });
});

// Not covered here, on purpose: the removal loop's failure path (a directory that cannot be
// deleted). The sweep swallows it and leaves the directory in place; a live sandbox with a
// read-only session directory would be needed to force it portably.
