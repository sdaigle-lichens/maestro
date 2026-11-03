// `037`: channel_delivery entries attach to the RECEIVING instance, matched on agent_id — same
// correlation `input` already uses, never on agent name (a re-invoked agent gets a fresh agent_id
// per run, so name-matching would misattribute the second run's deliveries to the first).

import { describe, it, expect } from "vitest";
import { buildInstances, receivedCount } from "../../src/renderer/src/utils/session-log.js";
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

describe("buildInstances — a resumed run's delivery logged at its SubagentStop (088)", () => {
  const dispatch = (agent: string, id: string, input: string): SessionLogEntry => ({
    ts,
    origin: "main_session",
    kind: "dispatch",
    agent,
    agent_id: id,
    input,
    log: `→ ${agent}`,
  });
  const handoff = (
    origin: string,
    id: string,
    status: "success" | "condition",
    label: string | null
  ): SessionLogEntry => ({
    ts,
    origin,
    kind: "handoff",
    agent_id: id,
    status,
    label,
    output: `HANDOFF: ${label ?? "success"}`,
    log: `HANDOFF: ${label ?? "success"}`,
  });
  const delivery = (
    sender: string,
    receiver: string,
    id: string,
    content: string,
    via?: "resume" | "ack"
  ): SessionLogEntry => ({
    ts,
    origin: "main_session",
    kind: "channel_delivery",
    sender,
    receiver,
    agent_id: id,
    content,
    ...(via ? { via } : {}),
    log: `channel: ${sender} → ${receiver}`,
  });

  it("keeps the resumed run ONE card with its status, and carries via:'resume' onto delivered", () => {
    const entries: SessionLogEntry[] = [
      dispatch("backend", "A", "first run"),
      { ts, origin: "backend", log: "Edit(/a)" },
      handoff("backend", "A", "success", null),
      { ts, origin: "main_session", log: "Bash(resume-target)" },
      dispatch("backend", "A", "resumed run"),
      { ts, origin: "backend", log: "Read(.claude/channels/backend/reviewer.1.md)" },
      { ts, origin: "backend", log: "Edit(/b)" },
      delivery("reviewer", "backend", "A", "RESUME PAYLOAD", "resume"),
      handoff("backend", "A", "condition", "needs review"),
    ];

    const backend = buildInstances(entries).filter((i) => i.origin === "backend");
    expect(backend).toHaveLength(2);
    const [first, resumed] = backend;

    expect(first.delivered).toEqual([]);
    expect(resumed.status).toBe("condition");
    expect(resumed.label).toBe("needs review");
    expect(resumed.input).toBe("resumed run");
    expect(resumed.entries.map((e) => e.log)).toContain("Edit(/b)");
    expect(resumed.entries.some((e) => e.kind === "handoff")).toBe(true);
    expect(resumed.delivered).toEqual([
      { sender: "reviewer", receiver: "backend", agent_id: "A", content: "RESUME PAYLOAD", via: "resume" },
    ]);
    // No status-less backend card split off by the delivery.
    expect(buildInstances(entries).filter((i) => i.origin === "backend" && i.status === null)).toEqual([]);
  });

  it("an ordinary cold-start delivery still lands on the receiver, with no via key, and segmentation is unchanged", () => {
    const entries: SessionLogEntry[] = [
      dispatch("backend", "A", "build"),
      handoff("backend", "A", "success", null),
      { ts, origin: "main_session", log: "Bash(x)" },
      delivery("backend", "test", "T", "COLD"),
      dispatch("test", "T", "test it"),
      { ts, origin: "test", log: "Bash(npm test)" },
      handoff("test", "T", "success", null),
    ];
    const instances = buildInstances(entries);
    expect(instances.map((i) => i.origin)).toEqual(["main_session", "backend", "main_session", "test"]);
    const test = instances.find((i) => i.origin === "test")!;
    expect(test.delivered).toEqual([{ sender: "backend", receiver: "test", agent_id: "T", content: "COLD" }]);
    expect("via" in test.delivered[0]).toBe(false);
    expect(instances.find((i) => i.origin === "backend")!.delivered).toEqual([]);
  });

  it("a channel_delivery as the very first entry still opens a Main Session segment", () => {
    const instances = buildInstances([delivery("backend", "test", "T", "X"), dispatch("test", "T", "go")]);
    expect(instances[0].origin).toBe("main_session");
    expect(instances[0].displayName).toBe("Main Session");
    expect(instances).toHaveLength(1);
  });

  it("a delivery logged while another agent's segment is current does not split it, and attaches only by agent_id", () => {
    const entries: SessionLogEntry[] = [
      dispatch("backend", "A", "a"),
      dispatch("frontend", "F", "f"),
      { ts, origin: "backend", log: "Edit(/a1)" },
      delivery("reviewer", "frontend", "F", "FOR FRONTEND", "resume"),
      { ts, origin: "backend", log: "Edit(/a2)" },
      handoff("backend", "A", "success", null),
      { ts, origin: "frontend", log: "Edit(/f)" },
      handoff("frontend", "F", "success", null),
    ];
    const instances = buildInstances(entries);
    const backend = instances.filter((i) => i.origin === "backend");
    expect(backend).toHaveLength(1);
    expect(backend[0].status).toBe("success");
    expect(backend[0].delivered).toEqual([]);
    const frontend = instances.find((i) => i.origin === "frontend")!;
    expect(frontend.delivered.map((d) => d.content)).toEqual(["FOR FRONTEND"]);
  });

  // `112`: a scribe's SKILL_GAPS_HANDLED: line logs the gap it retired as via:"ack" at its
  // SubagentStop. The gap itself was already logged as an ordinary delivery at SubagentStart.
  it("carries via:'ack' onto the scribe's run, after its plain delivery, and does not count it as received", () => {
    const entries: SessionLogEntry[] = [
      delivery("frontend", "scribe", "S", "GAP"),
      dispatch("scribe", "S", "document it"),
      { ts, origin: "scribe", log: "Edit(/skill.md)" },
      delivery("frontend", "scribe", "S", "GAP", "ack"),
      handoff("scribe", "S", "success", null),
    ];
    const instances = buildInstances(entries);
    const scribe = instances.filter((i) => i.origin === "scribe");
    expect(scribe).toHaveLength(1);
    expect(scribe[0].status).toBe("success");
    expect(scribe[0].delivered).toEqual([
      { sender: "frontend", receiver: "scribe", agent_id: "S", content: "GAP" },
      { sender: "frontend", receiver: "scribe", agent_id: "S", content: "GAP", via: "ack" },
    ]);
    expect(receivedCount(scribe[0])).toBe(1);
  });

  it("an ack whose gap was delivered in an earlier session still attaches, labelled, with zero received", () => {
    const entries: SessionLogEntry[] = [
      dispatch("scribe", "S", "document it"),
      delivery("backend", "scribe", "S", "OLD GAP", "ack"),
      handoff("scribe", "S", "success", null),
    ];
    const scribe = buildInstances(entries).find((i) => i.origin === "scribe")!;
    expect(scribe.delivered.map((d) => d.via)).toEqual(["ack"]);
    expect(receivedCount(scribe)).toBe(0);
  });

  it("the same gap kept across two scribe runs shows once per run, and only the acking run carries the ack", () => {
    const entries: SessionLogEntry[] = [
      delivery("frontend", "scribe", "S1", "GAP"),
      dispatch("scribe", "S1", "first"),
      handoff("scribe", "S1", "success", null),
      { ts, origin: "main_session", log: "Bash(x)" },
      delivery("frontend", "scribe", "S2", "GAP"),
      dispatch("scribe", "S2", "second"),
      delivery("frontend", "scribe", "S2", "GAP", "ack"),
      handoff("scribe", "S2", "success", null),
    ];
    const [first, second] = buildInstances(entries).filter((i) => i.origin === "scribe");
    expect(first.delivered.map((d) => d.via ?? "plain")).toEqual(["plain"]);
    expect(second.delivered.map((d) => d.via ?? "plain")).toEqual(["plain", "ack"]);
    expect([receivedCount(first), receivedCount(second)]).toEqual([1, 1]);
  });
});

describe("latestContextUsage", () => {
  const e = (origin: string, extra: Partial<SessionLogEntry> = {}): SessionLogEntry => ({
    ts,
    origin,
    log: "x",
    ...extra,
  });

  it("returns the latest stamped entry, skipping unstamped ones (never 0%)", async () => {
    const { latestContextUsage } = await import("../../src/renderer/src/utils/session-log.js");
    const entries = [
      e("backend", { ctx_pct: 10, ctx_model: "claude-sonnet-5" }),
      e("backend", { ctx_pct: 62, ctx_model: "claude-sonnet-5" }),
      e("backend", { kind: "phase", phase: "step1_gates" }),
    ];
    expect(latestContextUsage(entries, "backend")).toEqual({
      pct: 62,
      model: "claude-sonnet-5",
      windowTokens: 200_000,
    });
    expect(latestContextUsage([e("backend")], "backend")).toBeNull();
  });

  it("filters by origin, ignoring namespace", async () => {
    const { latestContextUsage } = await import("../../src/renderer/src/utils/session-log.js");
    const entries = [e("maestro:backend", { ctx_pct: 5, ctx_model: "m" }), e("test", { ctx_pct: 9, ctx_model: "m" })];
    expect(latestContextUsage(entries, "backend")?.pct).toBe(5);
    expect(latestContextUsage(entries, "reviewer")).toBeNull();
  });
});
