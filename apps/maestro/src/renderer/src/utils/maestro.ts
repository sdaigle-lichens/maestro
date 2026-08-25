// Client-side data access for the Maestro config.
//
// This module is what `createServerFn` used to be. The function names and call shapes are kept
// so the routes and canvas didn't have to change — but there is no server, no /tmp result file,
// and no bundle-splitting hazard: each function is a one-line IPC call, and every node import
// lives in the main process.

import type {
  MaestroConfigV3,
  MaestroInstanceV3,
  MaestroNodeV3,
  MaestroEdgeV3,
  MaestroWorkflowV3,
  MaestroRuleV3,
  DiscoveredDefinition,
  RepoDetection,
  SaveResult,
  SaveInput,
  TreeNode,
  ProjectRule,
} from "../../../shared/ipc";

export type {
  MaestroConfigV3,
  MaestroInstanceV3,
  MaestroNodeV3,
  MaestroEdgeV3,
  MaestroWorkflowV3,
  MaestroRuleV3,
  RepoDetection,
  SaveResult,
};

/** Kept as aliases so the left-pane components read the same as before. */
export type BundledAgent = DiscoveredDefinition;
export type ProjectSkill = DiscoveredDefinition;

export interface MaestroConfigResult {
  config: MaestroConfigV3;
  /**
   * Absolute path of the open project. Named `projectRoot`, not `cwd`: under Docker the app's
   * own cwd was /app and the project had to be recovered from a precompute file, which is the
   * confusion this rename retires.
   */
  projectRoot: string;
  /** True when `config` is the starter seed and nothing is on disk yet. */
  seeded: boolean;
  /** Why the seed picked the implementation agents it did. Null once a config exists on disk. */
  detection: RepoDetection | null;
  bundledAgents: BundledAgent[];
  projectSkills: ProjectSkill[];
}

export async function getMaestroConfig(): Promise<MaestroConfigResult> {
  const data = await window.maestro.data.workflows();
  return {
    config: data.config,
    projectRoot: data.projectRoot,
    seeded: data.seeded,
    detection: data.detection,
    bundledAgents: data.agents,
    projectSkills: data.skills,
  };
}

/**
 * Rebuild the starter config around the chain the user corrected the detection to. Writes
 * nothing — the project is still unconfigured until Save.
 */
export function reseedMaestroConfig(implAgents: string[]): Promise<MaestroConfigV3> {
  return window.maestro.data.reseed(implAgents);
}

export interface MaestroRulesResult extends MaestroConfigResult {
  tree: TreeNode[];
  availableRules: ProjectRule[];
  vibeRules: string[];
  /** False when the vibe-rules CLI isn't installed, so the UI can say so. */
  vibeRulesAvailable: boolean;
}

/**
 * Everything the /rules route needs, in ONE round trip. The web app made four separate
 * server-fn calls here — config, tree, rules, vibe-rules — three of which each re-walked the
 * project directory tree.
 */
export async function getRulesData(): Promise<MaestroRulesResult> {
  const d = await window.maestro.data.rules();
  return {
    config: d.config,
    projectRoot: d.projectRoot,
    seeded: d.seeded,
    // /rules seeds a BLANK config, not the starter graph, so there is no detected chain to explain.
    detection: null,
    bundledAgents: [],
    projectSkills: [],
    tree: d.tree,
    availableRules: d.projectRules,
    vibeRules: d.vibeRules,
    vibeRulesAvailable: d.vibeRulesAvailable,
  };
}

/**
 * Persist a slice. One call now does what took five steps and a Claude session before: merge +
 * write maestro.json, re-render the orchestrator's HANDOFFS table, and apply rule placements.
 * The returned SaveResult carries the rendered success paths and the rule summary so the toast
 * can report exactly what changed on disk.
 */
export function submitMaestroConfig({ data }: { data: SaveInput }): Promise<SaveResult> {
  return window.maestro.config.save(data);
}
