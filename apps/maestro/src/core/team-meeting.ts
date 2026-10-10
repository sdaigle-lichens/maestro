// Team meeting (`/maestro-team-meeting`) — the pure half: the participant brief, the proposal-file
// schema, conflict detection and the final tally.
//
// The meeting is hub-and-spoke. The main session (the moderator) spawns or resumes the project's
// real configured agents in parallel; each reads a common brief plus its own slice and writes ONE
// proposal file per round under `<session dir>/meeting/round-<n>/<agent>.json`. Agents never see
// each other's files except through the moderator, who runs a second round only for the agents
// whose proposals conflict. Everything here is pure — `plugins/maestro/scripts/maestro-team-meeting.cjs`
// does the filesystem work and hands the pieces in. Runtime enforcement (no HANDOFF routing, no
// channel delivery, writes confined to the meeting directory) is `meeting-mode.ts`'s, not this
// module's.

import { bareAgentName } from "./success-path.js";
import { workflowToSpec } from "./workflow-spec.js";
import type { MaestroConfigV3, MaestroInstanceV3 } from "./types.js";

// ── proposal schema ─────────────────────────────────────────────────────────

/** Every proposal kind, and the target prefix each one must use. */
export const PROPOSAL_KINDS: Readonly<Record<string, string>> = {
  "workflow.create": "workflow:",
  "workflow.update": "workflow:",
  "workflow.delete": "workflow:",
  "skill.create": "skill:",
  "skill.edit": "skill:",
  "skill.delete": "skill:",
  "skill.placement": "instance:",
  "agent.create": "agent:",
  "agent.edit": "agent:",
  "agent.delete": "agent:",
  "agent.tools": "agent:",
  "rule.edit": "rule:",
  "rule.delete": "rule:",
  "rule.to-agent": "rule:",
  "handoff.edit": "handoff:",
  "report.edit": "report:",
  "gate.change": "gates",
};

/**
 * Kinds the moderator applies without asking: both are reversible, local to one file or one
 * instance's skill lists, and change no agent's permissions or the workflow graph.
 */
export const AUTO_KINDS: readonly string[] = ["skill.placement", "handoff.edit"];

export type ProposalTier = "auto" | "approval" | "blocked";

export interface Proposal {
  id: string;
  kind: string;
  target: string;
  change: string;
  rationale: string;
  evidence: string;
}

export interface ProposalFile {
  agent: string;
  round: number;
  proposals: Proposal[];
  withdrawn: string[];
}

export interface ParseResult {
  file: ProposalFile | null;
  errors: string[];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

/**
 * Validate one round file's parsed JSON. A bad proposal is dropped with an error rather than
 * failing the whole file — one sloppy entry should not silence an agent's other proposals. The
 * file as a whole fails only when its `agent` is missing or disagrees with `expectedAgent` (the
 * filename), or `proposals` is not an array.
 */
export function parseProposalFile(raw: unknown, expectedAgent?: string, expectedRound?: number): ParseResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { file: null, errors: ["not a JSON object"] };
  const obj = raw as Record<string, unknown>;
  const agent = bareAgentName(str(obj.agent) || expectedAgent || "");
  if (!agent) return { file: null, errors: ['missing "agent"'] };
  if (expectedAgent && agent !== bareAgentName(expectedAgent)) {
    return { file: null, errors: [`"agent" is "${agent}" but the file belongs to "${bareAgentName(expectedAgent)}"`] };
  }
  if (!Array.isArray(obj.proposals)) return { file: null, errors: ['"proposals" must be an array'] };
  const round = typeof obj.round === "number" && obj.round > 0 ? obj.round : (expectedRound ?? 1);

  const proposals: Proposal[] = [];
  const seen = new Set<string>();
  obj.proposals.forEach((p, i) => {
    if (!p || typeof p !== "object") return void errors.push(`proposal #${i + 1}: not an object`);
    const v = p as Record<string, unknown>;
    let id = str(v.id) || `${agent}-${i + 1}`;
    if (!id.startsWith(`${agent}-`)) id = `${agent}-${id}`;
    const kind = str(v.kind);
    const target = str(v.target);
    const change = str(v.change);
    if (!(kind in PROPOSAL_KINDS)) return void errors.push(`${id}: unknown kind "${kind}"`);
    const prefix = PROPOSAL_KINDS[kind];
    if (prefix === "gates" ? target !== "gates" : !target.startsWith(prefix) || target.length === prefix.length) {
      return void errors.push(
        `${id}: target "${target}" must be ${prefix === "gates" ? '"gates"' : `"${prefix}<name>"`}`
      );
    }
    if (!change) return void errors.push(`${id}: empty "change"`);
    if (seen.has(id)) return void errors.push(`${id}: duplicate id`);
    seen.add(id);
    proposals.push({ id, kind, target, change, rationale: str(v.rationale), evidence: str(v.evidence) });
  });

  const withdrawn = Array.isArray(obj.withdrawn) ? obj.withdrawn.filter((w): w is string => typeof w === "string") : [];
  return { file: { agent, round, proposals, withdrawn }, errors };
}

/**
 * Each agent's CURRENT position: its latest round's file, minus anything it withdrew. A later
 * round replaces the earlier one wholesale for that agent — which is why the round-2 prompt asks
 * a participant to restate the proposals it keeps.
 */
export function currentPositions(files: ProposalFile[]): Map<string, Proposal[]> {
  const latest = new Map<string, ProposalFile>();
  for (const f of files) {
    const prev = latest.get(f.agent);
    if (!prev || f.round >= prev.round) latest.set(f.agent, f);
  }
  const out = new Map<string, Proposal[]>();
  for (const [agent, f] of latest) {
    const gone = new Set(f.withdrawn);
    out.set(
      agent,
      f.proposals.filter((p) => !gone.has(p.id))
    );
  }
  return out;
}

function sameChange(a: { kind: string; change: string }, b: { kind: string; change: string }): boolean {
  const norm = (s: string) => s.replace(/\s+/g, " ").trim().toLowerCase();
  return a.kind === b.kind && norm(a.change) === norm(b.change);
}

export interface Conflict {
  target: string;
  agents: string[];
  proposals: Array<{ agent: string; id: string; kind: string; change: string }>;
}

/**
 * Targets that two or more agents want to change in different ways. Proposals from the same agent
 * never conflict with each other, and identical proposals (same kind, same change text up to
 * whitespace and case) from several agents are agreement, not conflict.
 */
export function findConflicts(files: ProposalFile[]): Conflict[] {
  const byTarget = new Map<string, Array<{ agent: string; p: Proposal }>>();
  for (const [agent, proposals] of currentPositions(files)) {
    for (const p of proposals) {
      const list = byTarget.get(p.target) ?? [];
      list.push({ agent, p });
      byTarget.set(p.target, list);
    }
  }
  const conflicts: Conflict[] = [];
  for (const [target, list] of byTarget) {
    const agents = [...new Set(list.map((x) => x.agent))];
    if (agents.length < 2) continue;
    if (list.every((x) => sameChange(x.p, list[0].p))) continue;
    conflicts.push({
      target,
      agents,
      proposals: list.map((x) => ({ agent: x.agent, id: x.p.id, kind: x.p.kind, change: x.p.change })),
    });
  }
  return conflicts;
}

export function tierOf(kind: string): Exclude<ProposalTier, "blocked"> {
  return AUTO_KINDS.includes(kind) ? "auto" : "approval";
}

// ── tally ───────────────────────────────────────────────────────────────────

export type AgentTier = "project" | "user" | "plugin" | "unknown";

export interface TallyContext {
  /** Bare agent name -> where its definition lives. Plugin agents cannot be edited in place. */
  agentTiers: Record<string, AgentTier>;
  /** Rule ids listed in maestro.json's `rules` slice — owned by the app's /rules view. */
  configRuleIds: string[];
}

export interface TallyRow {
  id: string;
  agent: string;
  /** Other agents that proposed the identical change (merged into this row). */
  supporters: string[];
  kind: string;
  target: string;
  tier: ProposalTier;
  change: string;
  rationale: string;
  /** Why a row is blocked, or why an auto-kind row needs approval anyway. */
  note?: string;
}

function blockReason(p: Proposal, ctx: TallyContext): string | null {
  if (p.kind.startsWith("agent.") && p.kind !== "agent.create") {
    const name = bareAgentName(p.target.slice("agent:".length));
    if (ctx.agentTiers[name] === "plugin") {
      return `"${name}" is a plugin agent — fork it in the app's /agents view first, then re-run the meeting to edit the fork`;
    }
  }
  if (p.kind === "rule.delete" || p.kind === "rule.to-agent") {
    const id = p.target.slice("rule:".length);
    if (ctx.configRuleIds.includes(id)) {
      return `rule "${id}" is listed in maestro.json's rules — move or remove it in the app's /rules view`;
    }
  }
  return null;
}

/**
 * The decision list: every current proposal, identical ones merged, each with its tier. A target
 * still in conflict after the last round is never auto-applied — the user picks.
 */
export function tally(files: ProposalFile[], ctx: TallyContext): TallyRow[] {
  const conflicted = new Set(findConflicts(files).map((c) => c.target));
  const rows: TallyRow[] = [];
  const positions = [...currentPositions(files)].sort(([a], [b]) => a.localeCompare(b));
  for (const [agent, proposals] of positions) {
    for (const p of proposals) {
      const dup = rows.find((r) => r.target === p.target && sameChange(r, p));
      if (dup) {
        if (dup.agent !== agent && !dup.supporters.includes(agent)) dup.supporters.push(agent);
        continue;
      }
      const blocked = blockReason(p, ctx);
      let tier: ProposalTier = blocked ? "blocked" : tierOf(p.kind);
      let note = blocked ?? undefined;
      if (tier === "auto" && conflicted.has(p.target)) {
        tier = "approval";
        note = "agents still disagree on this target";
      }
      rows.push({
        id: p.id,
        agent,
        supporters: [],
        kind: p.kind,
        target: p.target,
        tier,
        change: p.change,
        rationale: p.rationale,
        ...(note ? { note } : {}),
      });
    }
  }
  return rows;
}

function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

/** `decision.md` — the moderator's single approval sheet. */
export function renderDecision(rows: TallyRow[], meta: { id: string; mode: string }): string {
  const L: string[] = [`# Team meeting ${meta.id} (${meta.mode}) — decisions`, ""];
  const section = (title: string, tier: ProposalTier, blurb: string) => {
    const list = rows.filter((r) => r.tier === tier);
    L.push(`## ${title} (${list.length})`, "", blurb, "");
    if (list.length === 0) return void L.push("_None._", "");
    L.push("| id | from | kind | target | change | note |", "|---|---|---|---|---|---|");
    for (const r of list) {
      const from = [r.agent, ...r.supporters].join(", ");
      L.push(`| ${r.id} | ${from} | ${r.kind} | ${cell(r.target)} | ${cell(r.change)} | ${cell(r.note ?? "")} |`);
    }
    L.push("");
  };
  section("Apply automatically", "auto", "Skill placement and handoff-template changes, applied without asking.");
  section("Needs approval", "approval", "Asked as one batch.");
  section("Needs a manual step first", "blocked", "Not applied; tell the user what to do.");
  return L.join("\n");
}

// ── brief ───────────────────────────────────────────────────────────────────

export interface BriefAgent {
  /** Bare agent name. */
  name: string;
  tier: AgentTier;
  /** Project-relative (or `~`-relative) path of its definition, when known. */
  path: string | null;
  /** The frontmatter `tools:` value, verbatim, or null when unrestricted. */
  tools: string | null;
}

export interface BriefRule {
  id: string;
  path: string;
  inConfig: boolean;
}

export interface BriefInput {
  cfg: MaestroConfigV3;
  meeting: { id: string; mode: string; dir: string };
  participants: string[];
  agents: BriefAgent[];
  rules: BriefRule[];
  /** Project-relative paths of `.claude/handoffs/<s>/<r>.md` files. */
  handoffFiles: string[];
  /** Project-relative paths of `.claude/reports/<id>.md` files. */
  reportFiles: string[];
  evidence: {
    digest: string | null;
    postmortemsLog: string | null;
    taskPostMortems: Array<{ file: string; text: string }>;
    /** `080`: markdown from `renderMetricsDigest` — recent runs as detail, totals as trends. */
    metrics?: string | null;
  };
}

function instancesOf(cfg: MaestroConfigV3, agent: string): Array<MaestroInstanceV3 & { workflows: string[] }> {
  return (cfg.workflow_instances ?? [])
    .filter((i) => bareAgentName(i.agent) === agent)
    .map((i) => ({
      ...i,
      workflows: (cfg.workflows ?? []).filter((w) => w.nodes.some((n) => n.instance === i.name)).map((w) => w.name),
    }));
}

/** Bare names of the agents placed on at least one workflow node. */
export function placedAgents(cfg: MaestroConfigV3): string[] {
  const placed = new Set((cfg.workflows ?? []).flatMap((w) => w.nodes.map((n) => n.instance).filter(Boolean)));
  return [
    ...new Set((cfg.workflow_instances ?? []).filter((i) => placed.has(i.name)).map((i) => bareAgentName(i.agent))),
  ].filter(Boolean);
}

const EVIDENCE_CLIP = 6000;

function clipTail(s: string, n: number): string {
  return s.length > n ? "…[earlier entries clipped]\n" + s.slice(s.length - n) : s;
}

/** `brief.md` — what every participant reads first. */
export function buildCommonBrief(input: BriefInput): string {
  const { cfg, meeting } = input;
  const L: string[] = [
    `# Maestro team meeting ${meeting.id} — ${meeting.mode}`,
    "",
    meeting.mode === "post-mortem"
      ? "Goal: look back at THIS session's workflow run and propose changes to the Maestro setup that would have made it " +
        "faster, cheaper (fewer Claude Code calls, smaller contexts) or need less human steering."
      : "Goal: review the project's Maestro setup and propose changes that make workflows run more fluidly — fewer " +
        "Claude Code calls, smaller agent contexts, less human steering — without losing quality.",
    "",
    `Participants: ${input.participants.join(", ")}. You are one of them; propose from your own role's point of view.`,
    "",
    "## Rules of the meeting",
    "",
    "- Propose, never apply. The moderator applies what the user approves.",
    `- Write exactly one file: \`${meeting.dir}/round-<n>/<your agent name>.json\` (the round number is in your prompt). ` +
      "Schema below. Nothing else may be written; Bash is for read-only checks only.",
    "- Every proposal needs evidence: a digest line, a log entry, a file and line, or a concrete reasoning step. " +
      "No evidence, no proposal.",
    "- Prefer few, high-value proposals. Zero proposals is a valid answer.",
    "",
    "## Proposal file",
    "",
    "```json",
    '{ "agent": "<you>", "round": 1, "proposals": [',
    '  { "id": "<you>-1", "kind": "skill.placement", "target": "instance:<instance>#<skill>",',
    '    "change": "move <skill> from loaded to referenced", "rationale": "…", "evidence": "…" }',
    '], "withdrawn": [] }',
    "```",
    "",
    "Kinds and targets:",
    "",
    "| kind | target |",
    "|---|---|",
    ...Object.entries(PROPOSAL_KINDS).map(
      ([k, prefix]) =>
        `| ${k} | ${prefix === "gates" ? "gates" : k === "skill.placement" ? "instance:<instance>#<skill>" : k === "handoff.edit" ? "handoff:<sender>/<receiver>" : `${prefix}<name>`} |`
    ),
    "",
    "`skill.placement` and `handoff.edit` are applied automatically; everything else goes to the user for approval. " +
      "Model and effort changes are out of scope for now.",
    "",
    "## Workflows",
    "",
  ];
  for (const wf of cfg.workflows ?? []) {
    const spec = workflowToSpec(wf, cfg.workflow_instances ?? []);
    L.push(`- **${spec.name}**: ${spec.steps.join(" → ") || "(no steps)"}`);
    for (const c of spec.conditions ?? []) L.push(`  - ${c.from} —${c.label}→ ${c.to}`);
  }
  const g = cfg.gates;
  L.push(
    "",
    `Step 1 gates: confidence_check=${g?.confidence_check === true}, design_check=${g?.use_code_architecture_design_check === true}. ` +
      `use_maestro_tasks=${cfg.use_maestro_tasks === true}.`,
    "",
    "## Agents",
    "",
    "| agent | tier | definition | tools |",
    "|---|---|---|---|"
  );
  for (const a of input.agents) {
    L.push(`| ${a.name} | ${a.tier} | ${a.path ?? "?"} | ${a.tools ?? "all"} |`);
  }
  L.push("", 'Plugin-tier agents cannot be edited in place — proposals to edit them are reported as "fork first".', "");

  L.push("## Rules", "");
  if (input.rules.length === 0) L.push("_No project rules._");
  for (const r of input.rules) {
    L.push(
      `- \`${r.id}\` — ${r.path}${r.inConfig ? " (listed in maestro.json; moving or deleting it is done in the app's /rules view)" : ""}`
    );
  }
  L.push("", "## Handoff templates and reports", "");
  L.push(input.handoffFiles.length ? input.handoffFiles.map((f) => `- ${f}`).join("\n") : "_No handoff templates._");
  L.push(input.reportFiles.length ? input.reportFiles.map((f) => `- ${f}`).join("\n") : "_No report overrides._");

  L.push("", "## Evidence", "");
  const ev = input.evidence;
  if (ev.digest) L.push("### This session's digest", "", ev.digest.trim(), "");
  if (ev.metrics) {
    L.push("### Run metrics across sessions (.claude/maestro-metrics/metrics.json)", "", ev.metrics.trim(), "");
  }
  if (ev.taskPostMortems.length > 0) {
    L.push("### Post-Mortem sections of open tasks", "");
    for (const t of ev.taskPostMortems) L.push(`From \`${t.file}\`:`, "", t.text.trim(), "");
  }
  if (ev.postmortemsLog)
    L.push("### postmortems.log (latest)", "", clipTail(ev.postmortemsLog.trim(), EVIDENCE_CLIP), "");
  if (!ev.digest && !ev.metrics && ev.taskPostMortems.length === 0 && !ev.postmortemsLog) {
    L.push("_No recorded evidence — base proposals on the configuration and files themselves._");
  }
  return L.join("\n");
}

/** `brief/<agent>.md` — the slice of the setup that is this agent's own. */
export function buildAgentBrief(input: BriefInput, agentName: string): string {
  const name = bareAgentName(agentName);
  const { cfg } = input;
  const a = input.agents.find((x) => x.name === name);
  const L: string[] = [`# Your slice — ${name}`, ""];
  L.push(`- Definition: ${a?.path ?? "(not found)"} (${a?.tier ?? "unknown"} tier)`);
  L.push(`- Tools: ${a?.tools ?? "all"}`);
  const report = cfg.reports?.[name];
  L.push(`- Report override: ${report ? `.claude/reports/${report.id}.md` : "none (global default or nothing)"}`);
  L.push("", "## Your instances", "");
  const inst = instancesOf(cfg, name);
  if (inst.length === 0) L.push("_Not placed on any workflow._");
  for (const i of inst) {
    L.push(`- **${i.name}** — in: ${i.workflows.join(", ") || "(unplaced)"}`);
    L.push(`  - loaded: ${i.loaded_skills.join(", ") || "(none)"}`);
    L.push(`  - referenced: ${i.referenced_skills.join(", ") || "(none)"}`);
  }
  const mine = input.handoffFiles.filter((f) => f.includes(`/handoffs/${name}/`) || f.endsWith(`/${name}.md`));
  L.push("", "## Handoff templates you send or receive", "");
  L.push(mine.length ? mine.map((f) => `- ${f}`).join("\n") : "_None._");
  L.push(
    "",
    "Look in particular at: skills you load but never needed (or needed but only had referenced), handoff payloads " +
      "that carried too much or too little, loop-backs and human-review stops that could be avoided, and tools you " +
      "have but should not (or lack)."
  );
  return L.join("\n");
}
