// `041` — the config check the canvas already prevents but a hand-edit or a merge conflict can
// still produce: two PLACED instances on one workflow sharing a bare agent. See config-validate.ts
// and the maestro-architecture skill for why this collapses route loss, unioned skills, and a
// channel-stamp collision at runtime — this only tests the REPORT, not the runtime fallout (that's
// handoff-routes.test.ts / handoffs.test.ts / handoff-channels territory).

import { describe, it, expect } from "vitest";
import { duplicateAgentTypes, validateConfig } from "../../src/core/config-validate.js";
import type { MaestroConfigV3, MaestroWorkflowV3 } from "../../src/core/types.js";

const succ = (from: string, to: string) => ({ from, to, kind: "success" }) as const;

function baseConfig(workflows: MaestroWorkflowV3[], instances: MaestroConfigV3["workflow_instances"]): MaestroConfigV3 {
  return {
    version: 3,
    agents_available: [],
    skills_available: [],
    workflow_instances: instances,
    workflows,
    rules: [],
  };
}

describe("duplicateAgentTypes", () => {
  it("reports a workflow with two PLACED instances on one bare agent", () => {
    const cfg = baseConfig(
      [
        {
          name: "default",
          nodes: [
            { id: "api", type: "agent", instance: "backend-api" },
            { id: "worker", type: "agent", instance: "backend-worker" },
          ],
          edges: [succ("api", "worker")],
        },
      ],
      [
        { name: "backend-api", agent: "backend", loaded_skills: [], referenced_skills: [] },
        { name: "backend-worker", agent: "backend", loaded_skills: [], referenced_skills: [] },
      ]
    );

    const issues = duplicateAgentTypes(cfg);
    expect(issues).toHaveLength(1);
    expect(issues[0].kind).toBe("duplicate-agent-type");
    expect(issues[0].workflow).toBe("default");
    expect(issues[0].detail).toContain("backend");
    expect(issues[0].detail).toContain("backend-api");
    expect(issues[0].detail).toContain("backend-worker");
  });

  it("reports nothing for one placed + one unplaced instance on the same agent", () => {
    const cfg = baseConfig(
      [
        {
          name: "default",
          nodes: [{ id: "api", type: "agent", instance: "backend-api" }],
          edges: [],
        },
      ],
      [
        { name: "backend-api", agent: "backend", loaded_skills: [], referenced_skills: [] },
        // Defined but never placed in any workflow node — costs nothing.
        { name: "backend-worker", agent: "backend", loaded_skills: [], referenced_skills: [] },
      ]
    );

    expect(duplicateAgentTypes(cfg)).toEqual([]);
  });

  it("reports nothing for two instances on the same agent in DIFFERENT workflows", () => {
    const cfg = baseConfig(
      [
        {
          name: "default",
          nodes: [{ id: "api", type: "agent", instance: "backend-api" }],
          edges: [],
        },
        {
          name: "alt",
          nodes: [{ id: "worker", type: "agent", instance: "backend-worker" }],
          edges: [],
        },
      ],
      [
        { name: "backend-api", agent: "backend", loaded_skills: [], referenced_skills: [] },
        { name: "backend-worker", agent: "backend", loaded_skills: [], referenced_skills: [] },
      ]
    );

    expect(duplicateAgentTypes(cfg)).toEqual([]);
  });

  it("compares namespaced and bare spellings of the same agent as equal", () => {
    const cfg = baseConfig(
      [
        {
          name: "default",
          nodes: [
            { id: "api", type: "agent", instance: "backend-api" },
            { id: "worker", type: "agent", instance: "backend-worker" },
          ],
          edges: [succ("api", "worker")],
        },
      ],
      [
        { name: "backend-api", agent: "maestro:backend", loaded_skills: [], referenced_skills: [] },
        { name: "backend-worker", agent: "backend", loaded_skills: [], referenced_skills: [] },
      ]
    );

    const issues = duplicateAgentTypes(cfg);
    expect(issues).toHaveLength(1);
    expect(issues[0].detail).toContain('"backend"');
  });

  it("reports nothing for a healthy config (each placed agent appears once per workflow)", () => {
    const cfg = baseConfig(
      [
        {
          name: "default",
          nodes: [
            { id: "api", type: "agent", instance: "backend-api" },
            { id: "test", type: "agent", instance: "test" },
          ],
          edges: [succ("api", "test")],
        },
      ],
      [
        { name: "backend-api", agent: "backend", loaded_skills: [], referenced_skills: [] },
        { name: "test", agent: "test", loaded_skills: [], referenced_skills: [] },
      ]
    );

    expect(duplicateAgentTypes(cfg)).toEqual([]);
  });

  it("returns [] for a null config", () => {
    expect(duplicateAgentTypes(null)).toEqual([]);
  });
});

describe("validateConfig", () => {
  it("is the aggregate of every config-hygiene check — currently just duplicateAgentTypes", () => {
    const cfg = baseConfig(
      [
        {
          name: "default",
          nodes: [
            { id: "api", type: "agent", instance: "backend-api" },
            { id: "worker", type: "agent", instance: "backend-worker" },
          ],
          edges: [succ("api", "worker")],
        },
      ],
      [
        { name: "backend-api", agent: "backend", loaded_skills: [], referenced_skills: [] },
        { name: "backend-worker", agent: "backend", loaded_skills: [], referenced_skills: [] },
      ]
    );

    expect(validateConfig(cfg)).toEqual(duplicateAgentTypes(cfg));
    expect(validateConfig(null)).toEqual([]);
  });
});
