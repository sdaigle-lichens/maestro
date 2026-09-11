// Coverage for task 063's workflow-spec module — `applyWorkflowSpec`/`workflowToSpec`, the
// mechanics behind the `create-workflow`/`update-workflow` skills. See
// `.claude/maestro-tasks/063-create-workflow-and-update-workflow-skills-over-a-workflow-spec-module.md`
// for the full acceptance-criteria list this file is checking off.
//
// Criterion 1 (round-trip exactness) is the one flagged in the task as having NO committed test —
// the implementing agent verified it with a throwaway scratch script rather than a real one. This
// file is that test.

import { describe, it, expect } from "vitest";

import { applyWorkflowSpec, workflowToSpec } from "../../src/core/workflow-spec.js";
import { defaultV3Config } from "../../src/core/seed.js";
import type { MaestroConfigV3, MaestroWorkflowV3 } from "../../src/core/types.js";

// The three seeded profiles the task names: backend-only, infra-only, and fullstack. 6 + 3 + 6 =
// 15 workflows, matching the task's "15 workflows total across the three profiles."
const PROFILES: { label: string; chain: string[] }[] = [
  { label: "backend", chain: ["backend"] },
  { label: "infra", chain: ["infra"] },
  { label: "backend+frontend", chain: ["backend", "frontend"] },
];

describe("applyWorkflowSpec / workflowToSpec round-trip (acceptance criterion 1)", () => {
  let totalWorkflows = 0;

  for (const { label, chain } of PROFILES) {
    const cfg = defaultV3Config(chain);

    it(`covers every workflow in the ${label} profile`, () => {
      // Sanity on the fixture itself, so a seed.ts change that silently drops a workflow fails
      // here instead of the loop below quietly iterating over fewer cases.
      expect(cfg.workflows.length).toBeGreaterThan(0);
    });

    for (const wf of cfg.workflows) {
      totalWorkflows++;
      it(`round-trips "${wf.name}" in the ${label} profile exactly — nodes, edges, positions`, () => {
        const spec = workflowToSpec(wf, cfg.workflow_instances);
        const result = applyWorkflowSpec(cfg, spec, "update");

        expect(result.errors).toEqual([]);
        expect(result.createdInstances).toEqual([]);

        // Order-sensitive on purpose: a reordering of nodes/edges is itself a regression a
        // consumer (the canvas, the renderer) could observe.
        expect(result.workflow.nodes).toEqual(wf.nodes);
        expect(result.workflow.edges).toEqual(wf.edges);
        expect(result.workflow).toEqual(wf);
      });
    }
  }

  it("actually exercised 15 workflows across the three profiles", () => {
    expect(totalWorkflows).toBe(15);
  });
});

describe("update preserves hand-moved positions (acceptance criterion 3)", () => {
  it("keeps a node's mutated position after a spec round-trip in update mode", () => {
    const cfg = defaultV3Config(["backend"]);
    const wf = cfg.workflows.find((w) => w.name === "default") as MaestroWorkflowV3;
    expect(wf).toBeDefined();

    // Simulate a hand-drag in the desktop app: mutate one node's position to something the
    // layout code would never compute on its own.
    const draggedNodeId = "reviewer";
    const draggedPosition = { x: 452.69, y: 213.88 };
    const mutatedWorkflow: MaestroWorkflowV3 = {
      ...wf,
      nodes: wf.nodes.map((n) => (n.id === draggedNodeId ? { ...n, position: draggedPosition } : n)),
    };
    const mutatedCfg: MaestroConfigV3 = {
      ...cfg,
      workflows: cfg.workflows.map((w) => (w.name === "default" ? mutatedWorkflow : w)),
    };

    const spec = workflowToSpec(mutatedWorkflow, mutatedCfg.workflow_instances);
    const result = applyWorkflowSpec(mutatedCfg, spec, "update");

    expect(result.errors).toEqual([]);
    const reviewerNode = result.workflow.nodes.find((n) => n.id === draggedNodeId);
    expect(reviewerNode?.position).toEqual(draggedPosition);
    // And it's not just reviewer — every other node's position should also be untouched.
    for (const original of mutatedWorkflow.nodes) {
      const after = result.workflow.nodes.find((n) => n.id === original.id);
      expect(after?.position).toEqual(original.position);
    }
  });
});

describe("off-path condition endpoints get a side-column node (acceptance criterion 4)", () => {
  it("creates the `to` endpoint off-path when it names a step not in `steps`", () => {
    const cfg = defaultV3Config(["backend"]);
    const spec = {
      name: "off-path-to-test",
      steps: ["backend", "test"],
      conditions: [{ from: "test", to: "reviewer", label: "needs review" }],
    };
    const result = applyWorkflowSpec(cfg, spec, "create");

    expect(result.errors).toEqual([]);
    const reviewerNode = result.workflow.nodes.find((n) => n.id === "reviewer");
    expect(reviewerNode).toBeDefined();
    expect(reviewerNode?.position?.x).not.toBe(0);
    expect(reviewerNode?.position?.x).toBe(360);

    // The endpoints named IN steps stay on the main column (x: 0).
    const backendNode = result.workflow.nodes.find((n) => n.id === "backend");
    const testNode = result.workflow.nodes.find((n) => n.id === "test");
    expect(backendNode?.position?.x).toBe(0);
    expect(testNode?.position?.x).toBe(0);

    // The condition edge itself is present and wired correctly, not silently dropped.
    const edge = result.workflow.edges.find((e) => e.kind === "condition");
    expect(edge).toMatchObject({ from: "test", to: "reviewer", label: "needs review" });
  });

  it("creates the `from` endpoint off-path when it names a step not in `steps`", () => {
    const cfg = defaultV3Config(["backend"]);
    const spec = {
      name: "off-path-from-test",
      steps: ["backend", "test"],
      conditions: [{ from: "reviewer", to: "backend", label: "reviewer flags an issue" }],
    };
    const result = applyWorkflowSpec(cfg, spec, "create");

    expect(result.errors).toEqual([]);
    const reviewerNode = result.workflow.nodes.find((n) => n.id === "reviewer");
    expect(reviewerNode).toBeDefined();
    expect(reviewerNode?.position?.x).not.toBe(0);
    expect(reviewerNode?.position?.x).toBe(360);

    const edge = result.workflow.edges.find((e) => e.kind === "condition");
    expect(edge).toMatchObject({ from: "reviewer", to: "backend", label: "reviewer flags an issue" });
  });
});

describe("rejection cases (acceptance criteria 5, 6, 7)", () => {
  it("rejects a spec naming an agent the project does not offer, lists what IS available, invents nothing, writes nothing", () => {
    const cfg = defaultV3Config(["backend"]);
    const spec = { name: "brand-new", steps: ["backend", "totally-unavailable-agent"] };
    const result = applyWorkflowSpec(cfg, spec, "create");

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toMatch(/totally-unavailable-agent/);
    // Lists what IS available.
    for (const agent of cfg.agents_available) {
      expect(result.errors.join(" ")).toContain(agent);
    }
    expect(result.createdInstances).toEqual([]);
    // Nothing is invented: no new instance for the rejected agent.
    expect(result.config.workflow_instances.some((i) => i.name === "totally-unavailable-agent")).toBe(false);
    // The early-return path (workflow-spec.ts ~97-105 / the second errors-check ~206-214) hands
    // back the UNTOUCHED input config, not a copy with partial work applied.
    expect(result.config).toBe(cfg);
  });

  it("rejects two steps resolving to the same bare agent name before anything is built (same bare name, differing namespace)", () => {
    const cfg = defaultV3Config(["backend"]);
    // Seed two workflow_instances that both resolve to bare agent "backend": the existing
    // "backend" instance, and a second instance whose `agent` field carries a namespaced form of
    // the same bare name.
    const cfgWithNamespaced: MaestroConfigV3 = {
      ...cfg,
      workflow_instances: [
        ...cfg.workflow_instances,
        { name: "backend-2", agent: "maestro:backend", loaded_skills: [], referenced_skills: [] },
      ],
    };
    const spec = { name: "dup-agent", steps: ["backend", "backend-2"] };
    const result = applyWorkflowSpec(cfgWithNamespaced, spec, "create");

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toMatch(/backend/);
    expect(result.config).toBe(cfgWithNamespaced);
    expect(cfgWithNamespaced.workflows.some((w) => w.name === "dup-agent")).toBe(false);
  });

  it("rejects two distinct instance names that both point at the same agent", () => {
    const cfg = defaultV3Config(["backend"]);
    const cfgWithTwoBackends: MaestroConfigV3 = {
      ...cfg,
      workflow_instances: [
        ...cfg.workflow_instances,
        { name: "backend-again", agent: "backend", loaded_skills: [], referenced_skills: [] },
      ],
    };
    const spec = { name: "dup-agent-2", steps: ["backend", "backend-again"] };
    const result = applyWorkflowSpec(cfgWithTwoBackends, spec, "create");

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.config).toBe(cfgWithTwoBackends);
  });

  it("rejects create with a name that already exists", () => {
    const cfg = defaultV3Config(["backend"]);
    const spec = { name: "default", steps: ["backend"] };
    const result = applyWorkflowSpec(cfg, spec, "create");

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toMatch(/already exists/i);
    expect(result.config).toBe(cfg);
  });

  it("rejects update with a name that does not exist", () => {
    const cfg = defaultV3Config(["backend"]);
    const spec = { name: "does-not-exist", steps: ["backend"] };
    const result = applyWorkflowSpec(cfg, spec, "update");

    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.join(" ")).toMatch(/no workflow named/i);
    expect(result.config).toBe(cfg);
  });
});
