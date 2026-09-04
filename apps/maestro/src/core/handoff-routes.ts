// Which handoff routes a project's workflow graph actually wires — the ONE answer to that
// question, for everyone who asks it.
//
// LIFTED OUT OF plugins/maestro/scripts/maestro-inject-agent-context.js's `collect()`, which had
// carried its own copy of this walk since the hook was written. `033` needed the same walk on the
// install side (to decide which `.claude/handoffs/<sender>/<receiver>.md` files to materialize),
// and two answers to "which handoffs does this project have" is how the installed files and the
// app's editing surface start disagreeing. So the hook now calls this, and the sync calls this,
// and there is nothing left to drift.
//
// Deliberately NOT an `agents_available` cross product: that materializes 18 files for a
// fullstack project whose workflows wire 6-8. A route exists because an edge exists.
//
// Pure — no `fs`, no `node:sqlite`, no config reading. It takes the workflows to search and the
// instance table to resolve node to agent, exactly what both callers already hold: the hook passes
// its `searchList` (the active workflow, or the union-and-warn fallback), the sync passes every
// workflow in the config.

import { bareAgentName } from "./success-path.js";
import type { MaestroInstanceV3, MaestroNodeV3, MaestroWorkflowV3 } from "./types.js";

export interface HandoffRoute {
  /** The agent emitting the HANDOFF line. Always a BARE name. */
  sender: string;
  /**
   * The agent that receives it, BARE — or null when the edge leads nowhere an agent can be
   * reached (a dangling edge, or a condition edge into a `human_review` node). A null receiver is
   * still a real route: the orchestrator can emit the HANDOFF line, there is just no protocol to
   * attach to it.
   */
  receiver: string | null;
  /** `"success"`, or the condition edge's own label. */
  label: string;
}

/**
 * Every route leaving every agent node in `workflows`, first-wins per `(sender, label)`.
 *
 * Two resolution rules, both inherited verbatim from the hook:
 *
 *   - a SUCCESS edge resolves THROUGH non-agent nodes (`human_review`, a `skill` node) by
 *     following that node's own success edge onward, so a review step between two agents doesn't
 *     hide the handoff behind it;
 *   - a CONDITION edge does not — it means "this specific thing happened", and silently rerouting
 *     it down somebody else's success path would attach the wrong protocol to it.
 *
 * An unlabeled condition edge is skipped entirely: the orchestrator matches a `HANDOFF:` line to a
 * route by its label, so a route with no label is unaddressable.
 */
export function handoffRoutes(
  workflows: MaestroWorkflowV3[] | null | undefined,
  instances: MaestroInstanceV3[] | null | undefined
): HandoffRoute[] {
  const instList = instances ?? [];
  const instByName = (name: string | undefined): MaestroInstanceV3 | undefined =>
    name === undefined ? undefined : instList.find((i) => i.name === name);

  const out: HandoffRoute[] = [];
  const seen = new Set<string>();

  for (const wf of workflows ?? []) {
    const nodes = wf.nodes ?? [];
    const edges = wf.edges ?? [];
    const nodeById = (id: string): MaestroNodeV3 | undefined => nodes.find((n) => n.id === id);

    // `followSuccess` is what separates the two rules above. Bounded by `visited` because a
    // workflow graph is user-authored and a success cycle through two human_review nodes would
    // otherwise recurse forever — the canvas does not prevent one.
    const agentOfNode = (
      node: MaestroNodeV3 | undefined,
      followSuccess: boolean,
      visited: Set<string> = new Set()
    ): string | null => {
      if (!node || visited.has(node.id)) return null;
      visited.add(node.id);
      if (node.type === "agent") {
        const inst = instByName(node.instance);
        return inst ? bareAgentName(inst.agent) : null;
      }
      if (!followSuccess) return null;
      const next = edges.find((e) => e.from === node.id && e.kind === "success");
      return next ? agentOfNode(nodeById(next.to), true, visited) : null;
    };

    for (const node of nodes) {
      if (node.type !== "agent") continue;
      const inst = instByName(node.instance);
      if (!inst) continue;
      const sender = bareAgentName(inst.agent);

      for (const edge of edges) {
        if (edge.from !== node.id) continue;
        const label = edge.kind === "success" ? "success" : edge.label;
        if (!label) continue;
        const key = `${sender} ${label}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ sender, receiver: agentOfNode(nodeById(edge.to), edge.kind === "success"), label });
      }
    }
  }

  return out;
}

/** The routes leaving one agent — what the SubagentStart hook injects, and what `034`'s UI lists. */
export function routesFrom(routes: HandoffRoute[], agent: string): HandoffRoute[] {
  const bare = bareAgentName(agent);
  return routes.filter((r) => r.sender === bare);
}

/**
 * The distinct `(sender, receiver)` pairs a project actually wires, as handoff ids — what the sync
 * materializes files for. Routes with a null receiver drop out: there is no pair to key a template
 * on.
 */
export function handoffPairs(routes: HandoffRoute[]): string[] {
  const ids = new Set<string>();
  for (const r of routes) if (r.receiver) ids.add(`${r.sender}/${r.receiver}`);
  return [...ids];
}
