// First-install seeding: the ready-made workflows a brand-new project's canvas opens with.
//
// PORTED VERBATIM (behaviour-wise) FROM apps/ai-tools-manager/src/utils/maestro.ts. Pure — no
// fs, no env. The web app read the implementation-agent chain out of a Docker precompute file;
// here it is just a parameter, and the caller decides where it comes from (M3 replaces the
// ["backend"] default with repo detection).

import { placeConditionLabels } from "./label-layout.js";
import type { MaestroConfigV3, MaestroEdgeV3, MaestroInstanceV3, MaestroNodeV3, MaestroWorkflowV3 } from "./types.js";

// The non-implementation agents every seeded workflow shares.
const CORE_INSTANCES: MaestroInstanceV3[] = [
  { name: "test", agent: "test", loaded_skills: [], referenced_skills: [] },
  { name: "reviewer", agent: "reviewer", loaded_skills: [], referenced_skills: [] },
  { name: "refactor", agent: "refactor", loaded_skills: [], referenced_skills: [] },
  { name: "scribe", agent: "scribe", loaded_skills: [], referenced_skills: [] },
];

const succ = (from: string, to: string): MaestroEdgeV3 => ({
  from,
  to,
  kind: "success",
  sourceHandle: "bottom",
  targetHandle: "top",
});

const cond = (from: string, to: string, label: string, side: "left" | "right" = "right"): MaestroEdgeV3 => ({
  from,
  to,
  kind: "condition",
  label,
  sourceHandle: side,
  targetHandle: "top",
});

/**
 * Which side a condition edge should exit from, given the seeded x positions.
 *
 * A route into a different column exits toward it — rightward when the target sits to the right
 * (e.g. into @refactor's side column), leftward when it sits to the left (e.g. out of @refactor
 * back into the main column). A route within the SAME column — the common case, a
 * reviewer/refactor FAIL routing back up to an earlier step — has no natural side, and every one
 * of them used to exit "right" regardless: that's what piled every back-route's bulge, and then
 * its label, into the same corridor on the right of the canvas. Those alternate left/right per
 * source node instead, so a source with several same-column conditions splits its curves across
 * both sides rather than stacking them all on one.
 */
function sideTracker(nodes: MaestroNodeV3[]): (from: string, to: string) => "left" | "right" {
  const xById = new Map(nodes.map((n) => [n.id, n.position?.x ?? 0]));
  const sameColumnCount = new Map<string, number>();
  return (from, to) => {
    const a = xById.get(from) ?? 0;
    const b = xById.get(to) ?? 0;
    if (b > a) return "right";
    if (b < a) return "left";
    const n = sameColumnCount.get(from) ?? 0;
    sameColumnCount.set(from, n + 1);
    return n % 2 === 0 ? "left" : "right";
  };
}

// Vertical rhythm for the seeded layout. A skill-less node gets BASE_STEP of room; each
// attached skill chip wraps onto ~its own row in the canvas, so we add PER_SKILL_STEP per
// skill to keep a tall (many-skill) node from overlapping the one below it.
const BASE_STEP = 140;
const PER_SKILL_STEP = 30;

// Number of skills attached to a seeded instance — used only to size vertical spacing.
type SkillCount = (instanceName: string) => number;

// Lay out a vertical column of nodes at x:0, each node's y offset by the cumulative height
// of the nodes above it (taller when an instance carries skills). `human_review-1` becomes a
// human_review node; every other id becomes an agent node whose instance == its id.
function columnNodes(ids: string[], skillCount: SkillCount = () => 0): MaestroNodeV3[] {
  let y = BASE_STEP;
  return ids.map((id): MaestroNodeV3 => {
    const position = { x: 0, y };
    const node: MaestroNodeV3 =
      id === "human_review-1" ? { id, type: "human_review", position } : { id, type: "agent", instance: id, position };
    const skills = id === "human_review-1" ? 0 : skillCount(id);
    y += BASE_STEP + skills * PER_SKILL_STEP;
    return node;
  });
}

// Build a seeded workflow. `impl` is the implementation-agent chain inserted into the
// happy path (e.g. ["backend"], ["frontend"], or ["backend","frontend"] for fullstack).
//   kind "default": impl runs first — main-session → [impl] → human review → test → reviewer → scribe.
//     Reviewer/refactor code FAILs route to the impl agent(s); split per-agent when impl.length > 1.
//   kind "tdd": tests first — main-session → test → human review → [impl] → reviewer → scribe.
//     Code FAILs always route to @test (failures drive more tests), so impl never changes the conditions.
export function buildWorkflow(
  name: string,
  kind: "default" | "tdd",
  impl: string[],
  skillCount: SkillCount = () => 0
): MaestroWorkflowV3 {
  const column =
    kind === "tdd"
      ? ["test", "human_review-1", ...impl, "reviewer", "scribe"]
      : [...impl, "human_review-1", "test", "reviewer", "scribe"];
  const colNodes = columnNodes(column, skillCount);
  const reviewerY = colNodes.find((n) => n.id === "reviewer")?.position?.y ?? BASE_STEP;
  const nodes: MaestroNodeV3[] = [
    ...colNodes,
    { id: "refactor", type: "agent", instance: "refactor", position: { x: 360, y: reviewerY } },
  ];

  // Success chain: main-session through the whole happy-path column.
  const seq = ["main-session", ...column];
  const edges: MaestroEdgeV3[] = [];
  for (let i = 0; i < seq.length - 1; i++) edges.push(succ(seq[i], seq[i + 1]));

  const side = sideTracker(nodes);
  const c = (from: string, to: string, label: string) => cond(from, to, label, side(from, to));

  // Code-issue routes vary by workflow kind and impl-agent count.
  const reviewerCode: MaestroEdgeV3[] = [];
  const refactorCode: MaestroEdgeV3[] = [];
  if (kind === "tdd") {
    reviewerCode.push(c("reviewer", "test", "FAIL: style, data layer, error handling, security, or persistence"));
    refactorCode.push(c("refactor", "test", "finding requires code changes"));
  } else if (impl.length === 1) {
    reviewerCode.push(c("reviewer", impl[0], "FAIL: style, data layer, error handling, security, or persistence"));
    refactorCode.push(c("refactor", impl[0], "finding requires code changes"));
  } else {
    // Fullstack / multi-agent: split the code FAIL and code-change routes per impl agent.
    for (const a of impl) {
      reviewerCode.push(
        c("reviewer", a, `FAIL: ${a} code (style, data layer, error handling, security, or persistence)`)
      );
    }
    for (const a of impl) {
      refactorCode.push(c("refactor", a, `finding requires ${a} code changes`));
    }
  }

  edges.push(
    c("reviewer", "refactor", "FAIL: code pattern violation or code redundancy"),
    c("reviewer", "test", "FAIL: a test"),
    ...reviewerCode,
    c("refactor", "scribe", "finding is a recurring pattern an agent should know going forward"),
    ...refactorCode,
    c(
      "refactor",
      "reviewer",
      "triggered by reviewer on a systemic FAIL; notify when delegation is complete so it can re-review"
    )
  );

  // Human-review corrections route back to whoever produced the work under review,
  // so the responsible agent fixes it — not the main session. In the default flow the
  // implementation agent(s) precede human review, so corrections go to them (split
  // per-agent for fullstack). In tdd the human reviews the test plan before any impl
  // runs, so corrections route to @test.
  if (kind === "tdd") {
    edges.push(c("human_review-1", "test", "human requested test corrections"));
  } else if (impl.length === 1) {
    edges.push(c("human_review-1", impl[0], "human requested code corrections"));
  } else {
    for (const a of impl) edges.push(c("human_review-1", a, `human requested ${a} corrections`));
  }

  return placeConditionLabels({ name, nodes, edges }, skillCount);
}

// Build a simple linear happy-path workflow: main-session → each step in order, success edges only.
// Step ids: "human_review-1" → human_review node; "skill:<id>" → skill node (run inline by the
// orchestrator); anything else → an agent node whose instance == the id.
export function linearWorkflow(name: string, steps: string[], skillCount: SkillCount = () => 0): MaestroWorkflowV3 {
  let y = BASE_STEP;
  const nodes: MaestroNodeV3[] = steps.map((step): MaestroNodeV3 => {
    const position = { x: 0, y };
    let node: MaestroNodeV3;
    let skills = 0;
    if (step === "human_review-1") {
      node = { id: step, type: "human_review", position };
    } else if (step.startsWith("skill:")) {
      const skill = step.slice("skill:".length);
      node = { id: skill, type: "skill", skill, position };
    } else {
      node = { id: step, type: "agent", instance: step, position };
      skills = skillCount(step);
    }
    y += BASE_STEP + skills * PER_SKILL_STEP;
    return node;
  });
  const seq = ["main-session", ...nodes.map((n) => n.id)];
  const edges: MaestroEdgeV3[] = [];
  for (let i = 0; i < seq.length - 1; i++) edges.push(succ(seq[i], seq[i + 1]));
  return placeConditionLabels({ name, nodes, edges }, skillCount);
}

// "Tests" workflow: happy path @test → @reviewer → @scribe, plus two reviewer fix routes through
// the implementation agent(s), both of which re-run @test once the code changes land:
//   • simple fix: @reviewer → @<impl> directly;
//   • bigger finding: @reviewer → @refactor → @<impl> (delegate the refactor before re-testing).
// Splits per-agent when impl.length > 1 (fullstack).
export function buildTestsWorkflow(name: string, impl: string[], skillCount: SkillCount = () => 0): MaestroWorkflowV3 {
  const column = ["test", "reviewer", "scribe"];
  const colNodes = columnNodes(column, skillCount);
  const reviewerY = colNodes.find((n) => n.id === "reviewer")?.position?.y ?? BASE_STEP;
  // Side column: refactor on the reviewer's row, then the impl agent(s) stacked below it,
  // each offset by its own skill height so a tall impl node doesn't overlap the next.
  const sideNodes: MaestroNodeV3[] = [
    { id: "refactor", type: "agent", instance: "refactor", position: { x: 360, y: reviewerY } },
  ];
  let implY = reviewerY;
  for (const a of impl) {
    sideNodes.push({ id: a, type: "agent", instance: a, position: { x: 720, y: implY } });
    implY += BASE_STEP + skillCount(a) * PER_SKILL_STEP;
  }
  const nodes: MaestroNodeV3[] = [...colNodes, ...sideNodes];

  const seq = ["main-session", ...column];
  const edges: MaestroEdgeV3[] = [];
  for (let i = 0; i < seq.length - 1; i++) edges.push(succ(seq[i], seq[i + 1]));

  const side = sideTracker(nodes);
  const c = (from: string, to: string, label: string) => cond(from, to, label, side(from, to));

  // Bigger finding: reviewer delegates to refactor before the impl agent(s) re-do the code.
  edges.push(c("reviewer", "refactor", "FAIL: a finding big enough to delegate to the refactor agent"));

  if (impl.length === 1) {
    edges.push(c("reviewer", impl[0], "FAIL: a simple code fix found while testing"));
    edges.push(c("refactor", impl[0], "finding requires code changes"));
    edges.push(c(impl[0], "test", "fix applied; re-run the tests"));
  } else {
    for (const a of impl) edges.push(c("reviewer", a, `FAIL: a simple ${a} code fix found while testing`));
    for (const a of impl) edges.push(c("refactor", a, `finding requires ${a} code changes`));
    for (const a of impl) edges.push(c(a, "test", `${a} fix applied; re-run the tests`));
  }

  return placeConditionLabels({ name, nodes, edges }, skillCount);
}

// Best-fit project-skill → seeded-agent assignments discovered at install time by the
// maestro-install skill (one entry per agent the user checked skills for). Empty when no
// skills were found/selected.
export type SkillMap = Record<string, string[]>;

// The full set of agent names a seed for this impl chain will have instances for — the impl
// agent(s) plus the four CORE_INSTANCES. Exported so a skillMap builder (tags→SkillMap, or the
// terminal install's best-fit flow) has the same "which agents actually exist in this seed" answer
// `defaultV3Config` uses, rather than re-deriving `['test','reviewer','refactor','scribe']` itself.
export function seededAgentNames(implAgents: string[]): string[] {
  const impl = implAgents.length > 0 ? implAgents : ["backend"];
  return Array.from(new Set([...impl, "test", "reviewer", "refactor", "scribe"])).sort();
}

// Returned on first install (no maestro.json yet). Seeds the bundled agents as reusable
// instances and wires them into two ready-to-use workflows ("default" + "tdd") so the
// canvas isn't empty. `implAgents` is the repo-detected implementation agent chain in the
// happy path; falls back to ["backend"].
// `skillMap` attaches the install-time discovered project skills to their best-fit instance.
export function defaultV3Config(implAgents: string[], skillMap: SkillMap = {}): MaestroConfigV3 {
  const impl = implAgents.length > 0 ? implAgents : ["backend"];
  // Defensive: only attach skills to instances that actually exist in this seed.
  const skillsFor = (agent: string): string[] => Array.from(new Set(skillMap[agent] ?? [])).filter(Boolean);
  // Install-time discovered skills seed as referenced (the default mode); promote in the canvas.
  const instances: MaestroInstanceV3[] = [
    ...impl.map((a) => ({ name: a, agent: a, loaded_skills: [], referenced_skills: skillsFor(a) })),
    ...CORE_INSTANCES.map((i) => ({ ...i, referenced_skills: skillsFor(i.name) })),
  ];
  const agentsAvailable = seededAgentNames(impl);
  // skills_available = the always-present gate skill + every skill assigned to an instance.
  // skills_available = the always-present gate skill + every skill assigned to an instance.
  const skillsAvailable = Array.from(
    new Set(["use-design-check", ...instances.flatMap((i) => [...i.loaded_skills, ...i.referenced_skills])])
  );
  // Vertical spacing in the seeded layout grows with each instance's skill count.
  const skillCount: SkillCount = (name) => skillsFor(name).length;
  return {
    version: 3,
    agents_available: agentsAvailable,
    skills_available: skillsAvailable,
    workflow_instances: instances,
    workflows: [
      buildWorkflow("default", "default", impl, skillCount),
      buildWorkflow("tdd", "tdd", impl, skillCount),
      linearWorkflow("Refactor", ["skill:use-design-check", "human_review-1", "refactor"], skillCount),
      linearWorkflow("Documentation", ["scribe"], skillCount),
      linearWorkflow("Review", ["reviewer"], skillCount),
      buildTestsWorkflow("Tests", impl, skillCount),
    ],
    rules: [],
  };
}
