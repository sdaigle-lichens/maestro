// Agent channels (`036`): lanes, stamps, retire, sweep. The hook end (SubagentStart inlining a
// delivery, SubagentStop stamping) is exercised against the COPIED scripts in install.test.ts;
// this file is the pure module underneath both.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  channelDir,
  laneFor,
  writeStamp,
  readLane,
  retire,
  sweep,
  formatStampedContent,
  parseStampedContent,
  CHANNEL_AGE_CAP_MS,
} from "../../src/core/handoff-channels.js";

let projectDir: string;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-channels-"));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

function write(receiver: string, sender: string, body: string): string {
  const p = laneFor(projectDir, sender, receiver);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}

describe("laneFor / channelDir", () => {
  it("a sender always writes to <receiver>/<sender>.1.md", () => {
    expect(laneFor(projectDir, "backend", "test")).toBe(
      path.join(projectDir, ".claude", "channels", "test", "backend.1.md")
    );
  });

  it("channelDir is the receiver's own lane directory", () => {
    expect(channelDir(projectDir, "test")).toBe(path.join(projectDir, ".claude", "channels", "test"));
  });
});

describe("stamp format", () => {
  it("round-trips through format/parse", () => {
    const stamped = formatStampedContent("BODY\n", "run-1");
    expect(parseStampedContent(stamped)).toEqual({ runId: "run-1", body: "BODY\n" });
  });

  it("an unstamped body parses with a null runId and its content untouched", () => {
    expect(parseStampedContent("BODY\n")).toEqual({ runId: null, body: "BODY\n" });
  });
});

describe("writeStamp", () => {
  it("stamps every unstamped file whose filename SENDER segment matches, across every receiver", () => {
    write("test", "backend", "TEST BODY\n");
    write("reviewer", "backend", "REVIEWER BODY\n");
    write("test", "frontend", "FRONTEND BODY\n"); // different sender — must not be touched

    const stamped = writeStamp(projectDir, "backend", "run-1");
    expect(stamped.sort()).toEqual(
      [laneFor(projectDir, "backend", "test"), laneFor(projectDir, "backend", "reviewer")].sort()
    );

    expect(parseStampedContent(fs.readFileSync(laneFor(projectDir, "backend", "test"), "utf8")).runId).toBe("run-1");
    expect(parseStampedContent(fs.readFileSync(laneFor(projectDir, "backend", "reviewer"), "utf8")).runId).toBe(
      "run-1"
    );
    // A parallel subagent of a DIFFERENT type must never have its write touched.
    expect(parseStampedContent(fs.readFileSync(laneFor(projectDir, "frontend", "test"), "utf8")).runId).toBeNull();
  });

  it("never overwrites a file that already carries a stamp", () => {
    const p = write("test", "backend", "TEST BODY\n");
    writeStamp(projectDir, "backend", "run-1");
    expect(parseStampedContent(fs.readFileSync(p, "utf8")).runId).toBe("run-1");

    // A second, later SubagentStop for a same-named sender in a NEW run must not clobber it.
    const second = writeStamp(projectDir, "backend", "run-2");
    expect(second).toEqual([]);
    expect(parseStampedContent(fs.readFileSync(p, "utf8")).runId).toBe("run-1");
  });

  it("is a no-op against a project with no channels directory at all", () => {
    expect(writeStamp(projectDir, "backend", "run-1")).toEqual([]);
  });
});

describe("readLane", () => {
  it("reports sender, stamp, age and body for every file in the lane", () => {
    const p = write("test", "backend", "BODY\n");
    fs.writeFileSync(p, formatStampedContent("BODY\n", "run-1"));

    const now = Date.now() + 5000;
    const [entry] = readLane(projectDir, "test", now);
    expect(entry.sender).toBe("backend");
    expect(entry.fileName).toBe("backend.1.md");
    expect(entry.runId).toBe("run-1");
    expect(entry.body).toBe("BODY\n");
    expect(entry.ageMs).toBeGreaterThan(4900);
  });

  it("returns an unstamped entry with a null runId, not an error", () => {
    write("test", "backend", "BODY\n");
    const [entry] = readLane(projectDir, "test");
    expect(entry.runId).toBeNull();
  });

  it("is empty for a receiver with no lane directory", () => {
    expect(readLane(projectDir, "nobody")).toEqual([]);
  });
});

describe("retire", () => {
  it("moves the file to .consumed/<receiver>/, never deletes it", () => {
    write("test", "backend", "BODY\n");
    const [entry] = readLane(projectDir, "test");

    retire(projectDir, "test", entry);

    expect(fs.existsSync(entry.path)).toBe(false);
    const consumedPath = path.join(projectDir, ".claude", "channels", ".consumed", "test", "backend.1.md");
    expect(fs.readFileSync(consumedPath, "utf8")).toBe("BODY\n");
  });

  it("a second SubagentStart for the same receiver in the same run finds nothing left to deliver", () => {
    write("test", "backend", "BODY\n");
    const [entry] = readLane(projectDir, "test");
    retire(projectDir, "test", entry);

    expect(readLane(projectDir, "test")).toEqual([]);
  });
});

describe("sweep", () => {
  it("removes everything under .consumed/, regardless of age", () => {
    write("test", "backend", "BODY\n");
    const [entry] = readLane(projectDir, "test");
    retire(projectDir, "test", entry);

    const { removed } = sweep(projectDir);
    expect(removed).toHaveLength(1);
    expect(fs.existsSync(path.join(projectDir, ".claude", "channels", ".consumed", "test", "backend.1.md"))).toBe(
      false
    );
  });

  it("removes a live lane file only once it is past the age cap", () => {
    const p = write("scribe", "backend", "GAP\n");

    // Just inside the cap: untouched.
    let result = sweep(projectDir, { now: Date.now() + CHANNEL_AGE_CAP_MS - 1000 });
    expect(result.removed).toEqual([]);
    expect(fs.existsSync(p)).toBe(true);

    // Past the cap: removed.
    result = sweep(projectDir, { now: Date.now() + CHANNEL_AGE_CAP_MS + 1000 });
    expect(result.removed).toEqual([p]);
    expect(fs.existsSync(p)).toBe(false);
  });

  it("never removes an unconsumed, in-cap lane file — including a lane nothing has ever drained", () => {
    // The scribe's own lane, when no scribe ran this run (or any recent one).
    const p = write("scribe", "backend", "GAP\n");
    const { removed } = sweep(projectDir);
    expect(removed).toEqual([]);
    expect(fs.existsSync(p)).toBe(true);
  });

  it("is a no-op against a project with no channels directory at all", () => {
    expect(sweep(projectDir)).toEqual({ removed: [] });
  });
});
