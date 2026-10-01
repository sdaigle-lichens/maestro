// session-ipc.ts (`070`): the decisions behind the sweep / delete / titles IPC handlers. Real fs
// against temp projects; HOME and CLAUDE_CODE_SESSION_ID are pinned so the developer's own session
// and ~/.claude transcripts can never change a result.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { composeAllowedRoots, titlesForRefs, sweepAndRetarget, deleteAndRetarget } from "../../src/core/session-ipc.js";
import { SESSION_SWEEP_IDLE_CAP_MS } from "../../src/core/session-sweep.js";
import { sessionTitleKey } from "../../src/core/session-title.js";

const DAY = SESSION_SWEEP_IDLE_CAP_MS;
const HOUR = 3_600_000;
const OWN = "own-session-id";

let tmp: string;
let projA: string;
let projB: string;
let outside: string;
// Explicit env for title lookups: pinned HOME, no CLAUDE_CONFIG_DIR override.
let pinnedEnv: Record<string, string | undefined>;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-070-"));
  vi.stubEnv("HOME", path.join(tmp, "home"));
  vi.stubEnv("CLAUDE_CODE_SESSION_ID", OWN);
  vi.stubEnv("CLAUDE_CONFIG_DIR", "");
  pinnedEnv = { HOME: path.join(tmp, "home"), CLAUDE_CODE_SESSION_ID: OWN };
  projA = path.join(tmp, "a");
  projB = path.join(tmp, "b");
  outside = path.join(tmp, "outside");
  for (const p of [projA, projB, outside]) fs.mkdirSync(path.join(p, ".claude"), { recursive: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

const dirOf = (proj: string, id: string) => path.join(proj, ".claude", "maestro_sessions", id);

function makeSession(proj: string, id: string, ageMs: number): void {
  const dir = dirOf(proj, id);
  fs.mkdirSync(dir, { recursive: true });
  const when = new Date(Date.now() - ageMs);
  fs.writeFileSync(path.join(dir, "log.jsonl"), "{}\n");
  fs.utimesSync(path.join(dir, "log.jsonl"), when, when);
  fs.utimesSync(dir, when, when);
}

/** A session whose active task gives it a resolvable title. */
function makeTitledSession(proj: string, id: string, title: string): void {
  const dir = dirOf(proj, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({ active_task: "001-x.md" }));
  fs.mkdirSync(path.join(proj, ".claude", "maestro-tasks"), { recursive: true });
  fs.writeFileSync(path.join(proj, ".claude", "maestro-tasks", "001-x.md"), `# ${title}\n`);
}

describe("composeAllowedRoots (070)", () => {
  it("is the open project followed by the recent ones", () => {
    expect(composeAllowedRoots({ current: { root: projA }, recent: [{ root: projB }] })).toEqual([projA, projB]);
  });

  it("uses only recent when no project is open", () => {
    expect(composeAllowedRoots({ current: null, recent: [{ root: projB }] })).toEqual([projB]);
    expect(composeAllowedRoots({ current: null, recent: [] })).toEqual([]);
  });

  it("collapses an open project that is also listed as recent", () => {
    expect(composeAllowedRoots({ current: { root: projA }, recent: [{ root: projA }, { root: projB }] })).toEqual([
      projA,
      projB,
    ]);
  });

  it("collapses a symlinked root onto its real path (first spelling wins)", () => {
    const link = path.join(tmp, "link-to-a");
    fs.symlinkSync(projA, link, "dir");
    expect(composeAllowedRoots({ current: { root: projA }, recent: [{ root: link }] })).toEqual([projA]);
    expect(composeAllowedRoots({ current: { root: link }, recent: [{ root: projA }] })).toEqual([link]);
  });

  it("collapses a non-canonical spelling (trailing slash, ..)", () => {
    const odd = path.join(projA, "..", "a") + path.sep;
    expect(composeAllowedRoots({ current: { root: projA }, recent: [{ root: odd }] })).toHaveLength(1);
  });
});

describe("titlesForRefs (070)", () => {
  it("resolves refs inside the allow-list", () => {
    makeTitledSession(projA, "s1", "Build the thing");
    const out = titlesForRefs([projA], [{ projectRoot: projA, sessionId: "s1" }], pinnedEnv);
    expect(out).toEqual({ [sessionTitleKey(projA, "s1")]: "Build the thing" });
  });

  it("returns null for a ref outside the allow-list, without resolving it, and keeps every asked-for key", () => {
    makeTitledSession(projA, "s1", "Allowed");
    makeTitledSession(outside, "s2", "Must not leak");
    const out = titlesForRefs(
      [projA],
      [
        { projectRoot: projA, sessionId: "s1" },
        { projectRoot: outside, sessionId: "s2" },
        { projectRoot: projA, sessionId: "no-such-session" },
      ],
      pinnedEnv
    );
    expect(Object.keys(out).sort()).toEqual(
      [sessionTitleKey(projA, "s1"), sessionTitleKey(outside, "s2"), sessionTitleKey(projA, "no-such-session")].sort()
    );
    expect(out[sessionTitleKey(projA, "s1")]).toBe("Allowed");
    expect(out[sessionTitleKey(outside, "s2")]).toBeNull();
    expect(out[sessionTitleKey(projA, "no-such-session")]).toBeNull();
  });

  it("returns null for every ref when the allow-list is empty", () => {
    makeTitledSession(projA, "s1", "T");
    const out = titlesForRefs([], [{ projectRoot: projA, sessionId: "s1" }], pinnedEnv);
    expect(out).toEqual({ [sessionTitleKey(projA, "s1")]: null });
  });

  it("drops malformed entries and tolerates a non-array", () => {
    const good = { projectRoot: projA, sessionId: "s1" };
    const out = titlesForRefs(
      [projA],
      [null, 5, {}, { projectRoot: projA }, { sessionId: "x" }, { projectRoot: 1, sessionId: "y" }, good],
      pinnedEnv
    );
    expect(Object.keys(out)).toEqual([sessionTitleKey(projA, "s1")]);
    expect(titlesForRefs([projA], "nope", pinnedEnv)).toEqual({});
    expect(titlesForRefs([projA], undefined, pinnedEnv)).toEqual({});
  });

  it("falls back to the ambient environment (the pinned HOME) when no env is passed", () => {
    const sid = "tr1";
    const slug = projA.replace(/[^A-Za-z0-9]/g, "-");
    const dir = path.join(tmp, "home", ".claude", "projects", slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${sid}.jsonl`),
      JSON.stringify({ type: "ai-title", aiTitle: "From transcript" }) + "\n"
    );
    expect(titlesForRefs([projA], [{ projectRoot: projA, sessionId: sid }])).toEqual({
      [sessionTitleKey(projA, sid)]: "From transcript",
    });
  });
});

describe("sweepAndRetarget (070)", () => {
  it("does not retarget when nothing is removed", () => {
    makeSession(projA, "fresh", 60_000);
    const retarget = vi.fn();
    expect(sweepAndRetarget([projA], retarget)).toBe(0);
    expect(retarget).not.toHaveBeenCalled();
    expect(fs.existsSync(dirOf(projA, "fresh"))).toBe(true);
  });

  it("does not retarget on an empty allow-list", () => {
    const retarget = vi.fn();
    expect(sweepAndRetarget([], retarget)).toBe(0);
    expect(retarget).not.toHaveBeenCalled();
  });

  it("does not retarget when the only old session is the caller's own", () => {
    makeSession(projA, OWN, DAY + HOUR);
    const retarget = vi.fn();
    expect(sweepAndRetarget([projA], retarget)).toBe(0);
    expect(retarget).not.toHaveBeenCalled();
  });

  it("retargets exactly once when one session is removed", () => {
    makeSession(projA, "old", DAY + HOUR);
    const retarget = vi.fn();
    expect(sweepAndRetarget([projA], retarget)).toBe(1);
    expect(retarget).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(dirOf(projA, "old"))).toBe(false);
  });

  it("retargets exactly once when several sessions across projects are removed", () => {
    makeSession(projA, "old1", DAY + HOUR);
    makeSession(projA, "old2", DAY + HOUR);
    makeSession(projB, "old3", DAY + HOUR);
    const retarget = vi.fn();
    expect(sweepAndRetarget([projA, projB], retarget)).toBe(3);
    expect(retarget).toHaveBeenCalledTimes(1);
  });

  it("forwards options to the sweep", () => {
    makeSession(projA, "recent", 60_000);
    const retarget = vi.fn();
    expect(sweepAndRetarget([projA], retarget, { idleCapMs: 1000 })).toBe(1);
    expect(retarget).toHaveBeenCalledTimes(1);
  });
});

describe("deleteAndRetarget (070)", () => {
  it("retargets exactly once when the session is removed", () => {
    makeSession(projA, "idle", HOUR);
    const retarget = vi.fn();
    expect(deleteAndRetarget([projA], projA, "idle", retarget)).toEqual({ removed: true });
    expect(retarget).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(dirOf(projA, "idle"))).toBe(false);
  });

  it.each([
    ["running", () => makeSession(projA, "busy", 60_000), "busy", "running"],
    ["not-found", () => undefined, "ghost", "not-found"],
    ["own-session", () => makeSession(projA, OWN, HOUR), OWN, "own-session"],
    ["invalid id", () => undefined, "../escape", "invalid"],
  ])("does not retarget when refused: %s", (_n, setup, id, reason) => {
    setup();
    const retarget = vi.fn();
    expect(deleteAndRetarget([projA], projA, id, retarget)).toEqual({ removed: false, reason });
    expect(retarget).not.toHaveBeenCalled();
  });

  it("does not retarget or delete for a project outside the allow-list", () => {
    makeSession(outside, "idle", HOUR);
    const retarget = vi.fn();
    expect(deleteAndRetarget([projA], outside, "idle", retarget)).toEqual({ removed: false, reason: "invalid" });
    expect(retarget).not.toHaveBeenCalled();
    expect(fs.existsSync(dirOf(outside, "idle"))).toBe(true);
  });
});
