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
  pendingLanes,
  formatStampedContent,
  parseStampedContent,
  CHANNEL_AGE_CAP_MS,
} from "../../src/core/handoff-channels.js";
// `112`'s additions are reached through the namespace so this file still loads (and every test
// above them still runs) against a module that does not export them yet.
import * as channels from "../../src/core/handoff-channels.js";
import { writeSession } from "../../src/core/session-runtime.js";
import { ensureSessionPaths } from "../../src/core/session-paths.js";
import { payloadWrittenSince, type PayloadRoute } from "../../src/core/handoff-payload.js";
import { scribeSeedShapes, noGapPayload, withGapPayload } from "../helpers/scribe-seed-payloads.js";

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

describe("pendingLanes (037)", () => {
  /**
   * `064`: a live `run_id` now lives in ONE SESSION'S `maestro_sessions/<id>/session.json`, and
   * `pendingLanes` unions every session directory's. Writing the pre-`064` flat file would leave
   * the live set empty and silently read every entry as stranded.
   */
  function setRunId(runId: string | null, sessionId = "sess-live"): void {
    const paths = ensureSessionPaths(path.join(projectDir, ".claude"), { session_id: sessionId });
    expect(paths, `invalid session id ${sessionId}`).not.toBeNull();
    writeSession(paths!.state, { workflow: null, generated_instances: [], run_id: runId });
  }

  it("is empty for a project with no channels directory at all", () => {
    expect(pendingLanes(projectDir)).toEqual([]);
  });

  it("is empty for a project whose channels directory has no files in it", () => {
    fs.mkdirSync(channelDir(projectDir, "test"), { recursive: true });
    expect(pendingLanes(projectDir)).toEqual([]);
  });

  it("splits a lane's entries into current vs stranded by the LIVE run_id, and reports the oldest age", () => {
    setRunId("run-1");
    write("test", "backend", formatStampedContent("CURRENT\n", "run-1"));
    write("test", "frontend", formatStampedContent("FOREIGN\n", "run-0"));
    const now = Date.now() + 5000;

    const [lane] = pendingLanes(projectDir, now);
    expect(lane.receiver).toBe("test");
    expect(lane.count).toBe(2);
    expect(lane.current).toBe(1);
    expect(lane.stranded).toBe(1);
    expect(lane.oldestAgeMs).toBeGreaterThan(4900);
  });

  it("with no live session (no session directory at all), every entry reads as stranded", () => {
    write("scribe", "backend", "GAP\n");
    const [lane] = pendingLanes(projectDir);
    expect(lane.current).toBe(0);
    expect(lane.stranded).toBe(1);
  });

  // `064`. Two sessions running against one project each hold their own `run_id`; a lane file is
  // "in flight" if it belongs to EITHER, and a file from neither is still stranded.
  it("counts an entry as current when it matches ANY live session's run_id", () => {
    setRunId("run-a", "sess-a");
    setRunId("run-b", "sess-b");
    write("test", "backend", formatStampedContent("FROM A\n", "run-a"));
    write("test", "frontend", formatStampedContent("FROM B\n", "run-b"));
    write("test", "scribe", formatStampedContent("FROM NEITHER\n", "run-dead"));

    const [lane] = pendingLanes(projectDir);
    expect(lane.count).toBe(3);
    expect(lane.current).toBe(2);
    expect(lane.stranded).toBe(1);
  });

  it("lists one entry per receiver with pending files, skipping .consumed/", () => {
    write("test", "backend", "A\n");
    write("scribe", "backend", "B\n");
    const [entry] = readLane(projectDir, "test");
    retire(projectDir, "test", entry); // fully drained — must not appear

    const receivers = pendingLanes(projectDir).map((l) => l.receiver);
    expect(receivers).toEqual(["scribe"]);
  });
});

// `112`: a scribe-lane skill-gap report survives delivery until a scribe acknowledges it with a
// `SKILL_GAPS_HANDLED:` line. The hook end lives in scribe-gap-retention.test.ts; this is the pure
// module underneath it.
describe("scribe gap reports (112)", () => {
  const fenced = (obj: unknown) => "Some prose first.\n\n```json\n" + JSON.stringify(obj, null, 2) + "\n```\n";
  const GAP = fenced({ skill_gaps: [{ skill: "agents-view", missing: "the tri-state chip logic" }] });
  const LEGACY_GAP = fenced({ concept_skill_gaps: [{ skill: "agents-view", missing: "x" }] });

  function put(receiver: string, fileName: string, body: string): string {
    const p = path.join(channelDir(projectDir, receiver), fileName);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    return p;
  }
  const entryOf = (receiver: string, fileName: string) => {
    const e = readLane(projectDir, receiver).find((x) => x.fileName === fileName);
    expect(e, `${receiver}/${fileName} not in lane`).toBeDefined();
    return e!;
  };
  const consumedPath = (receiver: string, fileName: string) =>
    path.join(projectDir, ".claude", "channels", ".consumed", receiver, fileName);

  describe("isGapReport", () => {
    it("is true for a scribe-lane entry whose fenced json block has a top-level skill_gaps array", () => {
      put("scribe", "backend.1.md", GAP);
      expect(channels.isGapReport(entryOf("scribe", "backend.1.md"))).toBe(true);
    });

    it("counts the legacy concept_skill_gaps key too", () => {
      put("scribe", "backend.1.md", LEGACY_GAP);
      expect(channels.isGapReport(entryOf("scribe", "backend.1.md"))).toBe(true);
    });

    it("is true for a STAMPED gap (the stamp line is not part of the body it inspects)", () => {
      put("scribe", "backend.1.md", formatStampedContent(GAP, "run-1"));
      expect(channels.isGapReport(entryOf("scribe", "backend.1.md"))).toBe(true);
    });

    it("is false for the same gap body in any lane other than scribe's", () => {
      put("test", "backend.1.md", GAP);
      expect(channels.isGapReport(entryOf("test", "backend.1.md"))).toBe(false);
    });

    it("is false for a scribe-lane payload whose fenced json has no gap array", () => {
      put("scribe", "test.1.md", fenced({ docs_to_update: ["README.md"] }));
      expect(channels.isGapReport(entryOf("scribe", "test.1.md"))).toBe(false);
    });

    it("is false when skill_gaps is not an array, or is nested rather than top-level", () => {
      put("scribe", "a.1.md", fenced({ skill_gaps: "agents-view is missing stuff" }));
      put("scribe", "b.1.md", fenced({ report: { skill_gaps: [{ skill: "s", missing: "m" }] } }));
      expect(channels.isGapReport(entryOf("scribe", "a.1.md"))).toBe(false);
      expect(channels.isGapReport(entryOf("scribe", "b.1.md"))).toBe(false);
    });

    it("is false (not a throw) for a fenced json block that does not parse, and for an empty body", () => {
      put("scribe", "a.1.md", '```json\n{ "skill_gaps": [ oops\n```\n');
      put("scribe", "b.1.md", "");
      expect(channels.isGapReport(entryOf("scribe", "a.1.md"))).toBe(false);
      expect(channels.isGapReport(entryOf("scribe", "b.1.md"))).toBe(false);
    });

    it("never reads the missing text — an enrich-only gap is a gap like any other", () => {
      put(
        "scribe",
        "backend.1.md",
        fenced({
          skill_gaps: [{ skill: "agents-view", missing: 'enrich only: Chip (src/chip.tsx) — found by search "chip"' }],
        })
      );
      expect(channels.isGapReport(entryOf("scribe", "backend.1.md"))).toBe(true);
    });
  });

  describe("parseGapsHandled", () => {
    it("parses the comma-separated file names from a SKILL_GAPS_HANDLED line", () => {
      const msg = "Updated agents-view.\n\nSKILL_GAPS_HANDLED: backend.2.md, test.3.md\nHANDOFF: success";
      expect(channels.parseGapsHandled(msg)).toEqual(["backend.2.md", "test.3.md"]);
    });

    it("trims whitespace around each name and around the line", () => {
      expect(channels.parseGapsHandled("SKILL_GAPS_HANDLED:   backend.2.md ,test.3.md   \n")).toEqual([
        "backend.2.md",
        "test.3.md",
      ]);
    });

    it("is empty when the message has no such line (the 111 scribe that never acted)", () => {
      expect(channels.parseGapsHandled("Wrote docs/foo.md.\nHANDOFF: success")).toEqual([]);
    });

    it("is empty for an empty message", () => {
      expect(channels.parseGapsHandled("")).toEqual([]);
    });
  });

  describe("acknowledgeGaps", () => {
    it("retires exactly the named gap reports into .consumed/scribe/ and returns them", () => {
      put("scribe", "backend.2.md", formatStampedContent(GAP, "run-1"));
      put("scribe", "test.2.md", formatStampedContent(LEGACY_GAP, "run-1"));

      const retired = channels.acknowledgeGaps(projectDir, ["backend.2.md"]);

      expect(retired.map((e) => e.fileName)).toEqual(["backend.2.md"]);
      expect(fs.existsSync(path.join(channelDir(projectDir, "scribe"), "backend.2.md"))).toBe(false);
      expect(fs.existsSync(consumedPath("scribe", "backend.2.md"))).toBe(true);
      // The one it was not told about stays in the live lane.
      expect(readLane(projectDir, "scribe").map((e) => e.fileName)).toEqual(["test.2.md"]);
    });

    it("skips a non-gap scribe-lane file, an unknown name, and an already-retired name — silently", () => {
      put("scribe", "backend.2.md", formatStampedContent(GAP, "run-1"));
      put("scribe", "frontend.1.md", formatStampedContent(fenced({ docs_to_update: ["x"] }), "run-1"));

      const first = channels.acknowledgeGaps(projectDir, ["backend.2.md", "frontend.1.md", "ghost.1.md"]);
      expect(first.map((e) => e.fileName)).toEqual(["backend.2.md"]);
      expect(fs.existsSync(path.join(channelDir(projectDir, "scribe"), "frontend.1.md"))).toBe(true);

      // Acknowledged twice (a resumed scribe repeating its line): the name is already gone.
      expect(() => channels.acknowledgeGaps(projectDir, ["backend.2.md"])).not.toThrow();
      expect(channels.acknowledgeGaps(projectDir, ["backend.2.md"])).toEqual([]);
      expect(fs.existsSync(consumedPath("scribe", "backend.2.md"))).toBe(true);
    });

    it("never reaches outside the scribe lane, even for a path-shaped name", () => {
      const other = put("test", "backend.1.md", GAP);
      expect(channels.acknowledgeGaps(projectDir, ["../test/backend.1.md", "test/backend.1.md"])).toEqual([]);
      expect(fs.existsSync(other)).toBe(true);
    });

    it("is a no-op against a project with no channels directory at all", () => {
      expect(channels.acknowledgeGaps(projectDir, ["backend.1.md"])).toEqual([]);
    });
  });

  describe("writeStamp on a scribe-lane gap report", () => {
    it("moves the stamped gap off <sender>.1.md, so the sender's next gap cannot clobber it", () => {
      put("scribe", "backend.1.md", GAP.replace("tri-state chip logic", "FIRST-GAP"));
      writeStamp(projectDir, "backend", "run-1");

      const afterFirst = readLane(projectDir, "scribe");
      expect(afterFirst).toHaveLength(1);
      expect(afterFirst[0].fileName).toMatch(/^backend\.\d+\.md$/);
      expect(afterFirst[0].fileName).not.toBe("backend.1.md");
      expect(afterFirst[0].runId).toBe("run-1");

      // The same sender reports a second gap, to the literal path its report tells it to use.
      put("scribe", "backend.1.md", GAP.replace("tri-state chip logic", "SECOND-GAP"));
      writeStamp(projectDir, "backend", "run-2");

      const lane = readLane(projectDir, "scribe");
      expect(lane).toHaveLength(2);
      expect(new Set(lane.map((e) => e.fileName)).size).toBe(2);
      for (const e of lane) {
        expect(e.fileName).toMatch(/^backend\.\d+\.md$/);
        expect(e.sender).toBe("backend");
      }
      const bodies = lane.map((e) => e.body).join("\n");
      expect(bodies).toContain("FIRST-GAP");
      expect(bodies).toContain("SECOND-GAP");
      expect(lane.find((e) => e.body.includes("FIRST-GAP"))!.runId).toBe("run-1");
      expect(lane.find((e) => e.body.includes("SECOND-GAP"))!.runId).toBe("run-2");
    });

    it("leaves a non-gap scribe-lane payload, and a gap-shaped payload in another lane, at <sender>.1.md", () => {
      put("scribe", "backend.1.md", fenced({ docs_to_update: ["x"] }));
      put("test", "backend.1.md", GAP);
      writeStamp(projectDir, "backend", "run-1");
      expect(readLane(projectDir, "scribe").map((e) => e.fileName)).toEqual(["backend.1.md"]);
      expect(readLane(projectDir, "test").map((e) => e.fileName)).toEqual(["backend.1.md"]);
    });
  });

  describe("sweep still bounds a never-acknowledged gap", () => {
    it("keeps a stamped gap inside CHANNEL_AGE_CAP_MS and removes it past the cap", () => {
      const p = put("scribe", "backend.2.md", formatStampedContent(GAP, "run-1"));
      expect(sweep(projectDir, { now: Date.now() + CHANNEL_AGE_CAP_MS - 60_000 }).removed).toEqual([]);
      expect(fs.existsSync(p)).toBe(true);
      expect(sweep(projectDir, { now: Date.now() + CHANNEL_AGE_CAP_MS + 60_000 }).removed).toEqual([p]);
      expect(fs.existsSync(p)).toBe(false);
    });

    it("honours an injected ageCapMs", () => {
      const p = put("scribe", "backend.2.md", formatStampedContent(GAP, "run-1"));
      expect(sweep(projectDir, { now: Date.now() + 10_000, ageCapMs: 60_000 }).removed).toEqual([]);
      expect(sweep(projectDir, { now: Date.now() + 120_000, ageCapMs: 60_000 }).removed).toEqual([p]);
    });
  });

  // Reviewer loop-back on 112: the seeded reviewer->scribe and refactor->scribe payloads always
  // carry a gap array, usually `[]`. Those are ordinary handoffs, not gap reports.
  describe("seeded scribe payloads with an EMPTY gap array (112 review)", () => {
    for (const sender of ["reviewer", "refactor"] as const) {
      it(`a ${sender}->scribe seed payload with no gaps is not a gap report (every seed generation)`, () => {
        for (const [i, shape] of scribeSeedShapes(sender).entries()) {
          const fileName = `${sender}.${i + 1}.md`;
          put("scribe", fileName, formatStampedContent(noGapPayload(shape, "NO-GAPS"), "run-1"));
          expect(channels.isGapReport(entryOf("scribe", fileName)), `seed #${i}`).toBe(false);
        }
      });

      it(`a ${sender}->scribe seed payload WITH a gap entry is a gap report`, () => {
        for (const [i, shape] of scribeSeedShapes(sender).entries()) {
          const fileName = `${sender}.${i + 1}.md`;
          put("scribe", fileName, withGapPayload(shape, "REAL-GAP"));
          expect(channels.isGapReport(entryOf("scribe", fileName)), `seed #${i}`).toBe(true);
        }
      });

      it(`writeStamp leaves a no-gap ${sender}->scribe payload at ${sender}.1.md`, () => {
        put("scribe", `${sender}.1.md`, noGapPayload(scribeSeedShapes(sender)[0], "NO-GAPS"));
        writeStamp(projectDir, sender, "run-1");
        const lane = readLane(projectDir, "scribe");
        expect(lane.map((e) => e.fileName)).toEqual([`${sender}.1.md`]);
        expect(lane[0].runId).toBe("run-1");
      });

      it(`acknowledgeGaps does not retire a no-gap ${sender}->scribe payload`, () => {
        put("scribe", `${sender}.1.md`, formatStampedContent(noGapPayload(scribeSeedShapes(sender)[0], "x"), "run-1"));
        expect(channels.acknowledgeGaps(projectDir, [`${sender}.1.md`])).toEqual([]);
        expect(readLane(projectDir, "scribe").map((e) => e.fileName)).toEqual([`${sender}.1.md`]);
      });
    }
  });

  // Reviewer loop-back on 112: `writeStamp` moves a gap payload off `<sender>.1.md`, and the
  // SubagentStop payload check must still see that the sender wrote it this run.
  describe("payloadWrittenSince after a gap payload was renamed by its stamp (112 review)", () => {
    const route: PayloadRoute = {
      label: "success",
      sender: "reviewer",
      receiver: "scribe",
      channelFile: ".claude/channels/scribe/reviewer.1.md",
      protocol: "",
    };

    it("counts a this-run gap payload that writeStamp renamed to reviewer.<n>.md", () => {
      const since = Date.now();
      put("scribe", "reviewer.1.md", withGapPayload(scribeSeedShapes("reviewer")[0], "RENAMED"));
      writeStamp(projectDir, "reviewer", "run-1");
      const lane = readLane(projectDir, "scribe");
      expect(lane).toHaveLength(1);
      expect(lane[0].fileName).not.toBe("reviewer.1.md"); // precondition: it really was renamed

      expect(payloadWrittenSince(projectDir, route, since)).toBe(true);
      expect(payloadWrittenSince(projectDir, route, null)).toBe(true);
    });

    it("still does not count a renamed gap payload written BEFORE this run started", () => {
      put("scribe", "reviewer.1.md", withGapPayload(scribeSeedShapes("reviewer")[0], "OLD"));
      writeStamp(projectDir, "reviewer", "run-0");
      const [old] = readLane(projectDir, "scribe");
      const past = new Date(Date.now() - 60 * 60 * 1000);
      fs.utimesSync(old.path, past, past);

      expect(payloadWrittenSince(projectDir, route, Date.now())).toBe(false);
    });

    it("does not count another sender's renamed gap payload", () => {
      const since = Date.now();
      put("scribe", "refactor.1.md", withGapPayload(scribeSeedShapes("refactor")[0], "OTHER"));
      writeStamp(projectDir, "refactor", "run-1");
      expect(payloadWrittenSince(projectDir, route, since)).toBe(false);
    });
  });
});
