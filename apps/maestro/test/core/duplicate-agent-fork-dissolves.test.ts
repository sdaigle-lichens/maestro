// `041` — the point of the slice, asserted directly: forking a second instance onto a DISTINCT
// agent name dissolves all three runtime failures a colliding config causes. Each block below
// builds the BEFORE config (two instances sharing one bare `agent`, exactly what the canvas
// refuses to create and the picker's fork affordance exists to escape) and the AFTER config (the
// same graph, except the second instance's `agent` is what `forkAgent(..., newName)` would have
// produced), then asserts the failure on BEFORE and its absence on AFTER — reproduced against a
// hand-written two-instance config, not merely read off the task page's description.
//
// #4 (origin: agentType in the session log, so /session-log renders two instances as one) is
// `042`'s territory, not this slice's — see that task.

import { describe, it, expect } from "vitest";
import { handoffRoutes } from "../../src/core/handoff-routes.js";
import { bareAgentName, collectAgentSkills } from "../../src/core/success-path.js";
import { laneFor } from "../../src/core/handoff-channels.js";
import { duplicateAgentTypes } from "../../src/core/config-validate.js";
import type { MaestroConfigV3, MaestroInstanceV3 } from "../../src/core/types.js";

const succ = (from: string, to: string) => ({ from, to, kind: "success" }) as const;

/** Two instances on the "before" agent name, or split onto a forked second agent. */
function twoInstanceConfig(secondAgent: string): MaestroConfigV3 {
  const instances: MaestroInstanceV3[] = [
    { name: "backend-api", agent: "backend", loaded_skills: ["expressjs"], referenced_skills: ["confidence-check"] },
    { name: "backend-worker", agent: secondAgent, loaded_skills: ["queue-lib"], referenced_skills: ["retry-policy"] },
    { name: "test", agent: "test", loaded_skills: [], referenced_skills: [] },
    { name: "reviewer", agent: "reviewer", loaded_skills: [], referenced_skills: [] },
    { name: "scribe", agent: "scribe", loaded_skills: [], referenced_skills: [] },
  ];
  return {
    version: 3,
    agents_available: ["backend", secondAgent, "test", "reviewer", "scribe"],
    skills_available: [],
    workflow_instances: instances,
    workflows: [
      {
        name: "default",
        nodes: [
          { id: "backend-api", type: "agent", instance: "backend-api" },
          { id: "backend-worker", type: "agent", instance: "backend-worker" },
          { id: "test", type: "agent", instance: "test" },
          { id: "reviewer", type: "agent", instance: "reviewer" },
          { id: "scribe", type: "agent", instance: "scribe" },
        ],
        edges: [
          succ("main-session", "backend-api"),
          // Different receivers — matches the task page's own example, and proves the dedup key
          // is `sender + label`, NOT the receiver.
          succ("backend-api", "test"),
          succ("backend-worker", "reviewer"),
        ],
      },
      {
        // A SECOND workflow where both instances route to the SAME receiver — the shape that
        // demonstrates the channel-lane collision (#3), since a lane path is keyed by
        // `<receiver>/<sender>`, and two different receivers would never collide regardless of
        // the sender-name bug.
        name: "shared-receiver",
        nodes: [
          { id: "backend-api-2", type: "agent", instance: "backend-api" },
          { id: "backend-worker-2", type: "agent", instance: "backend-worker" },
          { id: "scribe-2", type: "agent", instance: "scribe" },
        ],
        edges: [succ("backend-api-2", "scribe-2"), succ("backend-worker-2", "scribe-2")],
      },
    ],
    rules: [],
  };
}

const before = twoInstanceConfig("backend"); // the collision `041` exists for
const after = twoInstanceConfig("backend-worker"); // what a rename-fork produces

it("the fixtures themselves are what the validator flags/clears — sanity check", () => {
  expect(duplicateAgentTypes(before).length).toBeGreaterThan(0);
  expect(duplicateAgentTypes(after)).toEqual([]);
});

describe("#1 route loss — handoff-routes.ts dedups on `sender + label`", () => {
  it("BEFORE: one of the two success routes is silently discarded", () => {
    const routes = handoffRoutes(before.workflows, before.workflow_instances);
    const fromBackend = routes.filter((r) => r.sender === "backend" && r.label === "success");
    // Both `backend-api --success--> test` and `backend-worker --success--> reviewer` want the
    // key "backend success" — first-wins means exactly one survives, not two.
    expect(fromBackend).toHaveLength(1);
    expect(fromBackend[0].receiver).toBe("test");
    expect(routes.some((r) => r.receiver === "reviewer")).toBe(false);
  });

  it("AFTER the fork: both routes are distinct and both survive", () => {
    const routes = handoffRoutes(after.workflows, after.workflow_instances);
    expect(routes).toContainEqual({ sender: "backend", receiver: "test", label: "success" });
    expect(routes).toContainEqual({ sender: "backend-worker", receiver: "reviewer", label: "success" });
  });
});

describe("#2 unioned skills — success-path.ts's collectAgentSkills", () => {
  it("BEFORE: querying the shared bare agent returns the UNION of both instances' skills", () => {
    const skills = collectAgentSkills(before.workflows, before.workflow_instances, "backend");
    expect(skills.loaded.sort()).toEqual(["expressjs", "queue-lib"]);
    expect(skills.referenced.sort()).toEqual(["confidence-check", "retry-policy"]);
    // Placed in both fixture workflows, so each instance is matched twice.
    expect(skills.matchedInstances.sort()).toEqual(["backend-api", "backend-api", "backend-worker", "backend-worker"]);
  });

  it("AFTER the fork: each agent type resolves only its own instance's skills", () => {
    const backendSkills = collectAgentSkills(after.workflows, after.workflow_instances, "backend");
    expect(backendSkills.loaded).toEqual(["expressjs"]);
    expect(backendSkills.referenced).toEqual(["confidence-check"]);
    expect(backendSkills.matchedInstances).toEqual(["backend-api", "backend-api"]); // placed in both workflows

    const workerSkills = collectAgentSkills(after.workflows, after.workflow_instances, "backend-worker");
    expect(workerSkills.loaded).toEqual(["queue-lib"]);
    expect(workerSkills.referenced).toEqual(["retry-policy"]);
    expect(workerSkills.matchedInstances).toEqual(["backend-worker", "backend-worker"]);
  });
});

describe("#3 channel-stamp collision — handoff-channels.ts's laneFor", () => {
  /**
   * The lane a given INSTANCE writes to, resolved the way the runtime resolves it: `SubagentStart`
   * knows only the bare agent type, never which instance is running, so the sender half of the
   * path comes from `bareAgentName(inst.agent)`. Both sides are read off the fixture rather than
   * spelled out as literals — otherwise the assertion is a string compared to itself and cannot
   * fail if lanes ever became instance-keyed.
   */
  function laneForInstance(cfg: MaestroConfigV3, instanceName: string, receiver: string): string {
    const inst = cfg.workflow_instances.find((i) => i.name === instanceName);
    if (!inst) throw new Error(`fixture has no instance "${instanceName}"`);
    return laneFor("/project", bareAgentName(inst.agent), receiver);
  }

  it("BEFORE: both instances resolve to the SAME lane file for a shared receiver", () => {
    // In the `shared-receiver` workflow both of these route to `scribe`, and both resolve their
    // sender to the bare agent `backend` — one lane file, two writers.
    expect(laneForInstance(before, "backend-api", "scribe")).toBe(laneForInstance(before, "backend-worker", "scribe"));
  });

  it("AFTER the fork: the two instances write to distinct lane files", () => {
    expect(laneForInstance(after, "backend-api", "scribe")).not.toBe(
      laneForInstance(after, "backend-worker", "scribe")
    );
    // And the surviving path is the forked sender's own, not a rename of the original's.
    expect(laneForInstance(after, "backend-worker", "scribe")).toContain("backend-worker");
  });
});
