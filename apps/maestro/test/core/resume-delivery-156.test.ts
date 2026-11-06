// `156` unit cases for `dropResolvedMissingPayloads` with its `writtenAt` argument: a file resolves a
// recorded `missing_payload` only when it was written at or after the issue's timestamp (less the
// hook's 1 s slack). Pure function, no filesystem; the end-to-end case lives in
// runtime-version-and-payload.test.ts (describe "156").

import { describe, it, expect } from "vitest";
import { dropResolvedMissingPayloads } from "../../src/core/resume-delivery.js";
import type { HandoffIssueRecord, ResumeDelivery } from "../../src/core/resume-delivery.js";

const FILE = ".claude/channels/task-156/backend/test.1.md";
const TS = "2026-11-06T12:00:00.000Z";
const T = Date.parse(TS);

const issue = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    kind: "missing_payload",
    ts: TS,
    agent: "test",
    agent_id: "t1",
    label: "tests failed",
    files: [FILE],
    ...over,
  }) as unknown as HandoffIssueRecord;

const present = [{ file: FILE, sender: "test", run_id: "r1" }] as unknown as ResumeDelivery[];

describe("156: dropResolvedMissingPayloads with writtenAt", () => {
  it("a file written after the issue resolves it", () => {
    expect(dropResolvedMissingPayloads([issue()], present, () => T + 5_000)).toEqual([]);
  });

  it("a file written before the issue (an earlier run's) does not resolve it", () => {
    const kept = dropResolvedMissingPayloads([issue()], present, () => T - 60_000);
    expect(kept).toHaveLength(1);
  });

  it("the 1 s slack: exactly ts - 1000 resolves, ts - 1001 does not", () => {
    expect(dropResolvedMissingPayloads([issue()], present, () => T - 1_000)).toEqual([]);
    expect(dropResolvedMissingPayloads([issue()], present, () => T - 1_001)).toHaveLength(1);
  });

  it("an unreadable file mtime (null) never resolves the issue", () => {
    expect(dropResolvedMissingPayloads([issue()], present, () => null)).toHaveLength(1);
  });

  it("an unparseable issue timestamp never resolves the issue, even with a fresh file", () => {
    const bad = issue({ ts: "not-a-date" });
    expect(dropResolvedMissingPayloads([bad], present, () => Date.now())).toHaveLength(1);
  });

  it("an issue whose file is not in the lane as a current-run file is kept regardless of mtime", () => {
    expect(dropResolvedMissingPayloads([issue()], [], () => T + 5_000)).toHaveLength(1);
  });

  it("a multi-file issue resolves only when every file is present and fresh", () => {
    const FILE2 = ".claude/channels/task-156/backend/test.2.md";
    const two = issue({ files: [FILE, FILE2] });
    const both = [
      { file: FILE, sender: "test", run_id: "r1" },
      { file: FILE2, sender: "test", run_id: "r1" },
    ] as unknown as ResumeDelivery[];
    expect(dropResolvedMissingPayloads([two], both, () => T + 5_000)).toEqual([]);
    expect(dropResolvedMissingPayloads([two], both, (f) => (f === FILE ? T + 5_000 : T - 60_000))).toHaveLength(1);
  });

  it("without writtenAt the old behaviour holds: present alone resolves the issue", () => {
    expect(dropResolvedMissingPayloads([issue()], present)).toEqual([]);
  });

  it("issues of other kinds are always kept", () => {
    const other = issue({ kind: "handoff_failed" });
    expect(dropResolvedMissingPayloads([other], present, () => T + 5_000)).toHaveLength(1);
  });

  it("negative control: the same fresh file resolves when writtenAt is absent, but not when its mtime is old", () => {
    expect(dropResolvedMissingPayloads([issue()], present)).toEqual([]);
    expect(dropResolvedMissingPayloads([issue()], present, () => T - 3_600_000)).toHaveLength(1);
  });
});
