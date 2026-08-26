// The Maestro v3 config model — the single source of truth persisted at
// <project>/.claude/maestro.json.
//
// Moved here from apps/ai-tools-manager/src/utils/maestro.ts so the desktop app's
// main process, its renderer, and the plugin's standalone hook scripts all describe
// the same shape. `success_path` is DERIVED (see ./success-path.ts) and is never a
// field on any of these types.

export interface MaestroInstanceV3 {
  name: string;
  agent: string;
  /** Skills the SubagentStart hook auto-loads (Skill tool) before the agent starts working. */
  loaded_skills: string[];
  /**
   * Skills surfaced to the agent as available — it loads one only if the task involves the
   * logic that skill describes. Defaults are referenced; promote to loaded in the canvas.
   */
  referenced_skills: string[];
}

export interface MaestroNodeV3 {
  id: string;
  type: "agent" | "human_review" | "skill";
  /** agent nodes only; references MaestroInstanceV3.name */
  instance?: string;
  /** skill nodes only; the skill id run inline by the orchestrator */
  skill?: string;
  position?: { x: number; y: number };
}

export interface MaestroEdgeV3 {
  from: string;
  to: string;
  kind: "success" | "condition";
  label?: string;
  label_offset?: { x: number; y: number };
  sourceHandle?: string;
  targetHandle?: string;
}

export interface MaestroWorkflowV3 {
  name: string;
  nodes: MaestroNodeV3[];
  edges: MaestroEdgeV3[];
}

export interface MaestroRuleV3 {
  id: string;
  scope?: "project";
  paths?: string[];
  /**
   * Origin of the rule, so the apply step knows what to do:
   * "project"    → MOVE the on-disk .claude/rules/<id>.md to the assigned directory;
   * "vibe-rules" → install via `vibe-rules load <id> claude-code -t <dir>/.claude/rules/<id>.md`.
   */
  source?: "project" | "vibe-rules";
}

export interface MaestroConfigV3 {
  version: 3;
  agents_available: string[];
  skills_available: string[];
  workflow_instances: MaestroInstanceV3[];
  workflows: MaestroWorkflowV3[];
  rules: MaestroRuleV3[];
  /**
   * Per-agent report overrides/sync records. Absent, or missing an entry for a given agent, means
   * that agent has no project-level opinion — the SubagentStart hook and `report-resolution.ts`
   * then fall back to the global default tier (`report-defaults.ts`), and finally to no report at
   * all. See `MaestroReportEntry` for what an entry means.
   */
  reports?: MaestroReportsSlice;
  /**
   * The plugin.json `version` of the maestro plugin the last time this project's runtime bundle
   * (the hook scripts under `.claude/scripts/`, their registration in `.claude/settings.json`, and
   * the orchestrator skill's managed regions) was installed or refreshed from it.
   *
   * The one machine-owned field on this file: `installRuntime()` / `maestro-install.js` stamp it on
   * every install/update, and it is the ONLY thing either writes here without being asked to — see
   * `install.ts`'s header. Absent on a project that predates this field, or that has never had its
   * runtime installed.
   */
  runtimeVersion?: string;
}

export interface MaestroWorkflowsSlice {
  agents_available: string[];
  skills_available: string[];
  workflow_instances: MaestroInstanceV3[];
  workflows: MaestroWorkflowV3[];
}

export interface MaestroRulesSlice {
  rules: MaestroRuleV3[];
}

/**
 * One agent's report entry in the project's `reports` slice.
 *
 * `id` is always the agent's own name when created by the `/agents` page (see that route) — the
 * indirection exists for the global tier's future reuse (a shared id across near-identical
 * agents), not for anything this slice's UI creates. `syncedFrom` is absent for a hand-authored
 * override (the user edited and saved from `/agents`) and present when the project's copy was
 * materialized from a global default — install/update sync's staleness check reads it to decide
 * materialize / refresh / skip-as-customized.
 */
export interface MaestroReportEntry {
  id: string;
  syncedFrom?: { version: number; hash: string };
}

/** `<project>/.claude/maestro.json`'s `reports` slice: agent name -> its report entry. */
export type MaestroReportsSlice = Record<string, MaestroReportEntry>;

/** Ephemeral per-session state written to .claude/maestro_session.json. */
export interface MaestroSession {
  workflow: string | null;
  generated_instances: string[];
}
