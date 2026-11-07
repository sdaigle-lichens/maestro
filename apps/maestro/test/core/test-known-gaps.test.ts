// A post-mortem (acces-portail-email task 002) found @test ending `HANDOFF: fail` on work a later
// step owned (docs for @scribe) and on a check that only passes after a commit, with no fail route
// out of @test. Three fixes: seeded test -> implementer FAIL edges, a `knownGaps` field on the test
// report and the test -> reviewer handoff, and the later success-path steps injected at start.
// A failure only the user can fix (setup, environment) ends `HANDOFF: blocked` and stops instead.

import { describe, it, expect } from "vitest";

import { BLOCKED_LABEL, checkRoute } from "../../src/core/handoff-check.js";

import { handoffRoutes, laterSuccessSteps, routesFrom } from "../../src/core/handoff-routes.js";
import { PRIOR_SEEDS, SEED_HANDOFFS } from "../../src/core/handoff-seeds.js";
import { priorReportSeeds } from "../../src/core/report-defaults.js";
import { defaultV3Config } from "../../src/core/seed.js";
import { applyWorkflowSpec } from "../../src/core/workflow-spec.js";
import { readAgentReportDefault } from "../../src/core/report-defaults.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const wf = (cfg: ReturnType<typeof defaultV3Config>, name: string) => cfg.workflows.find((w) => w.name === name)!;

describe("seeded @test FAIL routes", () => {
  it("default and Tests route a test FAIL back to the one implementer", () => {
    const cfg = defaultV3Config(["backend"]);
    for (const name of ["default", "Tests"]) {
      const out = routesFrom(handoffRoutes([wf(cfg, name)], cfg.workflow_instances), "test");
      expect(out.filter((r) => r.label !== "success")).toContainEqual({
        sender: "test",
        receiver: "backend",
        label: "FAIL: a test exposes a code defect",
      });
    }
  });

  it("fullstack splits the test FAIL per implementer", () => {
    const cfg = defaultV3Config(["backend", "frontend"]);
    for (const name of ["default", "Tests"]) {
      const receivers = routesFrom(handoffRoutes([wf(cfg, name)], cfg.workflow_instances), "test")
        .filter((r) => r.label.startsWith("FAIL:"))
        .map((r) => r.receiver);
      expect(receivers.sort()).toEqual(["backend", "frontend"]);
    }
  });

  it("tdd seeds none: failing tests before the implementation are the expected output", () => {
    const cfg = defaultV3Config(["backend"]);
    const out = routesFrom(handoffRoutes([wf(cfg, "tdd")], cfg.workflow_instances), "test");
    expect(out.filter((r) => r.label !== "success")).toEqual([]);
  });
});

describe("laterSuccessSteps", () => {
  it("lists what runs after @test in the default workflow, in order", () => {
    const cfg = defaultV3Config(["backend", "frontend"]);
    expect(laterSuccessSteps([wf(cfg, "default")], cfg.workflow_instances, "test")).toEqual(["@reviewer", "@scribe"]);
    expect(laterSuccessSteps([wf(cfg, "default")], cfg.workflow_instances, "frontend")).toEqual([
      "manager_review",
      "@test",
      "@reviewer",
      "@scribe",
    ]);
  });

  it("is empty for the last step and for an agent the workflow does not hold", () => {
    const cfg = defaultV3Config(["backend"]);
    expect(laterSuccessSteps([wf(cfg, "default")], cfg.workflow_instances, "scribe")).toEqual([]);
    expect(laterSuccessSteps([wf(cfg, "default")], cfg.workflow_instances, "mobile")).toEqual([]);
  });

  it("ignores condition edges and terminates on a success cycle", () => {
    const cfg = defaultV3Config(["backend"]);
    const r = applyWorkflowSpec(
      cfg,
      { name: "loop", steps: ["test", "reviewer"], conditions: [{ from: "reviewer", to: "test", label: "FAIL" }] },
      "create"
    );
    expect(r.errors).toEqual([]);
    const w = r.workflow;
    w.edges.push({
      ...w.edges.find((e) => e.kind === "success" && e.from === "reviewer")!,
      from: "reviewer",
      to: "test",
    });
    expect(laterSuccessSteps([w], r.config.workflow_instances, "test")).toEqual(["@reviewer"]);
  });
});

describe("knownGaps on the test report and the test -> reviewer handoff", () => {
  it("the fresh test report carries knownGaps and the never-FAIL rule", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "known-gaps-"));
    try {
      const t = readAgentReportDefault("test", path.join(dir, "r.sqlite"))!.content;
      expect(t).toContain('"knownGaps"');
      expect(t).toContain("Two things are never a FAIL");
      expect(t).toContain('"notCaught"'); // the insert kept the field after it
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("the previous test report is a prior seed, so an unedited copy upgrades", () => {
    expect(priorReportSeeds("test").some((b) => b.includes('"hintsSkipped"') && !b.includes("knownGaps"))).toBe(true);
  });

  it("the test -> reviewer seed carries known_gaps, and the previous body is a prior seed", () => {
    expect(SEED_HANDOFFS["test/reviewer"]).toContain('"known_gaps"');
    expect(PRIOR_SEEDS["test/reviewer"][0]).toContain('"test_origin"');
    expect(PRIOR_SEEDS["test/reviewer"][0]).not.toContain("known_gaps");
  });
});

describe("HANDOFF: blocked", () => {
  const routes = [{ label: "success" }, { label: "FAIL: a test exposes a code defect" }];

  it("with no edge for it, is a stop for the user, not an unrouted label", () => {
    const issue = checkRoute("verdict: FAIL\nHANDOFF: blocked", routes, "default");
    expect(issue).toMatchObject({ kind: "blocked", label: "blocked", verdict: "FAIL" });
    expect(issue!.message).toContain("only the user can fix");
    expect(issue!.message).toContain("resume the same agent");
  });

  it("is matched case-insensitively, and routes normally when a workflow wires it", () => {
    expect(checkRoute("HANDOFF: Blocked", routes, "default")!.kind).toBe("blocked");
    expect(checkRoute("HANDOFF: blocked", [...routes, { label: BLOCKED_LABEL }], "default")).toBeNull();
  });

  it("does not change how other unrouted labels are reported", () => {
    expect(checkRoute("HANDOFF: blocked-ish", routes, "default")!.kind).toBe("unrouted");
  });
});
