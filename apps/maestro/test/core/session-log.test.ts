// The tail's lifecycle across the transitions a real session puts it through: file appears, is
// appended to by several processes, is wiped at SessionEnd, then a new session starts.
//
// `sawFile` is what decides whether a vanished file emits `reset`, and it is seeded from
// `snapshot.length > 0` — so an empty-but-existing log is indistinguishable from an absent one.
// That reads like a bug and isn't: `sawFile` means "we have emitted entries a consumer would
// need to be told to drop", and an empty file has none, so the suppressed reset is a no-op.
// These tests pin that reading, because the next person to look at it will have the same doubt.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { tailSessionLog, tailSessionLogs, sessionLogFileFor, parseLogLines } from "../../src/core/session-log.js";

const TICK = 1000;

let tmp: string;
let logFile: string;

const entry = (origin: string) => JSON.stringify({ ts: "2026-07-30T00:00:00Z", origin, log: "x" });

beforeEach(() => {
  vi.useFakeTimers();
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-tail-"));
  fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
  logFile = sessionLogFileFor(tmp);
});

afterEach(() => {
  vi.useRealTimers();
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** Collect every callback the tail fires, in order. */
function record() {
  const events: string[] = [];
  const entries: string[] = [];
  return {
    events,
    entries,
    handlers: {
      init: (es: { origin: string }[]) => {
        events.push(`init:${es.length}`);
      },
      entry: (e: { origin: string }) => {
        events.push("entry");
        entries.push(e.origin);
      },
      reset: () => {
        events.push("reset");
      },
    },
  };
}

describe("tailSessionLog", () => {
  it("emits a snapshot immediately, then only appended entries", () => {
    fs.writeFileSync(logFile, entry("a") + "\n");
    const r = record();
    const stop = tailSessionLog(tmp, r.handlers, TICK);
    try {
      expect(r.events).toEqual(["init:1"]);

      fs.appendFileSync(logFile, entry("b") + "\n");
      vi.advanceTimersByTime(TICK);
      expect(r.events).toEqual(["init:1", "entry"]);
      expect(r.entries).toEqual(["b"]);

      // A tick with no new lines is silent — the poll must not re-emit the tail it already sent.
      vi.advanceTimersByTime(TICK * 3);
      expect(r.events).toEqual(["init:1", "entry"]);
    } finally {
      stop();
    }
  });

  it("resets once when SessionEnd removes a log that had entries", () => {
    fs.writeFileSync(logFile, entry("a") + "\n");
    const r = record();
    const stop = tailSessionLog(tmp, r.handlers, TICK);
    try {
      fs.rmSync(logFile);
      vi.advanceTimersByTime(TICK);
      expect(r.events).toEqual(["init:1", "reset"]);

      // Still gone on later ticks: reset is edge-triggered, not level-triggered.
      vi.advanceTimersByTime(TICK * 3);
      expect(r.events).toEqual(["init:1", "reset"]);
    } finally {
      stop();
    }
  });

  it("suppresses the reset for a log that was empty — there is nothing to drop", () => {
    fs.writeFileSync(logFile, "");
    const r = record();
    const stop = tailSessionLog(tmp, r.handlers, TICK);
    try {
      expect(r.events).toEqual(["init:0"]);
      fs.rmSync(logFile);
      vi.advanceTimersByTime(TICK * 2);
      expect(r.events).toEqual(["init:0"]);
    } finally {
      stop();
    }
  });

  it("picks up a new session's entries after a reset", () => {
    fs.writeFileSync(logFile, entry("a") + "\n");
    const r = record();
    const stop = tailSessionLog(tmp, r.handlers, TICK);
    try {
      fs.rmSync(logFile);
      vi.advanceTimersByTime(TICK);

      fs.writeFileSync(logFile, entry("b") + "\n");
      vi.advanceTimersByTime(TICK);
      // lineCount was zeroed by the reset, so the new session's first line is a fresh entry.
      expect(r.events).toEqual(["init:1", "reset", "entry"]);
      expect(r.entries).toEqual(["b"]);
    } finally {
      stop();
    }
  });

  it("re-inits rather than emitting a negative tail when the file shrinks", () => {
    fs.writeFileSync(logFile, [entry("a"), entry("b"), entry("c")].join("\n") + "\n");
    const r = record();
    const stop = tailSessionLog(tmp, r.handlers, TICK);
    try {
      expect(r.events).toEqual(["init:3"]);
      fs.writeFileSync(logFile, entry("z") + "\n");
      vi.advanceTimersByTime(TICK);
      expect(r.events).toEqual(["init:3", "reset", "init:1"]);
    } finally {
      stop();
    }
  });

  // `064`. `sessionLogFileFor()` is re-resolved on EVERY poll, so "the newest session" can change
  // underneath a live tail. `lineCount` is a position in a FILE, not in a path — the tail has to
  // know which file it counted, or a flip splices two sessions into one rendered log.
  //
  // Which log is "newest" is decided by mtime, so every file here has its mtime set explicitly:
  // two writes in the same millisecond tie, and a tie would make the test's outcome an accident.
  describe("re-resolving to a different session's log (064)", () => {
    const T1 = new Date("2026-01-01T00:00:00Z");
    const T2 = new Date("2026-01-02T00:00:00Z");

    function writeSessionLog(id: string, origins: string[], mtime: Date): string {
      const dir = path.join(tmp, ".claude", "maestro_sessions", id);
      fs.mkdirSync(dir, { recursive: true });
      const file = path.join(dir, "log.jsonl");
      fs.writeFileSync(file, origins.map(entry).join("\n") + (origins.length ? "\n" : ""));
      fs.utimesSync(file, mtime, mtime);
      return file;
    }

    it("re-inits instead of splicing a LONGER sibling's tail onto the previous session's entries", () => {
      // THE REGRESSION. Session A is being tailed with 3 entries; session B becomes the newest
      // with 5. Without tracking which file lineCount counts, `entries.slice(3)` of B's file was
      // emitted as an APPEND to A's — the view then showed A's 3 entries followed by B's last 2,
      // rendered as one continuous log of a session that never existed.
      writeSessionLog("sess-a", ["a1", "a2", "a3"], T1);
      const r = record();
      const stop = tailSessionLog(tmp, r.handlers, TICK);
      try {
        expect(r.events).toEqual(["init:3"]);

        writeSessionLog("sess-b", ["b1", "b2", "b3", "b4", "b5"], T2);
        vi.advanceTimersByTime(TICK);

        expect(r.events).toEqual(["init:3", "reset", "init:5"]);
        // Not one `entry` event: nothing was appended to what the consumer already had.
        expect(r.entries).toEqual([]);
      } finally {
        stop();
      }
    });

    it("re-inits on a flip to a SHORTER sibling too — both branches share one resync path", () => {
      writeSessionLog("sess-a", ["a1", "a2", "a3", "a4", "a5"], T1);
      const r = record();
      const stop = tailSessionLog(tmp, r.handlers, TICK);
      try {
        expect(r.events).toEqual(["init:5"]);

        writeSessionLog("sess-b", ["b1", "b2"], T2);
        vi.advanceTimersByTime(TICK);

        expect(r.events).toEqual(["init:5", "reset", "init:2"]);
        expect(r.entries).toEqual([]);
      } finally {
        stop();
      }
    });

    it("picks up the first session to appear after the tail started, with no spurious reset", () => {
      // A tail that subscribed before any session existed has emitted nothing a consumer would
      // need to be told to drop, so the file switch must NOT announce a reset.
      const r = record();
      const stop = tailSessionLog(tmp, r.handlers, TICK);
      try {
        expect(r.events).toEqual(["init:0"]);

        writeSessionLog("sess-a", ["a1", "a2"], T1);
        vi.advanceTimersByTime(TICK);

        expect(r.events).toEqual(["init:0", "init:2"]);
      } finally {
        stop();
      }
    });

    it("keeps tailing the same session across appends while a stale sibling sits beside it", () => {
      // The flip must be keyed on which file is newest, not merely on another directory existing:
      // an older sibling must not steal the tail, and an append must still arrive as one entry.
      writeSessionLog("sess-old", ["o1", "o2"], T1);
      const live = writeSessionLog("sess-live", ["l1"], T2);
      const r = record();
      const stop = tailSessionLog(tmp, r.handlers, TICK);
      try {
        expect(r.events).toEqual(["init:1"]);

        fs.appendFileSync(live, entry("l2") + "\n"); // a real append bumps mtime to now — still newest
        vi.advanceTimersByTime(TICK);

        expect(r.events).toEqual(["init:1", "entry"]);
        expect(r.entries).toEqual(["l2"]);
      } finally {
        stop();
      }
    });

    it("falls over to a live sibling when the tailed session's directory goes at SessionEnd", () => {
      writeSessionLog("sess-b", ["b1", "b2"], T1);
      writeSessionLog("sess-a", ["a1", "a2", "a3"], T2); // newest — the one being tailed
      const r = record();
      const stop = tailSessionLog(tmp, r.handlers, TICK);
      try {
        expect(r.events).toEqual(["init:3"]);

        fs.rmSync(path.join(tmp, ".claude", "maestro_sessions", "sess-a"), { recursive: true, force: true });
        vi.advanceTimersByTime(TICK);

        // Not reset-and-stay-empty: the sibling is still live and becomes the tail's subject.
        expect(r.events).toEqual(["init:3", "reset", "init:2"]);
      } finally {
        stop();
      }
    });
  });

  it("stops polling once unsubscribed", () => {
    fs.writeFileSync(logFile, entry("a") + "\n");
    const r = record();
    tailSessionLog(tmp, r.handlers, TICK)();
    fs.appendFileSync(logFile, entry("b") + "\n");
    vi.advanceTimersByTime(TICK * 5);
    expect(r.events).toEqual(["init:1"]);
  });
});

// `065`. `tailSessionLogs` is the multi-session, multi-project sibling of `tailSessionLog` above:
// one poll loop, keyed `Map<projectRoot, Map<sessionId, lineCount>>`, driven by a caller-supplied
// `getProjectRoots()` allow-list re-derived on every tick. Unlike `tailSessionLog`, a session's
// identity IS its map key for its whole life (`064` gave every session a permanent file), so there
// is no path-flip/splice hazard to guard here — the four scenarios below are the ones the `065`
// acceptance checklist calls out explicitly, plus two more (`allow-list removal`, `truncation`)
// that are part of the same function's contract and would otherwise ship untested.
describe("tailSessionLogs (065)", () => {
  let tmpA: string;
  let tmpB: string;

  beforeEach(() => {
    vi.useFakeTimers();
    tmpA = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-multitail-a-"));
    tmpB = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-multitail-b-"));
    fs.mkdirSync(path.join(tmpA, ".claude"), { recursive: true });
    fs.mkdirSync(path.join(tmpB, ".claude"), { recursive: true });
  });

  afterEach(() => {
    vi.useRealTimers();
    fs.rmSync(tmpA, { recursive: true, force: true });
    fs.rmSync(tmpB, { recursive: true, force: true });
  });

  function sessionLogPath(root: string, id: string): string {
    return path.join(root, ".claude", "maestro_sessions", id, "log.jsonl");
  }

  function writeSession(root: string, id: string, origins: string[]): void {
    const file = sessionLogPath(root, id);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, origins.map(entry).join("\n") + (origins.length ? "\n" : ""));
  }

  /** Collect every callback the multi-session tail fires, tagged with (root, sessionId). */
  function recordMulti() {
    const events: string[] = [];
    return {
      events,
      handlers: {
        init: (root: string, id: string, entries: { origin: string }[]) => {
          events.push(`init:${root}:${id}:${entries.length}`);
        },
        entry: (root: string, id: string, e: { origin: string }) => {
          events.push(`entry:${root}:${id}:${e.origin}`);
        },
        end: (root: string, id: string) => {
          events.push(`end:${root}:${id}`);
        },
      },
    };
  }

  it("a second session's directory appearing adds a tab and emits nothing for the first", () => {
    writeSession(tmpA, "sess-1", ["a1"]);
    const r = recordMulti();
    const stop = tailSessionLogs(() => [tmpA], r.handlers, TICK);
    try {
      expect(r.events).toEqual([`init:${tmpA}:sess-1:1`]);

      writeSession(tmpA, "sess-2", ["b1"]);
      vi.advanceTimersByTime(TICK);

      // The new session gets its own init; sess-1 (unchanged on disk) gets nothing at all.
      expect(r.events).toEqual([`init:${tmpA}:sess-1:1`, `init:${tmpA}:sess-2:1`]);
    } finally {
      stop();
    }
  });

  it("one session's directory disappearing emits end for it alone", () => {
    writeSession(tmpA, "sess-1", ["a1"]);
    writeSession(tmpA, "sess-2", ["b1"]);
    const r = recordMulti();
    const stop = tailSessionLogs(() => [tmpA], r.handlers, TICK);
    try {
      expect(r.events).toEqual([`init:${tmpA}:sess-1:1`, `init:${tmpA}:sess-2:1`]);

      fs.rmSync(path.join(tmpA, ".claude", "maestro_sessions", "sess-1"), { recursive: true, force: true });
      vi.advanceTimersByTime(TICK);

      // sess-2's directory is untouched, so it must not also end.
      expect(r.events).toEqual([`init:${tmpA}:sess-1:1`, `init:${tmpA}:sess-2:1`, `end:${tmpA}:sess-1`]);
    } finally {
      stop();
    }
  });

  it("interleaved appends across two sessions in two different projects each reach their own tab", () => {
    writeSession(tmpA, "sess-1", ["a1"]);
    writeSession(tmpB, "sess-2", ["b1"]);
    const r = recordMulti();
    const stop = tailSessionLogs(() => [tmpA, tmpB], r.handlers, TICK);
    try {
      expect(r.events).toEqual([`init:${tmpA}:sess-1:1`, `init:${tmpB}:sess-2:1`]);

      fs.appendFileSync(sessionLogPath(tmpA, "sess-1"), entry("a2") + "\n");
      fs.appendFileSync(sessionLogPath(tmpB, "sess-2"), entry("b2") + "\n");
      vi.advanceTimersByTime(TICK);

      expect(r.events).toEqual([
        `init:${tmpA}:sess-1:1`,
        `init:${tmpB}:sess-2:1`,
        `entry:${tmpA}:sess-1:a2`,
        `entry:${tmpB}:sess-2:b2`,
      ]);
    } finally {
      stop();
    }
  });

  it("a project absent from disk contributes no tabs and does not throw", () => {
    writeSession(tmpA, "sess-1", ["a1"]);
    const missingRoot = path.join(os.tmpdir(), "maestro-nonexistent-project-" + Math.random().toString(36).slice(2));
    const r = recordMulti();
    let stop: () => void = () => {};
    expect(() => {
      stop = tailSessionLogs(() => [tmpA, missingRoot], r.handlers, TICK);
    }).not.toThrow();
    try {
      expect(r.events).toEqual([`init:${tmpA}:sess-1:1`]);

      expect(() => vi.advanceTimersByTime(TICK * 3)).not.toThrow();
      // The absent project never contributes a tab of its own.
      expect(r.events).toEqual([`init:${tmpA}:sess-1:1`]);
    } finally {
      stop();
    }
  });

  it("a project removed from the allow-list ends every session it was covering", () => {
    writeSession(tmpA, "sess-1", ["a1"]);
    writeSession(tmpB, "sess-2", ["b1"]);
    let roots = [tmpA, tmpB];
    const r = recordMulti();
    const stop = tailSessionLogs(() => roots, r.handlers, TICK);
    try {
      expect(r.events).toEqual([`init:${tmpA}:sess-1:1`, `init:${tmpB}:sess-2:1`]);

      roots = [tmpA]; // tmpB closed and not recent, or explicitly forgotten
      vi.advanceTimersByTime(TICK);

      expect(r.events).toEqual([`init:${tmpA}:sess-1:1`, `init:${tmpB}:sess-2:1`, `end:${tmpB}:sess-2`]);
    } finally {
      stop();
    }
  });

  it("resyncs with an end+init, not a negative tail, when a session's log is truncated underneath it", () => {
    writeSession(tmpA, "sess-1", ["a1", "a2", "a3"]);
    const r = recordMulti();
    const stop = tailSessionLogs(() => [tmpA], r.handlers, TICK);
    try {
      expect(r.events).toEqual([`init:${tmpA}:sess-1:3`]);

      fs.writeFileSync(sessionLogPath(tmpA, "sess-1"), entry("z1") + "\n");
      vi.advanceTimersByTime(TICK);

      expect(r.events).toEqual([`init:${tmpA}:sess-1:3`, `end:${tmpA}:sess-1`, `init:${tmpA}:sess-1:1`]);
    } finally {
      stop();
    }
  });
});

describe("parseLogLines", () => {
  it("skips malformed lines and entries without an origin", () => {
    const raw = [entry("a"), "not json", JSON.stringify({ ts: "x", log: "y" }), entry("b")].join("\n");
    expect(parseLogLines(raw).map((e) => e.origin)).toEqual(["a", "b"]);
  });
});
