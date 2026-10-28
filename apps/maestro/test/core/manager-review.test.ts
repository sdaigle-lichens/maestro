// The `manager_review` node type (task 131): graph model, step-id parsing, the `manager review`
// success-path label, success-edge resolution through it, and its direction-change condition edge.

import { describe, it, expect } from "vitest";

import { handoffRoutes } from "../../src/core/handoff-routes.js";
import { nodeLabel, successPathSteps, workflowNodeLabels } from "../../src/core/success-path.js";
import { applyWorkflowSpec, workflowToSpec } from "../../src/core/workflow-spec.js";
import { defaultV3Config } from "../../src/core/seed.js";

const DIRECTION = "manager requested direction change";

function setup() {
  const cfg = defaultV3Config(["backend"]);
  const spec = {
    name: "reviewed",
    steps: ["backend", "manager_review-1", "reviewer"],
    conditions: [{ from: "manager_review-1", to: "backend", label: DIRECTION }],
  };
  const result = applyWorkflowSpec(cfg, spec, "create");
  return { cfg: result.config, wf: result.workflow, result, spec };
}

describe("manager_review in the workflow spec", () => {
  it("builds a manager_review node from a manager_review-N step", () => {
    const { wf, result } = setup();
    expect(result.errors).toEqual([]);
    expect(wf.nodes.find((n) => n.id === "manager_review-1")?.type).toBe("manager_review");
  });

  it("round-trips through workflowToSpec back to the same steps and condition", () => {
    const { wf, cfg, spec } = setup();
    const back = workflowToSpec(wf, cfg.workflow_instances);
    expect(back.steps).toEqual(spec.steps);
    expect(back.conditions).toEqual(spec.conditions);
  });

  it("does not treat a malformed id as a manager review", () => {
    const cfg = defaultV3Config(["backend"]);
    const r = applyWorkflowSpec(cfg, { name: "x", steps: ["manager_review-x"] }, "create");
    expect(r.workflow.nodes.some((n) => n.type === "manager_review")).toBe(false);
  });
});

describe("manager review on the success path", () => {
  it("labels the node `manager review` and keeps human_review distinct", () => {
    const { wf, cfg } = setup();
    expect(nodeLabel("manager_review-1", wf, cfg.workflow_instances)).toBe("manager review");
    expect(successPathSteps(wf, cfg.workflow_instances)).toEqual(["@backend", "manager review", "@reviewer"]);
    expect(workflowNodeLabels(wf, cfg.workflow_instances).has("manager review")).toBe(true);
    const human = applyWorkflowSpec(cfg, { name: "h", steps: ["backend", "human_review-1"] }, "create").workflow;
    expect(successPathSteps(human, cfg.workflow_instances)).toEqual(["@backend", "human review"]);
  });

  it("resolves the agent's success edge through the manager_review node to the next agent", () => {
    const { wf, cfg } = setup();
    const routes = handoffRoutes([wf], cfg.workflow_instances);
    expect(routes.find((r) => r.sender === "backend" && r.label === "success")?.receiver).toBe("reviewer");
  });
});
