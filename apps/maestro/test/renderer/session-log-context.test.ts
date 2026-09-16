// `065`. `reduceSessionLog` and `pickSelection` are the entire multi-session tab logic, exported as
// pure functions specifically so this codebase's plain-node vitest setup (no DOM/component harness
// — see `session-log-context.tsx`'s own header comment) can exercise the init/entry/end/reset fold
// and the stable-selection rule directly, with no rendering involved.

import { describe, it, expect } from "vitest";
import {
  reduceSessionLog,
  pickSelection,
  sessionKey,
  startedAt,
  lastActivityAt,
  type SessionRecord,
} from "../../src/renderer/src/utils/session-log-context.js";
import type { SessionLogEntry } from "../../src/renderer/src/utils/maestro-session-log.js";

const entry = (origin: string, ts = "2026-01-01T00:00:00.000Z"): SessionLogEntry => ({ ts, origin, log: "x" });

/** A stepping fake clock: each call returns the next value in the queue (last value repeats). */
function fakeClock(...ticks: number[]): () => number {
  let i = 0;
  return () => ticks[Math.min(i++, ticks.length - 1)];
}

describe("reduceSessionLog", () => {
  it("init adds a new key as a live session with no entries and endedAt null", () => {
    const next = reduceSessionLog(
      new Map(),
      { type: "init", projectRoot: "/p", sessionId: "s1", entries: [] },
      fakeClock(100)
    );
    const record = next.get(sessionKey({ projectRoot: "/p", sessionId: "s1" }));
    expect(record).toEqual({
      projectRoot: "/p",
      sessionId: "s1",
      entries: [],
      status: "live",
      firstSeenAt: 100,
      endedAt: null,
    });
  });

  it("init with a non-empty snapshot seeds entries from the payload", () => {
    const snapshot = [entry("a"), entry("b")];
    const next = reduceSessionLog(
      new Map(),
      { type: "init", projectRoot: "/p", sessionId: "s1", entries: snapshot },
      fakeClock(1)
    );
    expect(next.get(sessionKey({ projectRoot: "/p", sessionId: "s1" }))?.entries).toEqual(snapshot);
  });

  it("entry appends to an existing session and keeps it live", () => {
    let sessions = reduceSessionLog(
      new Map(),
      { type: "init", projectRoot: "/p", sessionId: "s1", entries: [] },
      fakeClock(1)
    );
    sessions = reduceSessionLog(sessions, { type: "entry", projectRoot: "/p", sessionId: "s1", entry: entry("a") });
    const record = sessions.get(sessionKey({ projectRoot: "/p", sessionId: "s1" }))!;
    expect(record.entries).toEqual([entry("a")]);
    expect(record.status).toBe("live");
  });

  it("entry for an untracked key is a no-op — the map is unchanged", () => {
    const sessions = new Map<string, SessionRecord>();
    const next = reduceSessionLog(sessions, {
      type: "entry",
      projectRoot: "/p",
      sessionId: "ghost",
      entry: entry("a"),
    });
    expect(next).toBe(sessions);
    expect(next.size).toBe(0);
  });

  it("end for an untracked key is a no-op — the map is unchanged", () => {
    const sessions = new Map<string, SessionRecord>();
    const next = reduceSessionLog(sessions, { type: "end", projectRoot: "/p", sessionId: "ghost" });
    expect(next).toBe(sessions);
  });

  it("end flips status to ended and stamps endedAt from the clock", () => {
    let sessions = reduceSessionLog(
      new Map(),
      { type: "init", projectRoot: "/p", sessionId: "s1", entries: [] },
      fakeClock(1)
    );
    sessions = reduceSessionLog(sessions, { type: "end", projectRoot: "/p", sessionId: "s1" }, fakeClock(999));
    const record = sessions.get(sessionKey({ projectRoot: "/p", sessionId: "s1" }))!;
    expect(record.status).toBe("ended");
    expect(record.endedAt).toBe(999);
  });

  it("reset always returns an empty map regardless of prior contents", () => {
    let sessions = reduceSessionLog(
      new Map(),
      { type: "init", projectRoot: "/p", sessionId: "s1", entries: [] },
      fakeClock(1)
    );
    sessions = reduceSessionLog(
      sessions,
      { type: "init", projectRoot: "/p", sessionId: "s2", entries: [] },
      fakeClock(2)
    );
    expect(sessions.size).toBe(2);
    const next = reduceSessionLog(sessions, { type: "reset" });
    expect(next.size).toBe(0);
  });

  it("caps retained ended sessions at 3 GLOBALLY across projects, evicting the oldest endedAt first", () => {
    // Four sessions across two different projects — the cap must not be per-project.
    let sessions = new Map<string, SessionRecord>();
    const clock = fakeClock(1, 2, 3, 4);
    sessions = reduceSessionLog(sessions, { type: "init", projectRoot: "/p1", sessionId: "s1", entries: [] }, clock);
    sessions = reduceSessionLog(sessions, { type: "init", projectRoot: "/p2", sessionId: "s2", entries: [] }, clock);
    sessions = reduceSessionLog(sessions, { type: "init", projectRoot: "/p1", sessionId: "s3", entries: [] }, clock);
    sessions = reduceSessionLog(sessions, { type: "init", projectRoot: "/p2", sessionId: "s4", entries: [] }, clock);

    // End them in order s1 (oldest), s2, s3, then s4 — s4's end is the 4th ended session, which
    // must evict s1 (the oldest endedAt), even though s1 and s4 belong to different projects.
    const endClock = fakeClock(10, 20, 30, 40);
    sessions = reduceSessionLog(sessions, { type: "end", projectRoot: "/p1", sessionId: "s1" }, endClock);
    sessions = reduceSessionLog(sessions, { type: "end", projectRoot: "/p2", sessionId: "s2" }, endClock);
    sessions = reduceSessionLog(sessions, { type: "end", projectRoot: "/p1", sessionId: "s3" }, endClock);
    // 3 ended (at the cap, not over it) + s4 still live: nothing evicted yet.
    expect(sessions.size).toBe(4);
    sessions = reduceSessionLog(sessions, { type: "end", projectRoot: "/p2", sessionId: "s4" }, endClock);

    expect(sessions.size).toBe(3);
    expect(sessions.has(sessionKey({ projectRoot: "/p1", sessionId: "s1" }))).toBe(false);
    expect(sessions.has(sessionKey({ projectRoot: "/p2", sessionId: "s2" }))).toBe(true);
    expect(sessions.has(sessionKey({ projectRoot: "/p1", sessionId: "s3" }))).toBe(true);
    expect(sessions.has(sessionKey({ projectRoot: "/p2", sessionId: "s4" }))).toBe(true);
  });

  it("does not evict anything while at or under the cap", () => {
    let sessions = new Map<string, SessionRecord>();
    const clock = fakeClock(1, 2, 3);
    sessions = reduceSessionLog(sessions, { type: "init", projectRoot: "/p", sessionId: "s1", entries: [] }, clock);
    sessions = reduceSessionLog(sessions, { type: "init", projectRoot: "/p", sessionId: "s2", entries: [] }, clock);
    sessions = reduceSessionLog(sessions, { type: "init", projectRoot: "/p", sessionId: "s3", entries: [] }, clock);
    const endClock = fakeClock(10, 20, 30);
    sessions = reduceSessionLog(sessions, { type: "end", projectRoot: "/p", sessionId: "s1" }, endClock);
    sessions = reduceSessionLog(sessions, { type: "end", projectRoot: "/p", sessionId: "s2" }, endClock);
    sessions = reduceSessionLog(sessions, { type: "end", projectRoot: "/p", sessionId: "s3" }, endClock);
    expect(sessions.size).toBe(3);
  });

  it("a live session never counts against the ended cap, no matter how many are live", () => {
    let sessions = new Map<string, SessionRecord>();
    const clock = fakeClock(1, 2, 3, 4, 5);
    for (const id of ["s1", "s2", "s3", "s4", "s5"]) {
      sessions = reduceSessionLog(sessions, { type: "init", projectRoot: "/p", sessionId: id, entries: [] }, clock);
    }
    expect(sessions.size).toBe(5);
    // None ended — nothing evicted, even though 5 > MAX_RETAINED_ENDED.
    expect([...sessions.values()].every((s) => s.status === "live")).toBe(true);
  });
});

describe("pickSelection", () => {
  const live = (key: string, ts: string): SessionRecord => ({
    projectRoot: "/p",
    sessionId: key,
    entries: [entry("x", ts)],
    status: "live",
    firstSeenAt: 0,
    endedAt: null,
  });

  const ended = (key: string, ts: string, endedAt: number): SessionRecord => ({
    ...live(key, ts),
    status: "ended",
    endedAt,
  });

  it("returns null when there are no sessions at all", () => {
    expect(pickSelection([], null)).toBeNull();
    expect(pickSelection([], "anything")).toBeNull();
  });

  it("keeps the current selection when it still names a tracked session", () => {
    const sessions = [live("s1", "2026-01-01T00:00:00Z"), live("s2", "2026-01-02T00:00:00Z")];
    const currentKey = sessionKey({ projectRoot: "/p", sessionId: "s1" });
    // s2 is more recently active, but the selection must not move off s1.
    expect(pickSelection(sessions, currentKey)).toBe(currentKey);
  });

  it("keeps the current selection even after it ends, as long as it is still tracked", () => {
    const sessions = [ended("s1", "2026-01-01T00:00:00Z", 500), live("s2", "2026-01-02T00:00:00Z")];
    const currentKey = sessionKey({ projectRoot: "/p", sessionId: "s1" });
    expect(pickSelection(sessions, currentKey)).toBe(currentKey);
  });

  it("falls back to the most recently active LIVE session when currentKey is null", () => {
    const sessions = [
      live("s1", "2026-01-01T00:00:00Z"),
      live("s2", "2026-01-03T00:00:00Z"),
      live("s3", "2026-01-02T00:00:00Z"),
    ];
    expect(pickSelection(sessions, null)).toBe(sessionKey({ projectRoot: "/p", sessionId: "s2" }));
  });

  it("falls back to the most recently active LIVE session when currentKey names nothing tracked", () => {
    const sessions = [live("s1", "2026-01-01T00:00:00Z"), live("s2", "2026-01-03T00:00:00Z")];
    expect(pickSelection(sessions, "evicted-key")).toBe(sessionKey({ projectRoot: "/p", sessionId: "s2" }));
  });

  it("prefers a live session over a more recently active ended one", () => {
    const sessions = [ended("s1", "2026-01-05T00:00:00Z", 999), live("s2", "2026-01-01T00:00:00Z")];
    expect(pickSelection(sessions, null)).toBe(sessionKey({ projectRoot: "/p", sessionId: "s2" }));
  });

  it("falls back to the most recently active session of ANY status when none are live", () => {
    const sessions = [ended("s1", "2026-01-01T00:00:00Z", 100), ended("s2", "2026-01-03T00:00:00Z", 200)];
    expect(pickSelection(sessions, null)).toBe(sessionKey({ projectRoot: "/p", sessionId: "s2" }));
  });
});

describe("sessionKey / startedAt / lastActivityAt", () => {
  it("sessionKey is a stable identity that distinguishes both projectRoot and sessionId", () => {
    const k1 = sessionKey({ projectRoot: "/p", sessionId: "abc" });
    expect(sessionKey({ projectRoot: "/p", sessionId: "abc" })).toBe(k1); // stable across calls
    expect(sessionKey({ projectRoot: "/p2", sessionId: "abc" })).not.toBe(k1);
    expect(sessionKey({ projectRoot: "/p", sessionId: "abc2" })).not.toBe(k1);
  });

  // Fixed after being flagged while writing this suite: the template literal in `sessionKey`'s
  // source used to read `${s.projectRoot} ${s.sessionId}` with what LOOKED like an ordinary space
  // between the two interpolations, but the byte actually committed there was U+0000 (NUL), not
  // U+0020 (space) — a text viewer/editor renders both indistinguishably, and it made git treat
  // the whole file as binary. Harmless functionally (sessionKey's output is only ever used as an
  // opaque Map key / React `key` prop — see session-log.tsx, session-log-tabs.tsx), but replaced
  // with an explicit "::" separator so the source is a normal text file and no call site risks
  // tripping on an invisible character.
  it("sessionKey uses an explicit :: separator between projectRoot and sessionId", () => {
    expect(sessionKey({ projectRoot: "/p", sessionId: "abc" })).toBe("/p::abc");
  });

  it("startedAt prefers the first entry's parsed ts over firstSeenAt", () => {
    const record: SessionRecord = {
      projectRoot: "/p",
      sessionId: "s1",
      entries: [entry("a", "2026-01-01T00:00:00.000Z"), entry("b", "2026-01-02T00:00:00.000Z")],
      status: "live",
      firstSeenAt: 123,
      endedAt: null,
    };
    expect(startedAt(record)).toBe(Date.parse("2026-01-01T00:00:00.000Z"));
  });

  it("startedAt falls back to firstSeenAt when entries are empty", () => {
    const record: SessionRecord = {
      projectRoot: "/p",
      sessionId: "s1",
      entries: [],
      status: "live",
      firstSeenAt: 456,
      endedAt: null,
    };
    expect(startedAt(record)).toBe(456);
  });

  it("startedAt falls back to firstSeenAt when the first entry's ts is unparseable", () => {
    const record: SessionRecord = {
      projectRoot: "/p",
      sessionId: "s1",
      entries: [entry("a", "not-a-date")],
      status: "live",
      firstSeenAt: 789,
      endedAt: null,
    };
    expect(startedAt(record)).toBe(789);
  });

  it("lastActivityAt prefers the LAST entry's parsed ts, falling back to startedAt", () => {
    const record: SessionRecord = {
      projectRoot: "/p",
      sessionId: "s1",
      entries: [entry("a", "2026-01-01T00:00:00.000Z"), entry("b", "2026-01-05T00:00:00.000Z")],
      status: "live",
      firstSeenAt: 0,
      endedAt: null,
    };
    expect(lastActivityAt(record)).toBe(Date.parse("2026-01-05T00:00:00.000Z"));
  });

  it("lastActivityAt falls back to startedAt when entries are empty", () => {
    const record: SessionRecord = {
      projectRoot: "/p",
      sessionId: "s1",
      entries: [],
      status: "live",
      firstSeenAt: 42,
      endedAt: null,
    };
    expect(lastActivityAt(record)).toBe(42);
  });
});
