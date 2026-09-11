// Applying and reading back a compact WorkflowSpec — the mechanics behind the `create-workflow`
// and `update-workflow` skills, which add or change a workflow in `.claude/maestro.json` from a
// declarative spec instead of hand-authored graph JSON.
//
// PURE — no `fs`, no `node:sqlite`, no node built-in of any kind, matching `seed.ts`'s own header
// discipline. It must run under bare `node` with no `node_modules` once bundled to
// `plugins/maestro/scripts/lib/maestro-workflow-spec.cjs`; agent discovery (what's actually
// installed) stays OUTSIDE this module — `cfg.agents_available` arrives as data, already resolved
// by the caller (the CLI, which does touch fs to read maestro.json).
//
// Layout is DELEGATED, never retyped: `placeConditionLabels` (label-layout.ts) owns condition-label
// placement, `sideTracker` + `BASE_STEP`/`PER_SKILL_STEP` (seed.ts) own which side a condition edge
// exits from and the vertical rhythm of a freshly laid-out column. This module's own job is
// deciding WHICH nodes and edges exist and where a genuinely new one starts out — never how a label
// or a handle is drawn.

import { placeConditionLabels } from "./label-layout.js";
import { BASE_STEP, PER_SKILL_STEP, sideTracker } from "./seed.js";
import { bareAgentName } from "./success-path.js";
import { duplicateAgentTypes } from "./config-validate.js";
import type { ApplyWorkflowSpecResult, WorkflowSpec } from "./contracts.js";
import type { MaestroConfigV3, MaestroEdgeV3, MaestroInstanceV3, MaestroNodeV3, MaestroWorkflowV3 } from "./types.js";

/** Off-path nodes (a condition endpoint not on the success path) get their own column. */
const SIDE_COLUMN_X = 360;

interface ParsedStep {
  /** The node id this step token resolves to — equal to the token itself except for `skill:<id>`. */
  id: string;
  type: "agent" | "human_review" | "skill";
  /** agent steps only: the `workflow_instances` name this step refers to (== the token). */
  instance?: string;
  /** skill steps only: the bare skill id. */
  skill?: string;
}

/**
 * Parse one `WorkflowSpec.steps`/condition-endpoint token into what kind of node it names.
 *
 * The exact vocabulary `seed.ts`'s `linearWorkflow` already uses (see its lines ~181-189):
 * `"human_review-1"` is the one representable human-review node; `"skill:<id>"` is a skill node run
 * inline by the orchestrator, keyed by the bare id (not the `skill:`-prefixed token); anything else
 * is the literal name of a `workflow_instances` entry.
 */
function parseStep(step: string): ParsedStep {
  if (step === "human_review-1") return { id: step, type: "human_review" };
  if (step.startsWith("skill:")) {
    const skill = step.slice("skill:".length);
    return { id: skill, type: "skill", skill };
  }
  return { id: step, type: "agent", instance: step };
}

const succ = (from: string, to: string): MaestroEdgeV3 => ({
  from,
  to,
  kind: "success",
  sourceHandle: "bottom",
  targetHandle: "top",
});

/**
 * Build (or update) one workflow in `cfg` from a `WorkflowSpec`. Pure: returns a new config and
 * workflow, writes nothing anywhere. See `ApplyWorkflowSpecResult`'s own doc for the result shape.
 *
 * `mode: "create"` errors if `spec.name` already names a workflow in `cfg.workflows`; `"update"`
 * errors if it does not. Past that check, every step and condition endpoint is resolved to a node:
 * an existing `workflow_instances` name is reused as-is; a name that doesn't exist yet is created
 * fresh (`{ name: step, agent: step, loaded_skills: [], referenced_skills: [] }`) ONLY when that
 * name (compared as a bare agent name) is offered in `cfg.agents_available` — otherwise the step is
 * rejected with a message listing what IS available, and nothing is invented. Two steps resolving to
 * the same bare agent name is rejected the same way, before anything is built further — that
 * collision breaks route dedup, skill injection and channel lanes at runtime (see
 * `config-validate.ts`'s `duplicateAgentTypes`, which this function also runs — but only to REPORT,
 * post-write, never to gate it).
 *
 * On `"update"`, a node id already present in the target workflow's CURRENT `nodes[]` keeps its
 * stored `position` — only a genuinely new node gets a fresh one, laid out on the main column
 * (`x: 0`, success-path order) or a side column (`x: 360`, everything else) using the same
 * `BASE_STEP`/`PER_SKILL_STEP` vertical rhythm `seed.ts` seeds with. Condition-label offsets are
 * always recomputed via `placeConditionLabels`, in every mode.
 */
export function applyWorkflowSpec(
  cfg: MaestroConfigV3,
  spec: WorkflowSpec,
  mode: "create" | "update"
): ApplyWorkflowSpecResult {
  const existingWorkflow = cfg.workflows.find((w) => w.name === spec.name);
  const errors: string[] = [];

  if (mode === "create" && existingWorkflow) {
    errors.push(`A workflow named "${spec.name}" already exists. Use update mode, or choose a different name.`);
  }
  if (mode === "update" && !existingWorkflow) {
    errors.push(`No workflow named "${spec.name}" exists to update. Use create mode, or check the name.`);
  }
  if (errors.length > 0) {
    return {
      config: cfg,
      workflow: existingWorkflow ?? { name: spec.name, nodes: [], edges: [] },
      createdInstances: [],
      issues: [],
      errors,
    };
  }

  // Every node id already present in the workflow being updated keeps its stored position.
  const existingPositions = new Map<string, { x: number; y: number }>();
  if (existingWorkflow) {
    for (const n of existingWorkflow.nodes) if (n.position) existingPositions.set(n.id, n.position);
  }

  const instancesByName = new Map(cfg.workflow_instances.map((i) => [i.name, i]));
  const createdInstances: string[] = [];
  const newInstances: MaestroInstanceV3[] = [];

  function resolveAgentInstance(name: string): MaestroInstanceV3 | null {
    const found = instancesByName.get(name);
    if (found) return found;
    const bare = bareAgentName(name);
    const offered = cfg.agents_available.some((a) => bareAgentName(a) === bare);
    if (!offered) return null;
    const inst: MaestroInstanceV3 = { name, agent: name, loaded_skills: [], referenced_skills: [] };
    instancesByName.set(name, inst);
    newInstances.push(inst);
    createdInstances.push(name);
    return inst;
  }

  const skillCount = (instanceName: string): number => {
    const inst = instancesByName.get(instanceName);
    return inst ? inst.loaded_skills.length + inst.referenced_skills.length : 0;
  };

  const nodes: MaestroNodeV3[] = [];
  const nodeById = new Map<string, MaestroNodeV3>();
  // Every bare agent name already placed in THIS workflow, keyed to the instance name that placed
  // it first — so a second step resolving to the same bare agent is caught before anything else is
  // built, matching `duplicateAgentTypes`'s own definition of the collision (two PLACED instances
  // in one workflow sharing a bare agent).
  const placedBareAgents = new Map<string, string>();

  function buildNode(token: string, x: number, y: number): MaestroNodeV3 | null {
    const parsed = parseStep(token);
    const already = nodeById.get(parsed.id);
    if (already) return already;

    if (parsed.type === "human_review" || parsed.type === "skill") {
      const node: MaestroNodeV3 =
        parsed.type === "human_review"
          ? { id: parsed.id, type: "human_review", position: existingPositions.get(parsed.id) ?? { x, y } }
          : {
              id: parsed.id,
              type: "skill",
              skill: parsed.skill,
              position: existingPositions.get(parsed.id) ?? { x, y },
            };
      nodeById.set(node.id, node);
      nodes.push(node);
      return node;
    }

    const inst = resolveAgentInstance(parsed.instance as string);
    if (!inst) {
      const available = cfg.agents_available.length > 0 ? cfg.agents_available.join(", ") : "(none)";
      errors.push(
        `Step "${token}" names no existing workflow instance and no such agent is available. Available agents: ${available}.`
      );
      return null;
    }
    const bare = bareAgentName(inst.agent);
    const placedAs = placedBareAgents.get(bare);
    if (placedAs && placedAs !== inst.name) {
      errors.push(
        `Steps "${placedAs}" and "${inst.name}" both resolve to agent "${bare}" — two instances of the same ` +
          `agent cannot be placed in one workflow.`
      );
      return null;
    }
    placedBareAgents.set(bare, inst.name);
    const node: MaestroNodeV3 = {
      id: parsed.id,
      type: "agent",
      instance: inst.name,
      position: existingPositions.get(parsed.id) ?? { x, y },
    };
    nodeById.set(node.id, node);
    nodes.push(node);
    return node;
  }

  // Main column: the success chain, in order, x: 0.
  let mainY = BASE_STEP;
  for (const step of spec.steps) {
    const node = buildNode(step, 0, mainY);
    if (node) mainY += BASE_STEP + (node.type === "agent" ? skillCount(node.instance as string) : 0) * PER_SKILL_STEP;
  }

  // Side column: every condition endpoint not already on the success path, x: 360, in the order it
  // is first introduced by `spec.conditions` — the same order the seeded `refactor`/impl-agent side
  // nodes are built in (`buildWorkflow`/`buildTestsWorkflow`), which is what keeps a round-tripped
  // spec's node order matching the original.
  let sideY = BASE_STEP;
  for (const c of spec.conditions ?? []) {
    for (const token of [c.from, c.to]) {
      const id = parseStep(token).id;
      if (nodeById.has(id)) continue;
      const node = buildNode(token, SIDE_COLUMN_X, sideY);
      if (node) sideY += BASE_STEP + (node.type === "agent" ? skillCount(node.instance as string) : 0) * PER_SKILL_STEP;
    }
  }

  if (errors.length > 0) {
    return {
      config: cfg,
      workflow: existingWorkflow ?? { name: spec.name, nodes: [], edges: [] },
      createdInstances: [],
      issues: [],
      errors,
    };
  }

  const seq = ["main-session", ...spec.steps.map((s) => parseStep(s).id)];
  const edges: MaestroEdgeV3[] = [];
  for (let i = 0; i < seq.length - 1; i++) edges.push(succ(seq[i], seq[i + 1]));

  // Which side a condition edge exits from is otherwise decided by `sideTracker`'s left/right
  // alternation per source column — but that alternation is stateful, and the seeded builders
  // (`buildWorkflow` et al.) call it in a construction order that is NOT the final edges[] order
  // (their `reviewerCode`/`refactorCode` arrays are built, and so call `side()`, before the
  // `edges.push(...)` statement that determines storage order). Replaying `side()` in
  // `spec.conditions` order alone would therefore reassign a different side to an unchanged route.
  // So an already-existing condition edge (matched by from/to/label, same as `workflowToSpec`
  // reads it back) KEEPS its stored `sourceHandle` — the same "don't relay out what didn't move"
  // rule this function applies to node positions — and only a genuinely new route takes whatever
  // `sideTracker` computes. `side()` is still called for every route, existing or new, purely to
  // keep its alternation counter advancing the way it would if every route had been placed fresh,
  // so a route added alongside several existing ones on the same source still alternates sensibly.
  const existingConditionSide = new Map<string, string>();
  if (existingWorkflow) {
    for (const e of existingWorkflow.edges) {
      if (e.kind === "condition" && e.sourceHandle)
        existingConditionSide.set(`${e.from}|${e.to}|${e.label ?? ""}`, e.sourceHandle);
    }
  }
  const side = sideTracker(nodes);
  for (const c of spec.conditions ?? []) {
    const from = parseStep(c.from).id;
    const to = parseStep(c.to).id;
    const computedSide = side(from, to);
    const sourceHandle = existingConditionSide.get(`${from}|${to}|${c.label}`) ?? computedSide;
    edges.push({ from, to, kind: "condition", label: c.label, sourceHandle, targetHandle: "top" });
  }

  const workflow = placeConditionLabels({ name: spec.name, nodes, edges }, skillCount);

  const workflows =
    mode === "create" ? [...cfg.workflows, workflow] : cfg.workflows.map((w) => (w.name === spec.name ? workflow : w));
  const config: MaestroConfigV3 = {
    ...cfg,
    workflow_instances: [...cfg.workflow_instances, ...newInstances],
    workflows,
  };

  // Reported alongside the result, never used to repair or refuse the write — see this file's own
  // header and `config-validate.ts`'s.
  const issues = duplicateAgentTypes(config);

  return { config, workflow, createdInstances, issues, errors: [] };
}

/**
 * The inverse of `applyWorkflowSpec`: the `WorkflowSpec` that would round-trip a workflow already
 * on disk. `steps` walks the success path from `main-session` (node IDS in step-token vocabulary,
 * not the display labels `successPathSteps` in `success-path.ts` produces — those read `"@backend"`,
 * which isn't a step token). `conditions` is every labeled condition edge; an unlabeled one is
 * dropped, matching the HANDOFF contract's own rule that an unlabeled condition edge isn't routable.
 */
export function workflowToSpec(wf: MaestroWorkflowV3, _instances: MaestroInstanceV3[]): WorkflowSpec {
  // `_instances` is part of the signature for symmetry with `applyWorkflowSpec`'s inputs and
  // because a future step-token vocabulary addition may need it; today a node's own `instance`
  // field already carries the name a step token resolves to, so nothing here reads the array.
  const nodeById = new Map(wf.nodes.map((n) => [n.id, n]));

  function tokenFor(nodeId: string): string {
    const node = nodeById.get(nodeId);
    if (!node) return nodeId;
    if (node.type === "human_review") return node.id;
    if (node.type === "skill") return `skill:${node.skill ?? node.id}`;
    return node.instance ?? node.id;
  }

  const steps: string[] = [];
  const seen = new Set<string>(["main-session"]);
  let cur = "main-session";
  for (;;) {
    const next = wf.edges.find((e) => e.from === cur && e.kind === "success");
    if (!next || seen.has(next.to)) break;
    steps.push(tokenFor(next.to));
    seen.add(next.to);
    cur = next.to;
  }

  const conditions = wf.edges
    .filter((e) => e.kind === "condition" && e.label)
    .map((e) => ({ from: tokenFor(e.from), to: tokenFor(e.to), label: e.label as string }));

  return { name: wf.name, steps, conditions: conditions.length > 0 ? conditions : undefined };
}
