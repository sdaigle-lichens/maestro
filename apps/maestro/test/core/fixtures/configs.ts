// Config fixtures for the parity tests. These deliberately cover the shapes that have bitten
// before: the synthetic `main-session` entry edge that appears in `edges` but never in `nodes`,
// non-agent nodes on the success path (human_review, skill), a cycle created by a condition edge
// routing backwards, and an instance whose agent carries a plugin namespace prefix.

import type { MaestroConfigV3 } from "../../../src/core/types.js";

const succ = (from: string, to: string) =>
  ({ from, to, kind: "success", sourceHandle: "bottom", targetHandle: "top" }) as const;

const cond = (from: string, to: string, label: string) =>
  ({ from, to, kind: "condition", label, sourceHandle: "right", targetHandle: "top" }) as const;

/** The seeded "default" shape: main-session → backend → test → human review → scribe. */
export const defaultish: MaestroConfigV3 = {
  version: 3,
  agents_available: ["backend", "test", "reviewer", "refactor", "scribe"],
  skills_available: ["confidence-check", "expressjs", "tdd"],
  workflow_instances: [
    { name: "backend", agent: "backend", loaded_skills: ["expressjs"], referenced_skills: ["confidence-check"] },
    { name: "test", agent: "test", loaded_skills: [], referenced_skills: ["tdd"] },
    { name: "reviewer", agent: "reviewer", loaded_skills: [], referenced_skills: [] },
    { name: "scribe", agent: "scribe", loaded_skills: [], referenced_skills: [] },
  ],
  workflows: [
    {
      name: "default",
      nodes: [
        { id: "backend", type: "agent", instance: "backend", position: { x: 0, y: 100 } },
        { id: "test", type: "agent", instance: "test", position: { x: 0, y: 220 } },
        { id: "human_review-1", type: "human_review", position: { x: 0, y: 340 } },
        { id: "scribe", type: "agent", instance: "scribe", position: { x: 0, y: 460 } },
      ],
      edges: [
        succ("main-session", "backend"),
        succ("backend", "test"),
        succ("test", "human_review-1"),
        succ("human_review-1", "scribe"),
        cond("test", "backend", "tests failed"),
        cond("human_review-1", "backend", "human requested code corrections"),
      ],
    },
  ],
  rules: [
    { id: "python", scope: "project", source: "project" },
    { id: "sql", paths: ["src/backend/**"], source: "project" },
  ],
};

/**
 * Exercises skill nodes, a namespaced agent, and a workflow whose success path dead-ends. Also the
 * one fixture carrying a `gates` block — `defaultish` deliberately has none, so anything reading
 * gates across `allConfigs` walks both the present and the absent branch.
 */
export const withSkillNodes: MaestroConfigV3 = {
  version: 3,
  gates: { confidence_check: true, use_design_check: false },
  agents_available: ["frontend", "reviewer"],
  skills_available: ["react", "confidence-check"],
  workflow_instances: [
    // Namespaced agent — bareAgentName() must strip "maestro:".
    {
      name: "frontend_main",
      agent: "maestro:frontend",
      loaded_skills: ["react"],
      referenced_skills: ["react", "confidence-check"], // "react" is loaded → must be dropped here
    },
    { name: "reviewer_main", agent: "reviewer", loaded_skills: [], referenced_skills: [] },
  ],
  workflows: [
    {
      name: "tdd",
      nodes: [
        { id: "confidence", type: "skill", skill: "confidence-check" },
        { id: "frontend_main", type: "agent", instance: "frontend_main" },
        { id: "reviewer_main", type: "agent", instance: "reviewer_main" },
      ],
      edges: [
        succ("main-session", "confidence"),
        succ("confidence", "frontend_main"),
        succ("frontend_main", "reviewer_main"),
        cond("reviewer_main", "frontend_main", "code FAIL"),
      ],
    },
    {
      // No success edge out of main-session at all — the "(no steps configured)" case.
      name: "empty",
      nodes: [],
      edges: [],
    },
  ],
  rules: [],
};

/** A success edge cycle. The walk must terminate via its `seen` set rather than hang. */
export const cyclic: MaestroConfigV3 = {
  version: 3,
  agents_available: ["backend"],
  skills_available: [],
  workflow_instances: [
    { name: "a", agent: "backend", loaded_skills: [], referenced_skills: [] },
    { name: "b", agent: "backend", loaded_skills: [], referenced_skills: [] },
  ],
  workflows: [
    {
      name: "loop",
      nodes: [
        { id: "a", type: "agent", instance: "a" },
        { id: "b", type: "agent", instance: "b" },
      ],
      edges: [succ("main-session", "a"), succ("a", "b"), succ("b", "a")],
    },
  ],
  rules: [],
};

/** An edge pointing at a node id that doesn't exist — nodeLabel falls back to the raw id. */
export const danglingEdge: MaestroConfigV3 = {
  version: 3,
  agents_available: [],
  skills_available: [],
  workflow_instances: [],
  workflows: [
    {
      name: "dangling",
      nodes: [],
      edges: [succ("main-session", "ghost-node")],
    },
  ],
  rules: [],
};

export const allConfigs: Record<string, MaestroConfigV3> = {
  defaultish,
  withSkillNodes,
  cyclic,
  danglingEdge,
};
