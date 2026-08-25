// Success-path derivation and agent→skill resolution.
//
// PORTED FROM plugins/maestro/scripts/lib/maestro-session.cjs. This module is the
// single source of truth: `scripts/build-plugin-libs.mjs` bundles it back down to CJS for
// the standalone hook scripts, which must run under bare `node` with no node_modules.
//
// Keep it free of node built-ins — everything here is pure, which is what makes the parity
// tests and the CJS re-bundle straightforward.

import type { MaestroConfigV3, MaestroInstanceV3, MaestroWorkflowV3, MaestroSession } from "./types.js";

/**
 * Active workflow name resolution: an explicit name wins, otherwise the first configured
 * workflow, otherwise "default".
 */
export function resolveWorkflowName(cfg: Partial<MaestroConfigV3> | null, explicit?: string | null): string {
  if (explicit) return explicit;
  const workflows = cfg?.workflows ?? [];
  return workflows[0]?.name || "default";
}

export interface SearchListResult {
  searchList: MaestroWorkflowV3[];
  /** Non-null only in the degraded cases — surfaced to the subagent as a ⚠️ prefix. */
  warning: string | null;
  activeWorkflowName: string | null;
}

/**
 * Resolve which workflow(s) to search for an agent's instance, mirroring the
 * active-workflow / fallback / union-and-warn logic.
 */
export function resolveSearchList(
  cfg: Partial<MaestroConfigV3> | null,
  session: Partial<MaestroSession> | null
): SearchListResult {
  const workflows = cfg?.workflows ?? [];
  const activeWorkflowName = session?.workflow || null;
  const activeMatches = activeWorkflowName ? workflows.filter((w) => w.name === activeWorkflowName) : [];

  let warning: string | null = null;
  let searchList: MaestroWorkflowV3[];

  if (activeWorkflowName && activeMatches.length > 0) {
    searchList = activeMatches;
  } else if (activeWorkflowName) {
    searchList = workflows;
    warning =
      `The active workflow "${activeWorkflowName}" (from maestro_session.json) matches no workflow in maestro.json. ` +
      `The skills below are unioned across all workflows and may be wrong — re-run maestro-set-session-workflow.js with a valid workflow name.`;
  } else {
    const fallbackName = resolveWorkflowName(cfg);
    const fallbackMatches = workflows.filter((w) => w.name === fallbackName);
    searchList = fallbackMatches.length > 0 ? fallbackMatches : workflows;
    if (workflows.length > 1) {
      warning =
        `No active workflow is set (maestro-set-session-workflow.js was not run); falling back to the "${fallbackName}" workflow. ` +
        `If you intended a different workflow, the orchestrator should set it before invoking subagents.`;
    }
  }

  return { searchList, warning, activeWorkflowName };
}

/**
 * Normalize an agent identifier to its bare frontmatter name. At dispatch time Claude Code
 * addresses plugin-provided agents with a namespace prefix (e.g. "maestro:frontend"),
 * but maestro.json stores the bare name ("frontend"). Strip any "<plugin>:" prefix so the two
 * compare equal.
 */
export function bareAgentName(s: string | null | undefined): string {
  return (s || "").split(":").pop() ?? "";
}

export interface AgentSkills {
  loaded: string[];
  referenced: string[];
  matchedInstances: string[];
}

/**
 * Collect the loaded/referenced skill sets offered to `agentType` across the given workflows.
 * `loaded` (auto-load) wins over `referenced` (load-if-relevant) when the same skill appears
 * in both.
 */
export function collectAgentSkills(
  searchList: MaestroWorkflowV3[] | null | undefined,
  instances: MaestroInstanceV3[] | null | undefined,
  agentType: string | null | undefined
): AgentSkills {
  const instByName = (name: string | undefined) => (instances ?? []).find((i) => i.name === name);
  const wantAgent = bareAgentName(agentType);
  const loadedSet = new Set<string>();
  const referencedSet = new Set<string>();
  const matchedInstances: string[] = [];

  for (const wf of searchList ?? []) {
    for (const node of wf.nodes ?? []) {
      if (node.type !== "agent") continue;
      const inst = instByName(node.instance);
      if (!inst || bareAgentName(inst.agent) !== wantAgent) continue;
      matchedInstances.push(node.instance as string);
      for (const s of inst.loaded_skills ?? []) loadedSet.add(s);
      for (const s of inst.referenced_skills ?? []) referencedSet.add(s);
    }
  }

  for (const s of loadedSet) referencedSet.delete(s);

  return {
    loaded: Array.from(loadedSet),
    referenced: Array.from(referencedSet),
    matchedInstances,
  };
}

/** Human-readable label for a single workflow node. */
export function nodeLabel(
  id: string,
  wf: MaestroWorkflowV3,
  instances: MaestroInstanceV3[] | null | undefined
): string {
  if (id === "main-session") return "";
  const n = (wf.nodes ?? []).find((x) => x.id === id);
  if (!n) return id;
  if (n.type === "agent") {
    const inst = (instances ?? []).find((i) => i.name === n.instance);
    return "@" + (inst?.name || n.instance || n.id);
  }
  if (n.type === "skill") return "/" + (n.skill || n.id);
  return "human review";
}

/**
 * Ordered array of step labels along the success path of a workflow.
 * This is the SOLE source of truth for "what steps the workflow has in order".
 */
export function successPathSteps(wf: MaestroWorkflowV3, instances: MaestroInstanceV3[] | null | undefined): string[] {
  const out: string[] = [];
  let cur = "main-session";
  const seen = new Set<string>();
  while (!seen.has(cur)) {
    seen.add(cur);
    const next = (wf.edges ?? []).find((e) => e.from === cur && e.kind === "success");
    if (!next) break;
    const label = nodeLabel(next.to, wf, instances);
    if (label) out.push(label);
    cur = next.to;
  }
  return out;
}

/**
 * Set of ALL node labels in the workflow (success path + condition targets). Used to
 * distinguish "valid node, just off the success path" from "not in this workflow at all".
 */
export function workflowNodeLabels(
  wf: MaestroWorkflowV3,
  instances: MaestroInstanceV3[] | null | undefined
): Set<string> {
  const labels = new Set<string>();
  for (const n of wf.nodes ?? []) {
    const l = nodeLabel(n.id, wf, instances);
    if (l) labels.add(l);
  }
  return labels;
}
