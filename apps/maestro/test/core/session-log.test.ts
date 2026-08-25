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

import { tailSessionLog, sessionLogFileFor, parseLogLines } from "../../src/core/session-log.js";

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

  it("stops polling once unsubscribed", () => {
    fs.writeFileSync(logFile, entry("a") + "\n");
    const r = record();
    tailSessionLog(tmp, r.handlers, TICK)();
    fs.appendFileSync(logFile, entry("b") + "\n");
    vi.advanceTimersByTime(TICK * 5);
    expect(r.events).toEqual(["init:1"]);
  });
});

describe("parseLogLines", () => {
  it("skips malformed lines and entries without an origin", () => {
    const raw = [entry("a"), "not json", JSON.stringify({ ts: "x", log: "y" }), entry("b")].join("\n");
    expect(parseLogLines(raw).map((e) => e.origin)).toEqual(["a", "b"]);
  });
});
