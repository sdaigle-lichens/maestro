// 169: `settleInterimStops` returns every marker it settles, and `interimSettleEntry` builds the one
// durable `interim_settled` log line per settlement. Pure functions, no fs.
import { describe, it, expect } from "vitest";

import { settleInterimStops, interimSettleEntry, INTERIM_SETTLED_KIND } from "../../src/core/interim-stop.js";
import type { PendingInterimStop } from "../../src/core/types.js";

const NOW = "2099-01-01T00:00:10.000Z";
const stop = (id: string, extra: Partial<PendingInterimStop> = {}): PendingInterimStop => ({
  ts: "2099-01-01T00:00:00.000Z",
  agent: "backend",
  agent_id: id,
  ...extra,
});

describe("settleInterimStops settlements (169)", () => {
  it("a moved-on or seen marker settles as missing; a fresh one settles nothing", () => {
    const r = settleInterimStops({ a: stop("a", { moved_on: true }), b: stop("b", { seen: true }), c: stop("c") }, NOW);
    expect(r.settled.map((s) => [s.stop.agent_id, s.as])).toEqual([
      ["a", "missing"],
      ["b", "missing"],
    ]);
    expect(Object.keys(r.pending)).toEqual(["c"]);
  });

  it("a landed hand-back settles as late_handback with its label, valid or not", () => {
    const r = settleInterimStops({ a: stop("a"), b: stop("b") }, NOW, (p) =>
      p.agent_id === "a"
        ? { issue: null, message: "done\nHANDOFF: success" }
        : {
            issue: { kind: "unrouted", verdict: null, label: "nope", message: "no edge" },
            message: "HANDOFF: nope",
          }
    );
    expect(r.settled.map((s) => [s.stop.agent_id, s.as, s.label, s.issue?.kind ?? null])).toEqual([
      ["a", "late_handback", "success", null],
      ["b", "late_handback", "nope", "unrouted"],
    ]);
    expect(r.pending).toEqual({});
  });

  it("no pending markers: nothing settled", () => {
    expect(settleInterimStops(undefined, NOW).settled).toEqual([]);
  });
});

describe("interimSettleEntry (169)", () => {
  it("names the run, the stop time and the settle time", () => {
    const [s] = settleInterimStops({ a: stop("a", { moved_on: true }) }, NOW).settled;
    const e = interimSettleEntry(s, NOW);
    expect(e).toMatchObject({
      ts: NOW,
      origin: "main_session",
      kind: INTERIM_SETTLED_KIND,
      agent: "backend",
      agent_id: "a",
      stop_ts: "2099-01-01T00:00:00.000Z",
      settled_as: "missing",
      label: null,
    });
    expect((e.handoff_issue as { kind: string }).kind).toBe("missing");
    expect(e.log).toBe("interim stop settled: backend missing HANDOFF");
  });

  it("a valid late hand-back carries its label and no issue", () => {
    const [s] = settleInterimStops({ a: stop("a") }, NOW, () => ({ issue: null, message: "HANDOFF: success" })).settled;
    const e = interimSettleEntry(s, NOW);
    expect(e).toMatchObject({ settled_as: "late_handback", label: "success" });
    expect(e.handoff_issue).toBeUndefined();
    expect(e.log).toBe("interim stop settled: backend late hand-back HANDOFF: success");
  });
});
