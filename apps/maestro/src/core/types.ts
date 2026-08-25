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

/** Ephemeral per-session state written to .claude/maestro_session.json. */
export interface MaestroSession {
  workflow: string | null;
  generated_instances: string[];
}
