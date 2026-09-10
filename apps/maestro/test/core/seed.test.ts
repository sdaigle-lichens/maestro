// Coverage for the infra-only seeding profile added by task 052 (`isInfraOnlyChain`,
// `buildInfraWorkflow`, and the branch each of `seededAgentNames`/`defaultV3Config` takes for a
// chain that is EXACTLY ["infra"]). Application-chain seeding (`["backend"]`, fullstack, …) is
// already exercised end-to-end by `label-layout.test.ts` and `real-project.test.ts`; this file is
// the one that pins the new profile's shape and the regression guard that a mixed chain
// (`["infra","backend"]`) does NOT take it.

import { describe, it, expect } from "vitest";

import { defaultV3Config, seededAgentNames } from "../../src/core/seed.js";
import type { MaestroNodeV3 } from "../../src/core/types.js";

describe("infra-only seeding profile", () => {
  it("seeds exactly the default/Documentation/Review workflow set and infra/reviewer/scribe instances", () => {
    const cfg = defaultV3Config(["infra"]);
    expect(new Set(cfg.workflows.map((w) => w.name))).toEqual(new Set(["default", "Documentation", "Review"]));
    expect(cfg.workflows).toHaveLength(3);
    expect(new Set(cfg.workflow_instances.map((i) => i.name))).toEqual(new Set(["infra", "reviewer", "scribe"]));
    expect(cfg.workflow_instances).toHaveLength(3);
  });

  it("builds the default workflow as main-session → infra → human_review-1 → reviewer → scribe, with no test/refactor node", () => {
    const cfg = defaultV3Config(["infra"]);
    const wf = cfg.workflows.find((w) => w.name === "default");
    expect(wf).toBeDefined();

    // main-session is synthetic and never appears in nodes[]; the success chain of edges is what
    // encodes it as the entry point (see the workflow-view skill).
    expect(new Set(wf!.nodes.map((n) => n.id))).toEqual(new Set(["infra", "human_review-1", "reviewer", "scribe"]));
    expect(wf!.nodes.some((n) => n.id === "test" || n.id === "refactor")).toBe(false);

    const infraNode = wf!.nodes.find((n) => n.id === "infra") as MaestroNodeV3;
    expect(infraNode.type).toBe("agent");
    expect(infraNode.instance).toBe("infra");
    const reviewNode = wf!.nodes.find((n) => n.id === "human_review-1") as MaestroNodeV3;
    expect(reviewNode.type).toBe("human_review");

    // Success chain in order: main-session -> infra -> human_review-1 -> reviewer -> scribe.
    const success = wf!.edges.filter((e) => e.kind === "success");
    const expectedChain = ["main-session", "infra", "human_review-1", "reviewer", "scribe"];
    expect(success).toHaveLength(expectedChain.length - 1);
    for (let i = 0; i < expectedChain.length - 1; i++) {
      expect(success.some((e) => e.from === expectedChain[i] && e.to === expectedChain[i + 1])).toBe(true);
    }

    // Exactly two condition edges, both routed back to the infra agent: one from the reviewer's
    // code-issue route, one from the human-review correction route.
    const conditions = wf!.edges.filter((e) => e.kind === "condition");
    expect(conditions).toHaveLength(2);
    expect(conditions.every((e) => e.to === "infra")).toBe(true);
    expect(new Set(conditions.map((e) => e.from))).toEqual(new Set(["reviewer", "human_review-1"]));
  });

  it("has seededAgentNames agree with the instances defaultV3Config actually seeds, for infra-only and application chains", () => {
    const chains = [["infra"], ["backend"], ["backend", "frontend"], ["infra", "backend"]];
    for (const chain of chains) {
      const cfg = defaultV3Config(chain);
      expect(new Set(seededAgentNames(chain))).toEqual(new Set(cfg.workflow_instances.map((i) => i.name)));
    }
  });

  it("returns infra/reviewer/scribe (no test/refactor) for an infra-only chain", () => {
    expect(seededAgentNames(["infra"])).toEqual(["infra", "reviewer", "scribe"]);
  });

  it("does not switch a mixed infra+application chain into the infra-only profile", () => {
    const cfg = defaultV3Config(["infra", "backend"]);
    // The full six-workflow profile, unchanged shape from any other multi-agent chain.
    expect(new Set(cfg.workflows.map((w) => w.name))).toEqual(
      new Set(["default", "tdd", "Refactor", "Documentation", "Review", "Tests"])
    );
    expect(new Set(cfg.workflow_instances.map((i) => i.name))).toEqual(
      new Set(["infra", "backend", "test", "reviewer", "refactor", "scribe"])
    );

    const wf = cfg.workflows.find((w) => w.name === "default")!;
    // infra is an ordinary implementation step here: it appears in the happy path alongside
    // backend, and the workflow still has a test node, unlike the infra-only profile.
    expect(wf.nodes.some((n) => n.id === "infra")).toBe(true);
    expect(wf.nodes.some((n) => n.id === "test")).toBe(true);
    expect(wf.nodes.some((n) => n.id === "refactor")).toBe(true);

    // Reviewer/refactor code-issue and human-review-correction routes split per implementation
    // agent, same as any other multi-agent chain — infra gets its own edges, not special-cased away.
    const conditions = wf.edges.filter((e) => e.kind === "condition");
    expect(conditions.some((e) => e.from === "reviewer" && e.to === "infra")).toBe(true);
    expect(conditions.some((e) => e.from === "reviewer" && e.to === "backend")).toBe(true);
    expect(conditions.some((e) => e.from === "human_review-1" && e.to === "infra")).toBe(true);
    expect(conditions.some((e) => e.from === "human_review-1" && e.to === "backend")).toBe(true);
  });
});
