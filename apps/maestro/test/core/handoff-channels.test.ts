// Agent channels (`036`): lanes, stamps, retire, sweep. The hook end (SubagentStart inlining a
// delivery, SubagentStop stamping) is exercised against the COPIED scripts in install.test.ts;
// this file is the pure module underneath both.
//
// Since `144` every lane lives under one channel scope, `.claude/channels/<scope>/<receiver>/`.
// Most tests below run in one scope (`S`); the "scoped lanes (144)" block at the end pins the
// isolation between scopes and the treatment of the legacy unscoped layout.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  channelDir,
  consumedDir,
  laneFor,
  writeStamp,
  readLane,
  retire,
  sweep,
  pendingLanes,
  formatStampedContent,
  parseStampedContent,
  unstampedFilesOf,
  acknowledgeGaps,
  channelScopeOf,
  channelScopeFromState,
  channelRelPath,
  isChannelScope,
  NO_SESSION_SCOPE,
  CHANNEL_AGE_CAP_MS,
} from "../../src/core/handoff-channels.js";
// `112`'s additions are reached through the namespace so this file still loads (and every test
// above them still runs) against a module that does not export them yet.
import * as channels from "../../src/core/handoff-channels.js";
import { writeSession } from "../../src/core/session-runtime.js";
import { ensureSessionPaths } from "../../src/core/session-paths.js";
import { payloadWrittenSince, type PayloadRoute } from "../../src/core/handoff-payload.js";
import { scribeSeedShapes, noGapPayload, withGapPayload } from "../helpers/scribe-seed-payloads.js";

/** The scope every single-scope test runs in. */
const S = "task-001";

let projectDir: string;

beforeEach(() => {
  projectDir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-channels-"));
});

afterEach(() => {
  fs.rmSync(projectDir, { recursive: true, force: true });
});

function write(receiver: string, sender: string, body: string, scope: string = S): string {
  const p = laneFor(projectDir, scope, sender, receiver);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}

/** A file in the LEGACY (pre-`144`) unscoped layout, `.claude/channels/<receiver>/<file>`. */
function writeLegacy(receiver: string, fileName: string, body: string): string {
  const p = path.join(projectDir, ".claude", "channels", receiver, fileName);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
  return p;
}

function age(p: string, ms: number): void {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(p, t, t);
}

describe("laneFor / channelDir", () => {
  it("a sender always writes to <scope>/<receiver>/<sender>.1.md", () => {
    expect(laneFor(projectDir, S, "backend", "test")).toBe(
      path.join(projectDir, ".claude", "channels", S, "test", "backend.1.md")
    );
  });

  it("channelDir is the receiver's own lane directory inside the scope", () => {
    expect(channelDir(projectDir, S, "test")).toBe(path.join(projectDir, ".claude", "channels", S, "test"));
  });

  it("consumedDir is the scope's own .consumed/<receiver>/", () => {
    expect(consumedDir(projectDir, S, "test")).toBe(
      path.join(projectDir, ".claude", "channels", S, ".consumed", "test")
    );
  });

  it("channelRelPath is the project-relative scoped path agents are shown", () => {
    expect(channelRelPath(S, "test", "backend.1.md")).toBe(`.claude/channels/${S}/test/backend.1.md`);
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

    const stamped = writeStamp(projectDir, S, "backend", "run-1");
    expect(stamped.sort()).toEqual(
      [laneFor(projectDir, S, "backend", "test"), laneFor(projectDir, S, "backend", "reviewer")].sort()
    );

    expect(parseStampedContent(fs.readFileSync(laneFor(projectDir, S, "backend", "test"), "utf8")).runId).toBe("run-1");
    expect(parseStampedContent(fs.readFileSync(laneFor(projectDir, S, "backend", "reviewer"), "utf8")).runId).toBe(
      "run-1"
    );
    // A parallel subagent of a DIFFERENT type must never have its write touched.
    expect(parseStampedContent(fs.readFileSync(laneFor(projectDir, S, "frontend", "test"), "utf8")).runId).toBeNull();
  });

  it("never overwrites a file that already carries a stamp", () => {
    const p = write("test", "backend", "TEST BODY\n");
    writeStamp(projectDir, S, "backend", "run-1");
    expect(parseStampedContent(fs.readFileSync(p, "utf8")).runId).toBe("run-1");

    // A second, later SubagentStop for a same-named sender in a NEW run must not clobber it.
    const second = writeStamp(projectDir, S, "backend", "run-2");
    expect(second).toEqual([]);
    expect(parseStampedContent(fs.readFileSync(p, "utf8")).runId).toBe("run-1");
  });

  it("is a no-op against a project with no channels directory at all", () => {
    expect(writeStamp(projectDir, S, "backend", "run-1")).toEqual([]);
  });
});

describe("readLane", () => {
  it("reports sender, stamp, age and body for every file in the lane", () => {
    const p = write("test", "backend", "BODY\n");
    fs.writeFileSync(p, formatStampedContent("BODY\n", "run-1"));

    const now = Date.now() + 5000;
    const [entry] = readLane(projectDir, S, "test", now);
    expect(entry.sender).toBe("backend");
    expect(entry.fileName).toBe("backend.1.md");
    expect(entry.runId).toBe("run-1");
    expect(entry.body).toBe("BODY\n");
    expect(entry.ageMs).toBeGreaterThan(4900);
  });

  it("returns an unstamped entry with a null runId, not an error", () => {
    write("test", "backend", "BODY\n");
    const [entry] = readLane(projectDir, S, "test");
    expect(entry.runId).toBeNull();
  });

  it("is empty for a receiver with no lane directory", () => {
    expect(readLane(projectDir, S, "nobody")).toEqual([]);
  });
});

describe("retire", () => {
  it("moves the file to <scope>/.consumed/<receiver>/, never deletes it", () => {
    write("test", "backend", "BODY\n");
    const [entry] = readLane(projectDir, S, "test");

    retire(projectDir, S, "test", entry);

    expect(fs.existsSync(entry.path)).toBe(false);
    const consumedPath = path.join(projectDir, ".claude", "channels", S, ".consumed", "test", "backend.1.md");
    expect(fs.readFileSync(consumedPath, "utf8")).toBe("BODY\n");
  });

  it("a second SubagentStart for the same receiver in the same run finds nothing left to deliver", () => {
    write("test", "backend", "BODY\n");
    const [entry] = readLane(projectDir, S, "test");
    retire(projectDir, S, "test", entry);

    expect(readLane(projectDir, S, "test")).toEqual([]);
  });
});

describe("sweep", () => {
  it("with the ending session's scope, removes everything under that scope's .consumed/, regardless of age", () => {
    write("test", "backend", "BODY\n");
    const [entry] = readLane(projectDir, S, "test");
    retire(projectDir, S, "test", entry);

    const { removed } = sweep(projectDir, { scope: S });
    expect(removed).toHaveLength(1);
    expect(fs.existsSync(path.join(projectDir, ".claude", "channels", S, ".consumed", "test", "backend.1.md"))).toBe(
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
    const { removed } = sweep(projectDir, { scope: S });
    expect(removed).toEqual([]);
    expect(fs.existsSync(p)).toBe(true);
  });

  it("is a no-op against a project with no channels directory at all", () => {
    expect(sweep(projectDir)).toEqual({ removed: [] });
    expect(sweep(projectDir, { scope: S })).toEqual({ removed: [] });
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
    fs.mkdirSync(channelDir(projectDir, S, "test"), { recursive: true });
    expect(pendingLanes(projectDir)).toEqual([]);
  });

  it("splits a lane's entries into current vs stranded by the LIVE run_id, and reports the oldest age", () => {
    setRunId("run-1");
    write("test", "backend", formatStampedContent("CURRENT\n", "run-1"));
    write("test", "frontend", formatStampedContent("FOREIGN\n", "run-0"));
    const now = Date.now() + 5000;

    const [lane] = pendingLanes(projectDir, now);
    expect(lane.scope).toBe(S);
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
    const [entry] = readLane(projectDir, S, "test");
    retire(projectDir, S, "test", entry); // fully drained — must not appear

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

  function put(receiver: string, fileName: string, body: string, scope: string = S): string {
    const p = path.join(channelDir(projectDir, scope, receiver), fileName);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, body);
    return p;
  }
  const entryOf = (receiver: string, fileName: string) => {
    const e = readLane(projectDir, S, receiver).find((x) => x.fileName === fileName);
    expect(e, `${receiver}/${fileName} not in lane`).toBeDefined();
    return e!;
  };
  const consumedPath = (receiver: string, fileName: string, scope: string = S) =>
    path.join(projectDir, ".claude", "channels", scope, ".consumed", receiver, fileName);

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
    it("retires exactly the named gap reports into <scope>/.consumed/scribe/ and returns them", () => {
      put("scribe", "backend.2.md", formatStampedContent(GAP, "run-1"));
      put("scribe", "test.2.md", formatStampedContent(LEGACY_GAP, "run-1"));

      const retired = channels.acknowledgeGaps(projectDir, S, ["backend.2.md"]);

      expect(retired.map((e) => e.fileName)).toEqual(["backend.2.md"]);
      expect(fs.existsSync(path.join(channelDir(projectDir, S, "scribe"), "backend.2.md"))).toBe(false);
      expect(fs.existsSync(consumedPath("scribe", "backend.2.md"))).toBe(true);
      // The one it was not told about stays in the live lane.
      expect(readLane(projectDir, S, "scribe").map((e) => e.fileName)).toEqual(["test.2.md"]);
    });

    it("skips a non-gap scribe-lane file, an unknown name, and an already-retired name — silently", () => {
      put("scribe", "backend.2.md", formatStampedContent(GAP, "run-1"));
      put("scribe", "frontend.1.md", formatStampedContent(fenced({ docs_to_update: ["x"] }), "run-1"));

      const first = channels.acknowledgeGaps(projectDir, S, ["backend.2.md", "frontend.1.md", "ghost.1.md"]);
      expect(first.map((e) => e.fileName)).toEqual(["backend.2.md"]);
      expect(fs.existsSync(path.join(channelDir(projectDir, S, "scribe"), "frontend.1.md"))).toBe(true);

      // Acknowledged twice (a resumed scribe repeating its line): the name is already gone.
      expect(() => channels.acknowledgeGaps(projectDir, S, ["backend.2.md"])).not.toThrow();
      expect(channels.acknowledgeGaps(projectDir, S, ["backend.2.md"])).toEqual([]);
      expect(fs.existsSync(consumedPath("scribe", "backend.2.md"))).toBe(true);
    });

    it("never reaches outside the scribe lane, even for a path-shaped name", () => {
      const other = put("test", "backend.1.md", GAP);
      expect(channels.acknowledgeGaps(projectDir, S, ["../test/backend.1.md", "test/backend.1.md"])).toEqual([]);
      expect(fs.existsSync(other)).toBe(true);
    });

    it("is a no-op against a project with no channels directory at all", () => {
      expect(channels.acknowledgeGaps(projectDir, S, ["backend.1.md"])).toEqual([]);
    });
  });

  describe("writeStamp on a scribe-lane gap report", () => {
    it("moves the stamped gap off <sender>.1.md, so the sender's next gap cannot clobber it", () => {
      put("scribe", "backend.1.md", GAP.replace("tri-state chip logic", "FIRST-GAP"));
      writeStamp(projectDir, S, "backend", "run-1");

      const afterFirst = readLane(projectDir, S, "scribe");
      expect(afterFirst).toHaveLength(1);
      expect(afterFirst[0].fileName).toMatch(/^backend\.\d+\.md$/);
      expect(afterFirst[0].fileName).not.toBe("backend.1.md");
      expect(afterFirst[0].runId).toBe("run-1");

      // The same sender reports a second gap, to the literal path its report tells it to use.
      put("scribe", "backend.1.md", GAP.replace("tri-state chip logic", "SECOND-GAP"));
      writeStamp(projectDir, S, "backend", "run-2");

      const lane = readLane(projectDir, S, "scribe");
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
      writeStamp(projectDir, S, "backend", "run-1");
      expect(readLane(projectDir, S, "scribe").map((e) => e.fileName)).toEqual(["backend.1.md"]);
      expect(readLane(projectDir, S, "test").map((e) => e.fileName)).toEqual(["backend.1.md"]);
    });
  });

  describe("sweep still bounds a never-acknowledged gap", () => {
    it("keeps a stamped gap inside CHANNEL_AGE_CAP_MS and removes it past the cap", () => {
      const p = put("scribe", "backend.2.md", formatStampedContent(GAP, "run-1"));
      expect(sweep(projectDir, { scope: S, now: Date.now() + CHANNEL_AGE_CAP_MS - 60_000 }).removed).toEqual([]);
      expect(fs.existsSync(p)).toBe(true);
      expect(sweep(projectDir, { scope: S, now: Date.now() + CHANNEL_AGE_CAP_MS + 60_000 }).removed).toEqual([p]);
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
        writeStamp(projectDir, S, sender, "run-1");
        const lane = readLane(projectDir, S, "scribe");
        expect(lane.map((e) => e.fileName)).toEqual([`${sender}.1.md`]);
        expect(lane[0].runId).toBe("run-1");
      });

      it(`acknowledgeGaps does not retire a no-gap ${sender}->scribe payload`, () => {
        put("scribe", `${sender}.1.md`, formatStampedContent(noGapPayload(scribeSeedShapes(sender)[0], "x"), "run-1"));
        expect(channels.acknowledgeGaps(projectDir, S, [`${sender}.1.md`])).toEqual([]);
        expect(readLane(projectDir, S, "scribe").map((e) => e.fileName)).toEqual([`${sender}.1.md`]);
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
      scope: S,
      channelFile: `.claude/channels/${S}/scribe/reviewer.1.md`,
      protocol: "",
    };

    it("counts a this-run gap payload that writeStamp renamed to reviewer.<n>.md", () => {
      const since = Date.now();
      put("scribe", "reviewer.1.md", withGapPayload(scribeSeedShapes("reviewer")[0], "RENAMED"));
      writeStamp(projectDir, S, "reviewer", "run-1");
      const lane = readLane(projectDir, S, "scribe");
      expect(lane).toHaveLength(1);
      expect(lane[0].fileName).not.toBe("reviewer.1.md"); // precondition: it really was renamed

      expect(payloadWrittenSince(projectDir, route, since)).toBe(true);
      expect(payloadWrittenSince(projectDir, route, null)).toBe(true);
    });

    it("still does not count a renamed gap payload written BEFORE this run started", () => {
      put("scribe", "reviewer.1.md", withGapPayload(scribeSeedShapes("reviewer")[0], "OLD"));
      writeStamp(projectDir, S, "reviewer", "run-0");
      const [old] = readLane(projectDir, S, "scribe");
      const past = new Date(Date.now() - 60 * 60 * 1000);
      fs.utimesSync(old.path, past, past);

      expect(payloadWrittenSince(projectDir, route, Date.now())).toBe(false);
    });

    it("does not count another sender's renamed gap payload", () => {
      const since = Date.now();
      put("scribe", "refactor.1.md", withGapPayload(scribeSeedShapes("refactor")[0], "OTHER"));
      writeStamp(projectDir, S, "refactor", "run-1");
      expect(payloadWrittenSince(projectDir, route, since)).toBe(false);
    });

    it("does not count the same pair's payload written this run in ANOTHER scope (144)", () => {
      const since = Date.now();
      put("scribe", "reviewer.1.md", withGapPayload(scribeSeedShapes("reviewer")[0], "FOREIGN"), "task-002");
      put("scribe", "reviewer.1.md", fenced({ docs_to_update: ["x"] }), "task-002");
      expect(payloadWrittenSince(projectDir, route, since)).toBe(false);
      expect(payloadWrittenSince(projectDir, route, null)).toBe(false);
    });
  });
});

// `144`: every channel file belongs to exactly one scope. Two scopes holding the SAME
// sender/receiver pair (the 045/048 collision) never see each other's file; the legacy unscoped
// layout is never delivered, only reported stranded and aged out.
describe("scoped lanes (144)", () => {
  const A = "task-045";
  const B = "task-048";

  describe("isChannelScope", () => {
    it("accepts task-<digits> and session-<1..8 safe chars>", () => {
      for (const ok of [
        "task-0",
        "task-045",
        "task-12345",
        "session-a",
        "session-abcdef12",
        "session-a_b-C",
        NO_SESSION_SCOPE,
      ]) {
        expect(isChannelScope(ok), ok).toBe(true);
      }
    });

    it("rejects .consumed, a bare receiver, traversal, an over-long session prefix and non-strings", () => {
      for (const bad of [
        ".consumed",
        "test",
        "scribe",
        "../x",
        "task-",
        "task-04a",
        "task-045/..",
        "session-",
        "session-123456789",
        "session-a.b",
        "session-a/b",
        "",
        null,
        undefined,
        45,
      ]) {
        expect(isChannelScope(bad), String(bad)).toBe(false);
      }
    });
  });

  describe("channelScopeFromState", () => {
    it("is task-<NNN> for an active_task with a numeric prefix", () => {
      expect(channelScopeFromState({ active_task: "045-x.md" }, "abcdef1234")).toBe("task-045");
      // A path-shaped active_task is reduced to its basename.
      expect(channelScopeFromState({ active_task: ".claude/maestro-tasks/048-y.md" }, "abcdef1234")).toBe("task-048");
    });

    it("falls back to session-<first 8 chars> with no active_task, or one without a numeric prefix", () => {
      expect(channelScopeFromState({}, "abcdef1234")).toBe("session-abcdef12");
      expect(channelScopeFromState({ active_task: null }, "abcdef1234")).toBe("session-abcdef12");
      expect(channelScopeFromState({ active_task: "fix-it.md" }, "abcdef1234")).toBe("session-abcdef12");
      expect(channelScopeFromState(null, "abcdef1234")).toBe("session-abcdef12");
    });

    it("uses the whole id when it is shorter than 8 chars", () => {
      expect(channelScopeFromState({}, "abc")).toBe("session-abc");
    });

    it("is session-none for a null or invalid id (and never task-less garbage)", () => {
      expect(channelScopeFromState({}, null)).toBe(NO_SESSION_SCOPE);
      expect(channelScopeFromState({}, undefined)).toBe(NO_SESSION_SCOPE);
      expect(channelScopeFromState({}, "../../etc")).toBe(NO_SESSION_SCOPE);
      expect(channelScopeFromState({}, "")).toBe(NO_SESSION_SCOPE);
    });

    it("every value it returns is itself a valid scope", () => {
      for (const [state, id] of [
        [{ active_task: "045-x.md" }, "id"],
        [{}, "abcdef1234"],
        [{}, "a"],
        [{}, null],
      ] as const) {
        expect(isChannelScope(channelScopeFromState(state, id))).toBe(true);
      }
    });
  });

  describe("channelScopeOf", () => {
    function setState(sessionId: string, state: Record<string, unknown>, claudeDir = path.join(projectDir, ".claude")) {
      const paths = ensureSessionPaths(claudeDir, { session_id: sessionId });
      writeSession(paths!.state, { workflow: null, generated_instances: [], run_id: "r", ...state });
    }

    it("reads the session's own active_task", () => {
      setState("sess-aaaa1111", { active_task: "045-x.md" });
      setState("sess-bbbb2222", { active_task: "048-y.md" });
      expect(channelScopeOf(projectDir, "sess-aaaa1111")).toBe("task-045");
      expect(channelScopeOf(projectDir, "sess-bbbb2222")).toBe("task-048");
    });

    it("is session-<id8> for a session with no session.json or no claimed task", () => {
      expect(channelScopeOf(projectDir, "sess-cccc3333")).toBe("session-sess-ccc");
      setState("sess-dddd4444", {});
      expect(channelScopeOf(projectDir, "sess-dddd4444")).toBe("session-sess-ddd");
    });

    it("is session-none for a null or invalid session id", () => {
      expect(channelScopeOf(projectDir, null)).toBe(NO_SESSION_SCOPE);
      expect(channelScopeOf(projectDir, "../x")).toBe(NO_SESSION_SCOPE);
    });

    it("follows a worktree session pointer (074) to the worktree's session.json", () => {
      const wt = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-channels-wt-"));
      try {
        // The main checkout holds only the pointer; the state lives in the worktree.
        const mainPaths = ensureSessionPaths(path.join(projectDir, ".claude"), { session_id: "sess-wt" });
        fs.writeFileSync(path.join(mainPaths!.dir, "worktree.json"), JSON.stringify({ path: wt }));
        setState("sess-wt", { active_task: "049-z.md" }, path.join(wt, ".claude"));
        expect(channelScopeOf(projectDir, "sess-wt")).toBe("task-049");
      } finally {
        fs.rmSync(wt, { recursive: true, force: true });
      }
    });
  });

  describe("an invalid scope", () => {
    it("path builders throw rather than resolve outside a scope", () => {
      for (const bad of ["test", ".consumed", "../x", ""]) {
        expect(() => channelDir(projectDir, bad, "test"), bad).toThrow(/not a channel scope/);
        expect(() => consumedDir(projectDir, bad, "test"), bad).toThrow(/not a channel scope/);
        expect(() => laneFor(projectDir, bad, "backend", "test"), bad).toThrow(/not a channel scope/);
      }
    });

    it("readers and writers return [] rather than touching the legacy layout", () => {
      const legacy = writeLegacy("test", "backend.1.md", "LEGACY\n");
      expect(readLane(projectDir, "test", "backend")).toEqual([]);
      expect(unstampedFilesOf(projectDir, "test", "backend")).toEqual([]);
      expect(writeStamp(projectDir, "test", "backend", "run-1")).toEqual([]);
      expect(acknowledgeGaps(projectDir, ".consumed", ["backend.1.md"])).toEqual([]);
      expect(fs.readFileSync(legacy, "utf8")).toBe("LEGACY\n");
    });
  });

  describe("the 045/048 collision: two scopes, the same sender/receiver pair", () => {
    it("writeStamp stamps only the stopping session's own scope", () => {
      const a = write("test", "backend", "FROM 045\n", A);
      const b = write("test", "backend", "FROM 048\n", B);
      expect(writeStamp(projectDir, A, "backend", "run-045")).toEqual([a]);
      expect(parseStampedContent(fs.readFileSync(a, "utf8")).runId).toBe("run-045");
      expect(parseStampedContent(fs.readFileSync(b, "utf8")).runId).toBeNull();
    });

    it("readLane, retire and unstampedFilesOf see only their own scope", () => {
      write("test", "backend", formatStampedContent("FROM 045\n", "run-045"), A);
      const b = write("test", "backend", "FROM 048\n", B);

      const laneA = readLane(projectDir, A, "test");
      expect(laneA.map((e) => e.body)).toEqual(["FROM 045\n"]);
      expect(unstampedFilesOf(projectDir, A, "backend")).toEqual([]);
      expect(unstampedFilesOf(projectDir, B, "backend").map((m) => m.path)).toEqual([b]);

      retire(projectDir, A, "test", laneA[0]);
      expect(fs.existsSync(path.join(consumedDir(projectDir, A, "test"), "backend.1.md"))).toBe(true);
      expect(readLane(projectDir, B, "test").map((e) => e.body)).toEqual(["FROM 048\n"]);
      expect(fs.existsSync(consumedDir(projectDir, B, "test"))).toBe(false);
    });

    it("acknowledgeGaps in one scope never retires the other scope's gap of the same name", () => {
      const gap = "```json\n" + JSON.stringify({ skill_gaps: [{ skill: "s", missing: "m" }] }) + "\n```\n";
      const pa = path.join(channelDir(projectDir, A, "scribe"), "backend.2.md");
      const pb = path.join(channelDir(projectDir, B, "scribe"), "backend.2.md");
      for (const p of [pa, pb]) {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, formatStampedContent(gap, "run-x"));
      }
      expect(acknowledgeGaps(projectDir, B, ["backend.2.md"]).map((e) => e.path)).toEqual([pb]);
      expect(fs.existsSync(pa)).toBe(true);
      expect(fs.existsSync(pb)).toBe(false);
    });

    it("pendingLanes({scope}) lists only that scope; unfiltered lists both, each carrying its scope", () => {
      write("test", "backend", "A\n", A);
      write("test", "backend", "B\n", B);
      expect(pendingLanes(projectDir, Date.now(), { scope: A }).map((l) => [l.scope, l.receiver])).toEqual([
        [A, "test"],
      ]);
      expect(
        pendingLanes(projectDir)
          .map((l) => `${l.scope}/${l.receiver}`)
          .sort()
      ).toEqual([`${A}/test`, `${B}/test`]);
    });

    it("sweep({scope}) retires only that scope's .consumed outright; another scope's survives in-cap", () => {
      write("test", "backend", "A\n", A);
      write("test", "backend", "B\n", B);
      retire(projectDir, A, "test", readLane(projectDir, A, "test")[0]);
      retire(projectDir, B, "test", readLane(projectDir, B, "test")[0]);
      const consumedA = path.join(consumedDir(projectDir, A, "test"), "backend.1.md");
      const consumedB = path.join(consumedDir(projectDir, B, "test"), "backend.1.md");

      expect(sweep(projectDir, { scope: A }).removed).toEqual([consumedA]);
      expect(fs.existsSync(consumedB)).toBe(true);

      // Past the cap, B's .consumed ages out regardless of who sweeps.
      expect(sweep(projectDir, { scope: A, now: Date.now() + CHANNEL_AGE_CAP_MS + 1000 }).removed).toEqual([consumedB]);
    });

    it("sweep never removes another scope's in-cap live lane file", () => {
      const b = write("test", "backend", "B\n", B);
      expect(sweep(projectDir, { scope: A }).removed).toEqual([]);
      expect(fs.existsSync(b)).toBe(true);
    });

    it("a sweep with an invalid scope retires no .consumed outright", () => {
      write("test", "backend", "A\n", A);
      retire(projectDir, A, "test", readLane(projectDir, A, "test")[0]);
      expect(sweep(projectDir, { scope: "../task-045" }).removed).toEqual([]);
      expect(sweep(projectDir, { scope: null }).removed).toEqual([]);
    });
  });

  describe("the legacy unscoped layout", () => {
    function setRunId(runId: string, sessionId: string): void {
      const paths = ensureSessionPaths(path.join(projectDir, ".claude"), { session_id: sessionId });
      writeSession(paths!.state, { workflow: null, generated_instances: [], run_id: runId });
    }

    it("pendingLanes reports a legacy lane with scope null and ALL entries stranded, even stamped with a live run_id", () => {
      setRunId("run-live", "sess-live");
      writeLegacy("test", "backend.1.md", formatStampedContent("OLD\n", "run-live"));
      const lanes = pendingLanes(projectDir);
      expect(lanes).toEqual([
        expect.objectContaining({ scope: null, receiver: "test", count: 1, current: 0, stranded: 1 }),
      ]);
    });

    it("a scope filter hides legacy lanes", () => {
      writeLegacy("test", "backend.1.md", "OLD\n");
      expect(pendingLanes(projectDir, Date.now(), { scope: S })).toEqual([]);
    });

    it("a legacy root .consumed/ is not a lane", () => {
      writeLegacy(".consumed/test", "backend.1.md", "OLD\n");
      expect(pendingLanes(projectDir)).toEqual([]);
    });

    it("no scope's reader ever returns a legacy file", () => {
      writeLegacy("test", "backend.1.md", formatStampedContent("OLD\n", "run-1"));
      expect(readLane(projectDir, S, "test")).toEqual([]);
      expect(readLane(projectDir, NO_SESSION_SCOPE, "test")).toEqual([]);
    });

    it("sweep keeps a younger legacy lane file and legacy .consumed file, and ages both out past 14 days", () => {
      const lane = writeLegacy("test", "backend.1.md", "OLD\n");
      const consumed = writeLegacy(path.join(".consumed", "test"), "backend.1.md", "OLD\n");

      // Even the sweeping session's own scope never retires the legacy .consumed outright.
      expect(sweep(projectDir, { scope: S }).removed).toEqual([]);
      expect(fs.existsSync(lane)).toBe(true);
      expect(fs.existsSync(consumed)).toBe(true);

      age(lane, CHANNEL_AGE_CAP_MS + 60_000);
      age(consumed, CHANNEL_AGE_CAP_MS + 60_000);
      expect(sweep(projectDir, { scope: S }).removed.sort()).toEqual([consumed, lane].sort());
      expect(fs.existsSync(lane)).toBe(false);
      expect(fs.existsSync(consumed)).toBe(false);
    });
  });

  describe("empty directory pruning", () => {
    it("an emptied lane dir is kept within the 1h grace and pruned after it", () => {
      write("test", "backend", "A\n", A);
      retire(projectDir, A, "test", readLane(projectDir, A, "test")[0]);
      const laneDir = channelDir(projectDir, A, "test");

      sweep(projectDir, { scope: A });
      expect(fs.existsSync(laneDir)).toBe(true); // just emptied: inside the grace

      const later = Date.now() + 2 * 60 * 60 * 1000;
      sweep(projectDir, { scope: A, now: later });
      expect(fs.existsSync(laneDir)).toBe(false);
    });
  });
});
