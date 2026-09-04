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
