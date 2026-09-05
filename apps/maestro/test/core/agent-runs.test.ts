// Unit tests for agent-runs.ts (`039`) — the resume-target index behind a condition-edge
// loop-back. No fixtures shared with parity.test.ts: this needs a workflow shaped specifically to
// exercise the ambiguity rule (two instances sharing one bare agent type), which the existing
// fixtures don't carry.

import { describe, it, expect } from "vitest";
import { agentRunsFromLog, resumeTarget } from "../../src/core/agent-runs.js";
import type { MaestroConfigV3, MaestroSession } from "../../src/core/types.js";

function handoff(agentType: string, agentId: string, ts = "2026-01-01T00:00:00.000Z") {
  return { ts, origin: agentType, kind: "handoff", agent_id: agentId, status: "condition", label: "x", output: "" };
}

function dispatch(agentType: string, agentId: string) {
  return {
    ts: "2026-01-01T00:00:00.000Z",
    origin: "main_session",
    kind: "dispatch",
    agent: agentType,
    agent_id: agentId,
    input: "",
  };
}

const session: MaestroSession = { workflow: "default", generated_instances: [], run_id: "r1" };

/** One workflow, one instance per bare agent type — the common, unambiguous shape. */
const singleInstanceCfg: MaestroConfigV3 = {
  version: 3,
  agents_available: ["backend", "test"],
  skills_available: [],
  workflow_instances: [
    { name: "backend", agent: "backend", loaded_skills: [], referenced_skills: [] },
    { name: "test", agent: "test", loaded_skills: [], referenced_skills: [] },
  ],
  workflows: [
    {
      name: "default",
      nodes: [
        { id: "backend", type: "agent", instance: "backend", position: { x: 0, y: 0 } },
        { id: "test", type: "agent", instance: "test", position: { x: 0, y: 0 } },
      ],
      edges: [
        { from: "main-session", to: "backend", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
        { from: "backend", to: "test", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
        {
          from: "test",
          to: "backend",
          kind: "condition",
          label: "tests failed",
          sourceHandle: "right",
          targetHandle: "top",
        },
      ],
    },
  ],
  rules: [],
};

/** Two distinct instances both mapped to the bare agent "backend" — the ambiguous shape. */
const duplicateInstanceCfg: MaestroConfigV3 = {
  ...singleInstanceCfg,
  workflow_instances: [
    { name: "backend-api", agent: "backend", loaded_skills: [], referenced_skills: [] },
    { name: "backend-worker", agent: "backend", loaded_skills: [], referenced_skills: [] },
  ],
  workflows: [
    {
      name: "default",
      nodes: [
        { id: "backend-api", type: "agent", instance: "backend-api", position: { x: 0, y: 0 } },
        { id: "backend-worker", type: "agent", instance: "backend-worker", position: { x: 0, y: 0 } },
      ],
      edges: [
        { from: "main-session", to: "backend-api", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
        { from: "backend-api", to: "backend-worker", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
        {
          from: "backend-worker",
          to: "backend-api",
          kind: "condition",
          label: "x",
          sourceHandle: "right",
          targetHandle: "top",
        },
      ],
    },
  ],
};

describe("agentRunsFromLog", () => {
  it("keeps only kind:handoff entries with an origin and agent_id, in file order", () => {
    const lines = [
      dispatch("backend", "id-0"),
      handoff("backend", "id-1", "t1"),
      { kind: "transition", origin: "transition", output: "" }, // no agent_type — skipped
      handoff("test", "id-2", "t2"),
      { ts: "t3", kind: "handoff", origin: "backend" }, // no agent_id — skipped
      { ts: "t4", kind: "handoff", agent_id: "id-3" }, // no origin — skipped
      "not an object",
      null,
    ];
    expect(agentRunsFromLog(lines)).toEqual([
      { agentType: "backend", agentId: "id-1", ts: "t1" },
      { agentType: "test", agentId: "id-2", ts: "t2" },
    ]);
  });

  it("returns an empty array for an empty or missing log", () => {
    expect(agentRunsFromLog([])).toEqual([]);
    expect(agentRunsFromLog(undefined as unknown as unknown[])).toEqual([]);
  });
});

describe("resumeTarget", () => {
  it("returns null when the agent has no completed run this session", () => {
    expect(resumeTarget([], singleInstanceCfg, session, "backend")).toBeNull();
  });

  it("returns the agent_id of a single completed run", () => {
    const lines = [handoff("backend", "run-1")];
    expect(resumeTarget(lines, singleInstanceCfg, session, "backend")).toBe("run-1");
  });

  it("takes the most recent matching entry across repeat visits", () => {
    const lines = [
      handoff("backend", "run-1", "t1"),
      handoff("test", "other", "t2"),
      handoff("backend", "run-2", "t3"),
    ];
    expect(resumeTarget(lines, singleInstanceCfg, session, "backend")).toBe("run-2");
  });

  it("bares both sides — a namespaced request matches a bare log entry and vice versa", () => {
    expect(resumeTarget([handoff("backend", "run-1")], singleInstanceCfg, session, "maestro:backend")).toBe("run-1");
    expect(resumeTarget([handoff("maestro:backend", "run-1")], singleInstanceCfg, session, "backend")).toBe("run-1");
  });

  it("returns null when the active workflow's search list resolves the type to two distinct instances", () => {
    const lines = [handoff("backend", "run-1")];
    expect(resumeTarget(lines, duplicateInstanceCfg, session, "backend")).toBeNull();
  });

  it("returns null for an empty agent type", () => {
    expect(resumeTarget([handoff("backend", "run-1")], singleInstanceCfg, session, "")).toBeNull();
  });

  it("ignores runs of a different agent type", () => {
    expect(resumeTarget([handoff("test", "run-1")], singleInstanceCfg, session, "backend")).toBeNull();
  });
});
