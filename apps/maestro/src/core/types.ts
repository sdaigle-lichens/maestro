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
   * Per-route handoff-protocol overrides/sync records, keyed `"<sender>/<receiver>"`. Absent, or
   * missing an entry for a pair, means the project has no opinion about that route — the
   * SubagentStart hook and `handoff-resolution.ts` then fall back to the global default tier
   * (`handoff-defaults.ts`) and finally to the shipped seed (`handoff-seeds.ts`). See
   * `MaestroHandoffEntry` for what an entry means.
   */
  handoffs?: MaestroHandoffsSlice;
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
  /**
   * Which Project Tags catalog entries this project belongs to. Absent = none recorded yet
   * (pre-dates this field). Selected once at install (from repo-detection evidence, backend/
   * frontend/mobile only) and editable afterward from /maestro.
   */
  project_tags?: string[];
  /**
   * Which of the orchestrator's Step 1 gates this project runs. Absent means BOTH are off and
   * Step 1 is skipped entirely — the opt-in stance, not "preserve the historical behaviour". A
   * partial or non-boolean value resolves the same way, per field; `resolveGates` in `config.ts`
   * is the one reader, and `maestro-step1-gates.cjs` mirrors it for the runtime.
   */
  gates?: MaestroGates;
}

/**
 * State of a repo's concept-skill list — the skills whose frontmatter `metadata.type` is
 * `concept-skill`, which explain the project's core concepts.
 *
 * It lives in its OWN file, `<root>/.claude/concept-skills.json`, not on `maestro.json`: concept
 * skills are a plain `.claude/skills` convention and a repo can keep a reconciled list of them
 * without Maestro installed. See `concept-skills.ts`. `version` is `major.minor` — see `bumpMinor`;
 * `last_update` is the commit the list was last reconciled against, so `/update-concept-skills`
 * can diff forward from it instead of re-reading the whole repo.
 */
export interface MaestroConceptSkillsState {
  version: string;
  last_update: string;
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

export interface MaestroProjectTagsSlice {
  project_tags: string[];
}

/**
 * The orchestrator's Step 1 gates, one flag each. All four combinations are valid and none is
 * nested under another: the design check runs on its own perfectly well, and both off means
 * Step 1 is skipped. Read at invocation time by `maestro-step1-gates.cjs`, whose single line of
 * output is injected into the orchestrator skill body.
 */
export interface MaestroGates {
  confidence_check: boolean;
  use_code_architecture_design_check: boolean;
}

export interface MaestroGatesSlice {
  gates: MaestroGates;
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

/**
 * One route's handoff entry in the project's `handoffs` slice.
 *
 * `id` is the `"<sender>/<receiver>"` pair itself — unlike `MaestroReportEntry.id` there is no
 * indirection to a differently-named body, because the global store is one table keyed by the pair
 * (see `handoff-defaults.ts`'s header on why it does not copy the report store's second hop). It
 * is kept as a field anyway so the entry is self-describing when read out of the map.
 *
 * `syncedFrom` is absent for a hand-authored override (`saveProjectHandoffOverride` drops it) and
 * present when the project's copy was materialized from a global default — install/update sync's
 * staleness check reads it to decide materialize / refresh / skip-as-customized.
 */
export interface MaestroHandoffEntry {
  id: string;
  syncedFrom?: { version: number; hash: string };
}

/**
 * `<project>/.claude/maestro.json`'s `handoffs` slice: `"<sender>/<receiver>"` -> its entry.
 *
 * FLAT, not nested by sender: `decideSync` takes one `SyncTracking` per tracked thing, and the
 * thing here is a pair. Both ends are BARE agent names (`maestro:test` is `test`), matching the
 * ids `handoffRoutes()` produces and the `.claude/handoffs/<sender>/<receiver>.md` path.
 */
export type MaestroHandoffsSlice = Record<string, MaestroHandoffEntry>;

/**
 * Ephemeral per-session state written to .claude/maestro_session.json.
 *
 * `run_id` (`036`) is minted the first time this file is written in a session — see
 * `ensureSessionRunId` in `session-runtime.ts` — and stamped onto every channel file a subagent
 * writes. `SessionEnd` deletes this file, so the next run necessarily mints a different one; that
 * is the whole mechanism that keeps a channel delivery from being inlined into an unrelated,
 * later run as if it were fresh.
 */
export interface MaestroSession {
  workflow: string | null;
  generated_instances: string[];
  run_id?: string | null;
}
