// `037`: channel_delivery entries attach to the RECEIVING instance, matched on agent_id — same
// correlation `input` already uses, never on agent name (a re-invoked agent gets a fresh agent_id
// per run, so name-matching would misattribute the second run's deliveries to the first).

import { describe, it, expect } from "vitest";
import { buildInstances } from "../../src/renderer/src/utils/session-log.js";
import type { SessionLogEntry } from "../../src/renderer/src/utils/maestro-session-log.js";

const ts = "2026-01-01T00:00:00.000Z";

describe("buildInstances — channel_delivery correlation (037)", () => {
  it("attaches a delivery to the RECEIVING instance's Input, labelled with the sender", () => {
    const entries: SessionLogEntry[] = [
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "backend",
        agent_id: "a1",
        input: "do backend work",
        log: "→ backend",
      },
      { ts, origin: "backend", log: "Read(/x)" },
      {
        ts,
        origin: "backend",
        kind: "handoff",
        agent_id: "a1",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
      {
        ts,
        origin: "main_session",
        kind: "channel_delivery",
        sender: "backend",
        receiver: "test",
        agent_id: "a2",
        content: '{"behaviors_to_test":["x"]}',
        log: "channel: backend → test",
      },
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "test",
        agent_id: "a2",
        input: "run tests",
        log: "→ test",
      },
      { ts, origin: "test", log: "Bash(npm test)" },
      {
        ts,
        origin: "test",
        kind: "handoff",
        agent_id: "a2",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
    ];

    const instances = buildInstances(entries);
    const backendInst = instances.find((i) => i.origin === "backend")!;
    const testInst = instances.find((i) => i.origin === "test")!;

    // The sender's own instance carries no delivery — it wrote the payload, it didn't receive one.
    expect(backendInst.delivered).toEqual([]);

    expect(testInst.delivered).toHaveLength(1);
    expect(testInst.delivered[0]).toEqual({
      sender: "backend",
      receiver: "test",
      agent_id: "a2",
      content: '{"behaviors_to_test":["x"]}',
    });
  });

  it("keeps several deliveries to the same instance, in log order", () => {
    const entries: SessionLogEntry[] = [
      {
        ts,
        origin: "main_session",
        kind: "channel_delivery",
        sender: "backend",
        receiver: "reviewer",
        agent_id: "r1",
        content: "FIRST",
        log: "",
      },
      {
        ts,
        origin: "main_session",
        kind: "channel_delivery",
        sender: "test",
        receiver: "reviewer",
        agent_id: "r1",
        content: "SECOND",
        log: "",
      },
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "reviewer",
        agent_id: "r1",
        input: "review it",
        log: "→ reviewer",
      },
      {
        ts,
        origin: "reviewer",
        kind: "handoff",
        agent_id: "r1",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
    ];

    const instances = buildInstances(entries);
    const reviewerInst = instances.find((i) => i.origin === "reviewer")!;
    expect(reviewerInst.delivered.map((d) => d.content)).toEqual(["FIRST", "SECOND"]);
  });

  it("an instance with no deliveries carries an empty array, not undefined — no empty section to render", () => {
    const entries: SessionLogEntry[] = [
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "backend",
        agent_id: "a1",
        input: "do work",
        log: "→ backend",
      },
      {
        ts,
        origin: "backend",
        kind: "handoff",
        agent_id: "a1",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
    ];

    const instances = buildInstances(entries);
    const backendInst = instances.find((i) => i.origin === "backend")!;
    expect(backendInst.delivered).toEqual([]);
  });

  it("a channel_delivery whose agent_id matches no dispatch is dropped, not attached to an arbitrary instance", () => {
    const entries: SessionLogEntry[] = [
      {
        ts,
        origin: "main_session",
        kind: "channel_delivery",
        sender: "backend",
        receiver: "test",
        agent_id: "orphan",
        content: "ORPHAN",
        log: "",
      },
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "test",
        agent_id: "a2",
        input: "run tests",
        log: "→ test",
      },
      {
        ts,
        origin: "test",
        kind: "handoff",
        agent_id: "a2",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
    ];

    expect(() => buildInstances(entries)).not.toThrow();
    const instances = buildInstances(entries);
    for (const inst of instances) {
      expect(inst.delivered.some((d) => d.content === "ORPHAN")).toBe(false);
    }
  });
});

describe("buildInstances — resumed-agent correlation bounded by log position (042)", () => {
  it("gives each of a resumed agent's two cards its own run's input and offeredSkills", () => {
    // Two dispatch/handoff pairs sharing one agent_id — a condition-edge loop-back resume (`039`).
    const entries: SessionLogEntry[] = [
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "backend",
        agent_id: "a1",
        input: "FIRST RUN input",
        offered_skills: { loaded: ["first-skill"], referenced: [] },
        log: "→ backend",
      },
      { ts, origin: "backend", log: "Read(/x)" },
      {
        ts,
        origin: "backend",
        kind: "handoff",
        agent_id: "a1",
        status: "condition",
        label: "tests_failed",
        output: "HANDOFF: tests_failed",
        log: "HANDOFF: tests_failed",
      },
      { ts, origin: "main_session", log: "resuming backend" },
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "backend",
        agent_id: "a1",
        input: "SECOND RUN input",
        offered_skills: { loaded: ["second-skill"], referenced: [] },
        log: "→ backend",
      },
      { ts, origin: "backend", log: "Read(/y)" },
      {
        ts,
        origin: "backend",
        kind: "handoff",
        agent_id: "a1",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
    ];

    const instances = buildInstances(entries);
    const backendInstances = instances.filter((i) => i.origin === "backend");
    expect(backendInstances).toHaveLength(2);

    const [first, second] = backendInstances;
    expect(first.input).toBe("FIRST RUN input");
    expect(first.offeredSkills).toEqual({ loaded: ["first-skill"], referenced: [] });
    expect(second.input).toBe("SECOND RUN input");
    expect(second.offeredSkills).toEqual({ loaded: ["second-skill"], referenced: [] });
  });

  it("gives each of a resumed agent's two cards only the channel_delivery entries logged during its own run", () => {
    const entries: SessionLogEntry[] = [
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "backend",
        agent_id: "a1",
        input: "first run",
        log: "→ backend",
      },
      {
        ts,
        origin: "main_session",
        kind: "channel_delivery",
        sender: "scribe",
        receiver: "backend",
        agent_id: "a1",
        content: "DURING FIRST RUN",
        log: "",
      },
      {
        ts,
        origin: "backend",
        kind: "handoff",
        agent_id: "a1",
        status: "condition",
        label: "tests_failed",
        output: "HANDOFF: tests_failed",
        log: "HANDOFF: tests_failed",
      },
      {
        ts,
        origin: "main_session",
        kind: "channel_delivery",
        sender: "reviewer",
        receiver: "backend",
        agent_id: "a1",
        content: "BETWEEN RUNS",
        log: "",
      },
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "backend",
        agent_id: "a1",
        input: "second run",
        log: "→ backend",
      },
      {
        ts,
        origin: "backend",
        kind: "handoff",
        agent_id: "a1",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
    ];

    const instances = buildInstances(entries);
    const [first, second] = instances.filter((i) => i.origin === "backend");

    expect(first.delivered.map((d) => d.content)).toEqual(["DURING FIRST RUN"]);
    // A delivery logged between the two runs belongs to the run it precedes, not the one before it.
    expect(second.delivered.map((d) => d.content)).toEqual(["BETWEEN RUNS"]);
  });

  it("still correlates a twice-spawned agent (two distinct agent_ids) exactly as before", () => {
    const entries: SessionLogEntry[] = [
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "backend",
        agent_id: "a1",
        input: "first spawn",
        offered_skills: { loaded: ["s1"], referenced: [] },
        log: "→ backend",
      },
      {
        ts,
        origin: "backend",
        kind: "handoff",
        agent_id: "a1",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "backend",
        agent_id: "a2",
        input: "second spawn",
        offered_skills: { loaded: ["s2"], referenced: [] },
        log: "→ backend",
      },
      {
        ts,
        origin: "backend",
        kind: "handoff",
        agent_id: "a2",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
    ];

    const instances = buildInstances(entries);
    const [first, second] = instances.filter((i) => i.origin === "backend");

    expect(first.input).toBe("first spawn");
    expect(first.offeredSkills).toEqual({ loaded: ["s1"], referenced: [] });
    expect(second.input).toBe("second spawn");
    expect(second.offeredSkills).toEqual({ loaded: ["s2"], referenced: [] });
  });

  it("a segment with no handoff entry (in-flight or killed agent) still resolves its spawning input, bounded by the end of the log", () => {
    const entries: SessionLogEntry[] = [
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "backend",
        agent_id: "a1",
        input: "spawning message",
        offered_skills: { loaded: ["s1"], referenced: [] },
        log: "→ backend",
      },
      { ts, origin: "backend", log: "Read(/x)" },
      // No handoff entry — agent still running, or killed before SubagentStop.
    ];

    const instances = buildInstances(entries);
    const backendInst = instances.find((i) => i.origin === "backend")!;
    expect(backendInst.input).toBe("spawning message");
    expect(backendInst.offeredSkills).toEqual({ loaded: ["s1"], referenced: [] });
  });

  it("keeps a killed agent's card on its OWN dispatch when the same type is re-dispatched later", () => {
    // A segment with no handoff is bounded by the end of ITS SEGMENT, not the end of the log.
    // With an open-ended upper bound the first card reaches forward and shows "SECOND" — the same
    // class of misattribution this whole describe block exists to close, in the mirror direction.
    const entries: SessionLogEntry[] = [
      { ts, origin: "main_session", kind: "dispatch", agent: "backend", agent_id: "a1", input: "FIRST", log: "" },
      { ts, origin: "backend", log: "Read(/x)" },
      { ts, origin: "main_session", log: "agent died before SubagentStop" },
      { ts, origin: "main_session", kind: "dispatch", agent: "backend", agent_id: "a2", input: "SECOND", log: "" },
      { ts, origin: "backend", log: "Read(/y)" },
      {
        ts,
        origin: "backend",
        kind: "handoff",
        agent_id: "a2",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
    ];

    const [first, second] = buildInstances(entries).filter((i) => i.origin === "backend");
    expect(first.input).toBe("FIRST");
    expect(second.input).toBe("SECOND");
  });

  it("a handoff-less segment does not poison the name-fallback window of the next segment for that origin", () => {
    // Same shape as above, except the surviving run's handoff carries no agent_id, so BOTH segments
    // take the name-based fallback and both read `lastEndByOrigin`. If the killed segment recorded
    // the end of the LOG there rather than the end of itself, the second window would be empty and
    // the second card would render no input at all.
    const entries: SessionLogEntry[] = [
      { ts, origin: "main_session", kind: "dispatch", agent: "backend", agent_id: "a1", input: "FIRST", log: "" },
      { ts, origin: "backend", log: "Read(/x)" },
      { ts, origin: "main_session", log: "agent died before SubagentStop" },
      { ts, origin: "main_session", kind: "dispatch", agent: "backend", agent_id: "a2", input: "SECOND", log: "" },
      { ts, origin: "backend", log: "Read(/y)" },
      {
        ts,
        origin: "backend",
        kind: "handoff",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
    ];

    const [first, second] = buildInstances(entries).filter((i) => i.origin === "backend");
    expect(first.input).toBe("FIRST");
    expect(second.input).toBe("SECOND");
  });

  it("bounds the name-based fallback to the window between the previous and this run's handoff", () => {
    // Handoff entries here carry no agent_id, forcing the name-based fallback for both runs.
    const entries: SessionLogEntry[] = [
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "backend",
        agent_id: "a1",
        input: "FIRST RUN input",
        log: "→ backend",
      },
      {
        ts,
        origin: "backend",
        kind: "handoff",
        status: "condition",
        label: "tests_failed",
        output: "HANDOFF: tests_failed",
        log: "HANDOFF: tests_failed",
      },
      {
        ts,
        origin: "main_session",
        kind: "dispatch",
        agent: "backend",
        agent_id: "a2",
        input: "SECOND RUN input",
        log: "→ backend",
      },
      {
        ts,
        origin: "backend",
        kind: "handoff",
        status: "success",
        label: null,
        output: "HANDOFF: success",
        log: "HANDOFF: success",
      },
    ];

    const instances = buildInstances(entries);
    const [first, second] = instances.filter((i) => i.origin === "backend");

    expect(first.input).toBe("FIRST RUN input");
    expect(second.input).toBe("SECOND RUN input");
  });
});
