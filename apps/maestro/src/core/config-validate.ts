// Reports the collision the canvas already refuses to create: two workflow instances on the same
// bare `agent`, PLACED in the same workflow. `maestro.json` is explicitly hand-editable
// (CLAUDE.md, `/maestro-update`'s own description), so a hand-edit, a merge-conflict resolution,
// or any third-party write can produce it — and today nothing downstream complains. It reaches the
// runtime as route loss (`handoff-routes.ts` dedups on `sender + label` with `sender` the bare
// agent — one of two edges is silently discarded), unioned skills (`success-path.ts`), and a
// stamp collision (`handoff-channels.ts`). See task `041` and the `maestro-architecture` skill.
//
// Pure — no `fs`, matching `handoff-routes.ts`, which this leans on for the "placed" definition.
// REPORT ONLY: nothing here renames an instance or removes a node. Renaming somebody's instance or
// deleting a node is not a repair this tool gets to choose — the fork affordance in the picker is
// the offered way out.

import { bareAgentName } from "./success-path.js";
import type { ConfigIssue } from "./contracts.js";
import type { MaestroConfigV3 } from "./types.js";

export type { ConfigIssue };

/**
 * Per workflow, every bare agent carried by more than one PLACED instance — an instance an `agent`
 * node in THAT workflow actually references. An instance defined in `workflow_instances` but not
 * placed anywhere costs nothing (nothing downstream ever resolves it), and two instances on the
 * same agent in two different workflows don't collide with each other — a session only ever has
 * one active workflow. Namespaced (`maestro:backend`) and bare (`backend`) spellings of the same
 * agent compare equal, via the same `bareAgentName` every route/skill/channel resolution uses.
 */
export function duplicateAgentTypes(cfg: MaestroConfigV3 | null): ConfigIssue[] {
  if (!cfg) return [];
  const instByName = new Map(cfg.workflow_instances.map((i) => [i.name, i]));
  const issues: ConfigIssue[] = [];

  for (const wf of cfg.workflows ?? []) {
    const placedByAgent = new Map<string, Set<string>>();
    for (const node of wf.nodes ?? []) {
      if (node.type !== "agent" || !node.instance) continue;
      const inst = instByName.get(node.instance);
      if (!inst) continue;
      const agent = bareAgentName(inst.agent);
      const names = placedByAgent.get(agent) ?? new Set<string>();
      names.add(inst.name);
      placedByAgent.set(agent, names);
    }
    for (const [agent, names] of placedByAgent) {
      if (names.size < 2) continue;
      const list = [...names].sort();
      issues.push({
        kind: "duplicate-agent-type",
        workflow: wf.name,
        detail:
          `Workflow "${wf.name}" places ${list.length} instances on agent "${agent}" (${list.join(", ")}) — ` +
          `the runtime routes handoffs by agent type and can only see one of them. Fork "${agent}" as a new ` +
          `agent so each instance is distinct.`,
      });
    }
  }
  return issues;
}

/**
 * The aggregate seam for every config-hygiene check this slice — and any future one — adds.
 * `duplicateAgentTypes` is the only check in this slice; do not invent others here.
 */
export function validateConfig(cfg: MaestroConfigV3 | null): ConfigIssue[] {
  return [...duplicateAgentTypes(cfg)];
}
