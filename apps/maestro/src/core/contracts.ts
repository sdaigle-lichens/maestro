// Every type that crosses a process boundary, in one dependency-free module.
//
// Why this is separate from the modules that produce these values: the desktop renderer needs
// the shapes, but must never pull in the code. `./index.js` re-exports fs and child_process; a
// renderer that imports a type from it drags all of that into its type graph (and, if anyone ever
// writes a value import by mistake, into its bundle). Importing from `./contracts.js` cannot do
// that — there is nothing here but interfaces.
//
// The two differ by one word in an import line, which is why the boundary is asserted rather than
// left to review: see the "src/core boundary" block in test/isolation.test.ts.
//
// The implementation modules import these back, so there is still exactly one definition of each.

export type {
  MaestroConfigV3,
  MaestroInstanceV3,
  MaestroNodeV3,
  MaestroEdgeV3,
  MaestroWorkflowV3,
  MaestroRuleV3,
  MaestroWorkflowsSlice,
  MaestroRulesSlice,
  MaestroProjectTagsSlice,
  MaestroReportEntry,
  MaestroReportsSlice,
  MaestroSession,
} from "./types.js";

import type { MaestroConfigV3 } from "./types.js";

/**
 * The sentinel value on either of a skill's two tag dimensions (see `DiscoveredDefinition` below)
 * meaning "matches regardless of the agent's own value on that dimension" — the same convention
 * `agent-project-tags.ts` already uses for an agent's own project tag.
 */
export const GLOBAL_TAG = "global";

/**
 * The agent avatar picker's part categories, bottom→top in the same order the layers composite in
 * (`body` first, `hat` last) — see `AVATAR_RENDER_ORDER` in the renderer's asset manifest, which
 * must stay in agreement with this order.
 *
 * A literal deliberate exception to "contracts.ts is interfaces only", same as `GLOBAL_TAG` above:
 * the renderer needs the actual array to render one row per category, not just the type.
 */
export const AVATAR_CATEGORIES = ["body", "head", "eyes", "hair", "torso", "legs", "feet", "hat"] as const;
export type AvatarCategory = (typeof AVATAR_CATEGORIES)[number];

/** body/head/eyes are always rendered (never "none"); the rest may be null. */
export const AVATAR_REQUIRED_CATEGORIES: readonly AvatarCategory[] = ["body", "head", "eyes"];

export interface AvatarPartOption {
  id: string;
  name: string;
}

/**
 * Every option per category. Must match the filenames under
 * `src/renderer/src/assets/avatar/<category>/<id>.png` exactly — `test/core/avatar-parity.test.ts`
 * pins this against the renderer's asset manifest. Three exceptions — `torso`, `legs`, `feet` —
 * whose options are body-variant-aware (male/female cuts of the same garment) rather than one
 * file per id; see `manifest.ts`'s `BODY_VARIANT_CATEGORIES`/`resolveAvatarUrl`. `hat` is NOT
 * variant-aware: the upstream pack only ever cut one `adult` size for it.
 *
 * No "Child" body/head option: measured by compositing (see the session that added this comment) —
 * every worn item and the eye layer are cropped and positioned for an ADULT frame, so pairing them
 * with the child body/head produces severe, not cosmetic, misalignment (oversized torso floating
 * off the shoulders, eyes rendering down near the chin). The upstream LPC pack has no child-sized
 * cut for any of those layers, so there is no fix short of dropping the option.
 */
export const AVATAR_PARTS: Record<AvatarCategory, AvatarPartOption[]> = {
  body: [
    { id: "male", name: "Male" },
    { id: "female", name: "Female" },
  ],
  head: [
    { id: "male", name: "Male" },
    { id: "female", name: "Female" },
  ],
  eyes: [
    { id: "brows", name: "Brows" },
    { id: "cyclops", name: "Cyclops" },
    { id: "cyclops2", name: "Cyclops (alt)" },
  ],
  hair: [
    { id: "plain", name: "Plain" },
    { id: "bangslong", name: "Long Bangs" },
    { id: "bob", name: "Bob" },
    { id: "buzzcut", name: "Buzzcut" },
    { id: "dreadlocks_short", name: "Short Dreadlocks" },
  ],
  torso: [
    { id: "tshirt", name: "T-Shirt" },
    { id: "tshirt_buttoned", name: "Buttoned Shirt" },
    { id: "leather_armour", name: "Leather Armor" },
    { id: "plate_armour", name: "Plate Armor" },
  ],
  legs: [
    { id: "pants", name: "Pants" },
    { id: "shorts", name: "Shorts" },
    { id: "skirt_plain", name: "Plain Skirt" },
    { id: "skirt_legion", name: "Legion Skirt" },
  ],
  feet: [
    { id: "shoes_basic", name: "Shoes" },
    { id: "boots_basic", name: "Boots" },
    { id: "sandals", name: "Sandals" },
    { id: "shoes_ghillies", name: "Ghillie Shoes" },
  ],
  hat: [
    { id: "bandana", name: "Bandana" },
    { id: "bowler", name: "Bowler Hat" },
    { id: "crown", name: "Crown" },
    { id: "barbarian_helmet", name: "Barbarian Helmet" },
  ],
};

/** One id per category, or null for an optional category left empty. */
export type AvatarLayers = Record<AvatarCategory, string | null>;

/**
 * Where an agent/skill was discovered: "project", "user" (global ~/.claude), the bundled
 * Maestro plugin, or an installed plugin's name.
 */
export interface DiscoveredDefinition {
  id: string;
  description: string;
  source: string;
  /**
   * Which Project Tags catalog entries this skill applies to, plus `GLOBAL_TAG` for "regardless
   * of project tag". Always present (empty when untagged, which matches no agent); only skills
   * carry real values today, though the type is shared with `discoverAgents`.
   *
   * Matched against a seeded agent INSTANCE's own stored project tag (`agent-project-tags.ts`),
   * not the project's raw selected `project_tags` list — see `skillMapFromTags` in `skill-tags.ts`.
   */
  projectTags: string[];
  /**
   * Which `AGENT_TYPES` this skill applies to, plus `GLOBAL_TAG` for "regardless of agent type".
   * Matched against a seeded agent instance's own stored type (`agent-types.ts`).
   */
  agentTypes: string[];
}

/**
 * What's in effect for one agent, as resolved by `report-resolution.ts` — the /agents page's
 * right pane renders this directly, and it is exactly what a subagent run through Maestro would
 * receive (the SubagentStart hook resolves the same way, independently, in plain JS).
 */
export interface ResolvedReport {
  source: "project" | "global" | "none";
  /** Empty string for "none" — the editor's resting state, never null on the wire. */
  content: string;
}

/**
 * What writing an agent's `description` back into its own definition file did — see
 * `agent-descriptions.ts`. `file` and `source` are echoed so the page can say WHICH file it
 * changed: an agent's description is not stored beside the app like its type or avatar, it is the
 * frontmatter line Claude Code itself reads.
 */
export interface AgentDescriptionResult {
  description: string;
  file: string;
  source: string;
}

/**
 * The `DiscoveredDefinition.source` tiers whose agent files this app will write a description
 * into: the project's own `.claude/agents/`. Every other tier is a file this app does not own —
 * `user` (`~/.claude/agents/`) belongs to no project and is shared by every project on the
 * machine, `maestro` is this repo's bundled agents (in a packaged build, read-only resources
 * inside `app.asar`), and an installed plugin's agents live in a version-keyed marketplace cache
 * the next update overwrites. All three are un-editable for the same underlying reason — an edit
 * would be silently discarded or silently shared — which is why forking (`agent-fork.ts`) exists:
 * it turns "you can't edit this" into "here is a project copy you can".
 *
 * A literal deliberate exception to "contracts.ts is interfaces only", same as `GLOBAL_TAG`: the
 * /agents page decides whether to render an editable description from the agent's `source` alone,
 * with no round trip.
 */
export const EDITABLE_AGENT_SOURCES: readonly string[] = ["project"];

export function isEditableAgentSource(source: string): boolean {
  return EDITABLE_AGENT_SOURCES.includes(source);
}

/**
 * What forking one agent into the open project wrote — see `src/core/agent-fork.ts`. `name` is
 * the resolved (possibly renamed) agent id, echoed back because a caller cannot otherwise learn
 * what a same-name fork request actually landed as if the target already existed under a
 * different casing, etc. — same discipline as `ScaffoldResult.name`.
 */
export interface AgentForkResult {
  name: string;
  file: string;
}

/**
 * Where a forked agent's template came from, and enough of it to sync or diff against later
 * (`031`). Written to a project-local sidecar (`agent-fork.ts`'s `agent-forks.json`), never into
 * the forked agent's own frontmatter — Maestro's own bookkeeping does not belong in a file Claude
 * Code itself reads, the same argument `EDITABLE_AGENT_SOURCES` makes about descriptions.
 *
 * `sourceTier` is `"user"` (machine-wide, no plugin) or `"plugin"` (bundled Maestro or an
 * installed marketplace plugin); `sourcePlugin` names which plugin for the latter and is null for
 * `"user"`. `templateBodyHash` is over the template's body with its `description:` frontmatter
 * line normalised out — see `hashAgentBody` — because a description is expected to diverge the
 * moment someone edits it, and hashing the whole file would mark every fork as modified on the
 * first edit of the one field this app itself lets you change.
 */
export interface AgentForkRecord {
  agentName: string;
  sourceTier: "user" | "plugin";
  sourcePlugin: string | null;
  pluginVersion: string | null;
  templateBodyHash: string;
  templateBody: string;
  forkedAt: string;
}

/**
 * One row in the global report-defaults store (`report-defaults.ts`) — the fallback tier
 * `/agents` falls back to when an agent has no project override, and what the `/templates` page's
 * Reports tab edits directly. `version` is what `report-sync.ts` compares against a project's
 * `syncedFrom.version` to decide whether install/update needs to refresh a stale project copy.
 */
export interface ReportDefault {
  reportId: string;
  content: string;
  version: number;
}

/**
 * The closed set of agent-type tags the `/templates` page's Agent Types tab assigns one of to each
 * agent, backed by `agent-types.ts`'s own global sqlite store — singular per agent (an agent has
 * exactly one type, not a set), unlike a skill's `agentTypes` dimension, which may hold several
 * plus `GLOBAL_TAG`.
 *
 * A literal deliberate exception to "contracts.ts is interfaces only", same as `GLOBAL_TAG`: the
 * renderer needs the actual array to render one Select option per type, not just the type.
 */
export const AGENT_TYPES = ["developer", "planner", "reviewer", "annotator", "tester"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export interface ProjectRule {
  id: string;
  description: string;
  body: string;
  /** Project-relative dir whose .claude/rules holds this file; "" = project root. */
  dir: string;
}

export interface TreeNode {
  /** Relative to the project root. */
  path: string;
  name: string;
  depth: number;
}

export type TaskStatus = "done" | "ready" | "blocked";

export interface MaestroTask {
  filename: string;
  /** Project-relative path — what the copy-prompt tells Claude Code to implement. */
  relativePath: string;
  title: string;
  blockedBy: string[];
  status: TaskStatus;
  content: string;
}

export interface SessionLogEntry {
  ts: string;
  origin: string;
  log: string;
  /** Set on dispatch/handoff entries written by maestro-subagent-log.js. */
  kind?: "dispatch" | "handoff" | "transition";
  /** dispatch: the subagent's agent_type */
  agent?: string;
  /** shared key linking a dispatch↔handoff pair */
  agent_id?: string;
  /** dispatch only: full spawning message (main session → agent) */
  input?: string;
  /** dispatch only: skills the SubagentStart hook surfaced */
  offered_skills?: { loaded: string[]; referenced: string[] };
  /** handoff only */
  status?: "success" | "condition" | "unknown";
  /** handoff only */
  label?: string | null;
  /** handoff only: full final message (agent → main session) */
  output?: string;
}

export interface RenderResult {
  ok: boolean;
  reason?: "maestro.json not found" | "maestro/SKILL.md not found";
  rows: Array<{ workflow: string; successPath: string }>;
}

export interface ApplyRulesSummary {
  moved: Array<{ id: string; from: string; to: string }>;
  installed: Array<{ id: string; dir: string }>;
  unchanged: Array<{ id: string; dir: string }>;
  skipped: Array<{ id: string; dir: string; reason: string }>;
  /** Project rules whose file wasn't found anywhere in the tree. */
  missing: string[];
  errors: Array<{ id: string; error: string }>;
}

/**
 * What the repo looks like it is, and why — the seed for an unconfigured project's happy path.
 *
 * `evidence` is the half that makes this usable. The heuristic is occasionally wrong; a user shown
 * "`react`, `express` in package.json → …" can see *why* it was wrong and correct the chain before
 * saving. The same result with no evidence would just be an unexplained choice to trust.
 */
export interface RepoDetection {
  /** The implementation-agent chain, in happy-path order. Never empty. */
  implAgents: string[];
  /** Human-readable lines naming what matched, e.g. "`react-dom` in package.json → frontend". */
  evidence: string[];
  /** Nothing matched: `implAgents` is the safe default rather than a conclusion about this repo. */
  fallback: boolean;
}

/** What installing the orchestrator skill did to an existing file. All four are load-bearing. */
export type OrchestratorSkillAction = "installed" | "synced" | "unchanged" | "migrated";

/**
 * Whether Maestro's runtime half is wired into the open project, and whether it matches what the
 * app ships.
 *
 * Staleness is decided by CONTENT, never by mtime: `installedRuntimeId` and `shippedRuntimeId`
 * are sha-256 digests over the runtime files themselves, so two checkouts of the same commit
 * agree and a `git clone` (which rewrites every mtime) doesn't spuriously report an update.
 */
export interface InstallStatus {
  projectRoot: string;
  /** The orchestrator skill and the copied scripts directory both exist. */
  installed: boolean;
  orchestratorSkill: boolean;
  scriptsDir: boolean;
  configFile: boolean;
  /** The installed SKILL.md's plugin-owned regions differ from the template the app ships. */
  orchestratorSkillOutOfDate: boolean;
  /** Project-relative paths of runtime files that are absent / differ from the shipped copy. */
  scriptsMissing: string[];
  scriptsOutOfDate: string[];
  /** Hook ids (`<Event>:<script>`) registered in the project's settings, and those still absent. */
  hooksRegistered: string[];
  hooksMissing: string[];
  /** Digest of the runtime the app ships vs. the copy in the project. Equal ⇒ files are current. */
  shippedRuntimeId: string;
  installedRuntimeId: string;
  /** Installed, but something is missing or older than what the app ships. */
  stale: boolean;
  /** `.claude/settings.json` exists but is not valid JSON — install would refuse to touch it. */
  settingsUnreadable: boolean;
}

/**
 * What the report sync step (install/update) did to the project's `.claude/reports/` copies,
 * keyed by outcome rather than by agent — each agent name appears in exactly one list.
 */
export interface ReportSyncSummary {
  materialized: string[];
  refreshed: string[];
  /** Diverged from its last synced content — left alone on disk, surfaced so the user knows why. */
  staleCustomized: string[];
  unchanged: string[];
}

/** What an install actually changed on disk. */
export interface InstallReport {
  projectRoot: string;
  orchestratorSkill: {
    action: OrchestratorSkillAction;
    /** Plugin-owned regions re-synced from the template (`action: "synced"`). */
    regions: string[];
    /** Where the pre-managed-regions body was kept (`action: "migrated"`). */
    backup: string | null;
  };
  /** Project-relative paths of runtime files written (absent or differing before). */
  scriptsWritten: string[];
  /** Hook ids added to the project's `.claude/settings.json`. */
  hooksAdded: string[];
  gitignoreUpdated: boolean;
  /** The plugin.json version this run stamped into `maestro.json`'s `runtimeVersion`. */
  runtimeVersion: string;
  /** `runtimeVersion` changed on this run — the project was stamped with an older version or none. */
  runtimeVersionUpdated: boolean;
  /**
   * Set on a first install (no `maestro.json` yet), when this run seeded one — the detected
   * implementation-agent chain and the project tags matched against the live catalog. `null` on
   * every re-install: an existing config is the user's own and is never re-seeded.
   */
  configSeeded: { implAgents: string[]; projectTags: string[] } | null;
  /** True when the run found nothing to do — the idempotent second run. */
  unchanged: boolean;
  warnings: string[];
  /** Recomputed after the writes, so the caller can refresh its badge without a second call. */
  status: InstallStatus;
  /** What the report sync step did — materialized/refreshed/flagged-as-customized/unchanged. */
  reportsSync: ReportSyncSummary;
}

/**
 * What's in the file-based task queue at `.claude/maestro-tasks/` (written by `/to-maestro-tasks`)
 * right now — reported at every level, but actionable only at purge: it's user-authored, often
 * git-tracked content, not an install artifact, so deleting it needs its own explicit opt-in
 * (`deleteMaestroTasks`) on top of `purge` rather than riding along with the rest of the purge list.
 */
export interface MaestroTasksFinding {
  /** Project-relative path to the queue directory, e.g. `.claude/maestro-tasks`. */
  dir: string;
  /** Task prompt filenames (`NNN-*.md`) found in the queue, sorted. Empty if the dir is absent. */
  files: string[];
  /** `status.json` exists — the tracker has been synced at least once. */
  hasStatusJson: boolean;
}

/**
 * What each level of an uninstall would remove from the project, as it stands right now.
 *
 * This exists so the UI can NAME the files before it deletes them. "Are you sure?" is not informed
 * consent when `.claude/maestro.json` — hand-authored workflow and rule configuration — is on the
 * list, so the confirmation renders `purgeFiles` verbatim.
 */
export interface UninstallPlan {
  projectRoot: string;
  /** Hook ids (`<Event>:<script>`) currently registered that a default uninstall would remove. */
  hooks: string[];
  /** Project-relative paths of the ephemeral session files that exist right now. */
  sessionFiles: string[];
  /** `agent: "maestro"`, left in settings.json by installs that predate the hook registration. */
  legacyAgentSetting: boolean;
  /**
   * Project-relative paths a purge would delete ON TOP of the default — the orchestrator skill,
   * the copied runtime scripts, the installed handoff protocols, and `maestro.json`. Only paths
   * that exist are listed, so the confirmation never names a file the user doesn't have. Deliberately
   * excludes `.claude/maestro-tasks/` — see `maestroTasks` below.
   */
  purgeFiles: string[];
  /** True when `maestro.json` exists — i.e. when purge has something irreplaceable to delete. */
  purgeRemovesConfig: boolean;
  /** The file-based task queue, reported separately from `purgeFiles` — see `MaestroTasksFinding`. */
  maestroTasks: MaestroTasksFinding;
  /** Neither level has anything to do: uninstalling would be a no-op. */
  empty: boolean;
  /** `.claude/settings.json` exists but is not valid JSON — uninstall would refuse to touch it. */
  settingsUnreadable: boolean;
}

/** What an uninstall actually removed from disk. */
export interface UninstallReport {
  projectRoot: string;
  /** Which level ran. `false` is the default and never deletes `maestro.json`. */
  purge: boolean;
  /** Hook ids removed from the project's `.claude/settings.json`. */
  hooksRemoved: string[];
  /** Project-relative paths of the ephemeral session files deleted. */
  sessionFilesRemoved: string[];
  legacyAgentSettingRemoved: boolean;
  /** Project-relative paths deleted by a purge — empty on a default uninstall. */
  purged: string[];
  /**
   * `.claude/maestro-tasks/` was deleted. Only ever true when both `purge` and the request's
   * `deleteMaestroTasks` were true — see `MaestroTasksFinding`.
   */
  maestroTasksDeleted: boolean;
  /** Directories left empty by the deletions and pruned. Never `.claude` itself. */
  dirsPruned: string[];
  /**
   * `.claude/maestro.json` is still on disk. Always true after a default uninstall of a project
   * that had one — the whole point of the two levels.
   */
  configKept: boolean;
  /** There was nothing installed to remove. Nothing was written; this is not an error. */
  noop: boolean;
  warnings: string[];
  /** Recomputed after the deletions, so the caller can refresh its badge without a second call. */
  status: InstallStatus;
}

/** A local plugin marketplace the create forms can write into, and what it already holds. */
export interface MarketplaceEntry {
  name: string;
  /** Absolute path of the marketplace repo on this machine. */
  path: string;
  /** Plugin names listed in its `.claude-plugin/marketplace.json`. */
  plugins: string[];
  /**
   * Its owner, which a new plugin inherits as its `author`.
   *
   * Carried so the plugin form can PREVIEW the author it is about to write. The form never asks
   * for one — the honest answer already sits in the marketplace's manifest — and a field the user
   * cannot predict is exactly the kind the preview has to show.
   */
  owner: { name: string; email: string } | null;
}

/** What a create route needs to populate its selectors: the marketplaces, and where they are. */
export interface CreateOptions {
  marketplaces: MarketplaceEntry[];
  /** The open project's root, or "" — where `target: "project"` writes. */
  projectRoot: string;
  /**
   * Every agent this machine can currently see — `/create-subagent`'s Template field seeds a new
   * form from one of these. Restricted to `target: "project"` on the FORM side (not filtered out
   * of this list): forking a third-party plugin's agent into your own plugin would be republishing
   * someone else's work, but the same list is exactly what `target: "project"` legitimately wants
   * to offer.
   */
  agentTemplates: DiscoveredDefinition[];
}

/**
 * One create-* form's answers, as they cross the process boundary.
 *
 * Note what is NOT on these: a destination path. `target: "project"` means the open project, which
 * only the main process knows, and `marketplace` is a NAME the user picked out of a list main
 * produced — main turns it back into a path. So the renderer describes an artifact; it never
 * nominates a directory to write in. The one exception is `create-marketplace.targetDir`, which is
 * the whole point of that form (the user is choosing where a brand-new marketplace goes) and is
 * validated as an absolute path and shown in the confirmation before anything is written.
 */
export type CreateSkillRequest = {
  kind: "create-skill";
  /** auto: Claude authors the body afterwards. manual: the skeleton is the finished artifact. */
  mode: "auto" | "manual";
  target: "marketplace" | "project";
  /** Blank derives one from `idea`, deterministically — a directory name cannot wait for a model. */
  name: string;
  /** The idea (auto) or the description (manual). */
  idea: string;
  useWhen: string[];
  marketplace: string;
  plugin: string;
};

export type CreateSubagentRequest = {
  kind: "create-subagent";
  mode: "auto" | "manual";
  target: "marketplace" | "project";
  name: string;
  idea: string;
  description: string;
  triggers: string[];
  tools: string[];
  marketplace: string;
  plugin: string;
};

export type CreatePluginRequest = {
  kind: "create-plugin";
  name: string;
  description: string;
  keywords: string[];
  marketplace: string;
};

export type CreateMarketplaceRequest = {
  kind: "create-marketplace";
  name: string;
  description: string;
  ownerName: string;
  ownerEmail: string;
  homepage: string;
  /** Absolute path of the directory to become the marketplace. */
  targetDir: string;
  privateRepo: boolean;
};

export type CreateRequest = CreateSkillRequest | CreateSubagentRequest | CreatePluginRequest | CreateMarketplaceRequest;

/**
 * Update every project skill's description/tags in one pass — the `/skills` page's "Update skill
 * tags" button. No fields: unlike a create-* form, there is nothing for the renderer to submit —
 * the set of skills to work on is discovered from the open project, not chosen on screen.
 */
export type UpdateSkillTagsRequest = { kind: "update-skill-tags" };

/**
 * What the deterministic scaffold wrote — no model involved in any of it.
 *
 * `scaffolded: false` is not a half-success: a failed scaffold leaves the disk exactly as it was
 * (see `scaffold.ts`), and `reason` is what to tell the user. The web app's third state — "the
 * target is outside the Docker mount, let Claude create it host-side" — is gone with the container;
 * every path on the host is reachable, so a failure here is a real failure.
 */
export interface ScaffoldResult {
  scaffolded: boolean;
  /**
   * The kebab-case name the artifact was actually created under.
   *
   * Worth returning because it is not always the one the form holds: a blank name is derived from
   * the idea, and the user has no other way to learn what it became.
   */
  name: string;
  /** Absolute path of the primary artifact: the file for a skill/agent, the directory otherwise. */
  path: string;
  /** Every file created, absolute. Empty when `scaffolded` is false. */
  written: string[];
  /** What is left for a model to do, in prose. "" when the artifact is already complete. */
  remaining: string;
  /**
   * `remaining` needs a model, so the route offers the bridge straight away rather than waiting to
   * be asked. False for a manual skeleton or a plugin manifest, which are finished as written.
   */
  needsModel: boolean;
  /** Why nothing was written. Set only when `scaffolded` is false. */
  reason?: string;
  /**
   * What became of the artifact's git repository. Present only for the flows that make one — a
   * skill or a plugin is written INTO a repository somebody else already owns.
   */
  repo?: RepoResult;
}

/**
 * Whether the scaffold left a repository behind, and what to tell the user either way.
 *
 * There is always something to say. A repository was created, or the directory already sat inside
 * one, or `git` is not on this machine — and the last two are not failures: the marketplace on disk
 * is complete and usable in all three, which is why this is a field on a successful result rather
 * than a reason on a failed one.
 */
export interface RepoResult {
  /** True when THIS scaffold ran `git init` and committed what it wrote. */
  initialized: boolean;
  /** The repository: the one created, or the one the directory turned out to be inside. */
  root: string | null;
  /** Plain-English account — what happened, or why nothing did. Always worth showing. */
  note: string;
}

/**
 * Making a directory a git repository — the one scaffold step `fs` alone cannot do.
 *
 * It is a PORT the caller supplies rather than an import, and that is not ceremony.
 * `claude-preview.ts` imports `scaffold.ts` for `resolveCreateTarget`, and
 * `test/core/claude.test.ts` walks the preview's import graph to prove it cannot start a process.
 * A `child_process` import inside the scaffold's graph would take that guarantee away for a
 * capability the preview never uses. So the composition root (`src/main/ipc.ts`) hands the scaffold
 * a `nodeGit()` from `src/core/git.ts`, and the scaffold stays a pure function of the form, the
 * filesystem and this interface.
 */
export interface GitPort {
  /** Whether the `git` binary is here at all, and where it was looked for. Never spawns. */
  availability(): { available: boolean; reason: string };
  /** `git init` in `dir`; returns the `.git` it created, so a rollback has a handle on it. */
  init(dir: string): string;
  /** Stage everything under `dir` and make the first commit. Throws git's own message on failure. */
  commit(dir: string, message: string, author: { name: string; email: string }): void;
}

/**
 * What the user is asking Claude to do, as a shape the MAIN process knows how to turn into a
 * prompt — never the prompt itself.
 *
 * This is the reason the bridge is safe. If the renderer handed over prompt text, the set of
 * prompts the app can execute would be "any string a renderer bug can produce". Because it hands
 * over a request, the set is the small, enumerable list of things this union can express, and every
 * member of it is built by code in `claude-preview.ts` that a reviewer can read end to end.
 *
 * The four `create-*` kinds are here because those routes went through the bridge rather than
 * growing a spawn of their own: each is a prompt builder and an entry in the preview's `targets`,
 * and each names the artifact the deterministic scaffold has ALREADY written, so the run's job is
 * finishing a file rather than creating one.
 *
 * `help-chat` USED TO BE HERE, and its deletion is the shape of this union's rule rather than an
 * exception to it. The chat had no session, so every question re-sent a capped copy of the
 * transcript as prompt text; the live session pane holds the conversation instead, and a second
 * conversational surface would have meant two transcripts and two consent models. The pane does
 * not go through this union at all — a turn there is user-typed text on `session:say`, not a
 * request main builds a prompt from. See `SessionEvent` below.
 */
export type ClaudeRequest =
  | {
      kind: "maestro-task";
      /** Basename of a file in `.claude/maestro-tasks/`. Resolved and existence-checked by preview. */
      filename: string;
    }
  | CreateRequest
  | UpdateSkillTagsRequest;

/** A path the run may write, and how. Shown in the confirmation before anything is spawned. */
export interface ClaudeWriteTarget {
  /** Absolute path. A directory means "somewhere under here". */
  path: string;
  action: "create" | "modify" | "unknown";
  /** Why it's uncertain, when it is — the modal renders this verbatim rather than guessing. */
  note?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// What a run can READ — the larger half of the disclosure, and the quieter one.
//
// Writes announce themselves: a create-* prompt names its file, the list below is on screen, and
// the session's permission callback allows nothing outside it. Reads announce nothing: file reads
// and searches are auto-approved by the permission system and never raise a prompt, so the
// directory list a session is started with
// IS the bound on what the model can see — and it is fully known before anything spawns.
//
// The types below exist so the confirmation can state that bound *truthfully*. The effective
// configuration of a session is not what the app passes: it is the app's arguments merged with the
// settings files on disk, which can add readable directories and permission rules the app never
// chose. So the disclosure is built from a real resolution of those files (`SettingsPort`), and
// every value carries where it came from rather than being flattened into one confident list.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A tier of Claude Code's settings cascade, in the CLI's own vocabulary.
 *
 * `user` (~/.claude/settings.json), `project` (.claude/settings.json, committed), `local`
 * (.claude/settings.local.json, ignored), `managed` (the admin policy tier) and `flag` (a
 * `--settings` file). Listed low→high precedence wherever a list of these appears.
 */
export type SettingsTier = "user" | "project" | "local" | "managed" | "flag";

/** The permission-bearing slice of a settings file — the only part this disclosure is about. */
export interface SettingsPermissions {
  /** `permissions.additionalDirectories` — trees a session may read beyond its working directory. */
  additionalDirectories: string[];
  allow: string[];
  deny: string[];
  ask: string[];
  /** `permissions.defaultMode`, or null when the tier does not set one. */
  defaultMode: string | null;
}

/** One tier of the cascade: where its file is, and what it holds. */
export interface SettingsSourceInfo {
  tier: SettingsTier;
  /** Absolute path of the file, when the tier has one on disk. Null for computed tiers. */
  path: string | null;
  /** Raw, as written in that file — NOT merged. Attribution is done against these. */
  permissions: SettingsPermissions;
}

/**
 * The effective settings a run would see, plus every tier that contributed to them.
 *
 * `effective` is the merge engine's own answer and is what the run actually gets; `sources` is what
 * each file said, and is how a value in `effective` is attributed to a file. Reported separately
 * on purpose: recomputing the merge here to work out provenance would make this a second, drifting
 * implementation of a cascade the CLI already owns.
 */
export interface EffectiveSettingsSnapshot {
  /** Low→high precedence. */
  sources: SettingsSourceInfo[];
  effective: SettingsPermissions;
}

/**
 * Resolving the settings cascade — the one thing the preview cannot do for itself.
 *
 * A PORT for the same reason `GitPort` is one: the resolution lives in the Agent SDK, and
 * `claude-preview.ts` must import nothing that can start a process (`test/core/claude.test.ts`
 * walks its import graph). So `src/core/agent-sdk.ts` implements this and `src/main/ipc.ts` — the
 * composition root — hands it over. Omitting it is not an error: the disclosure then says the
 * settings files were not consulted, which is honest, rather than listing the app's intent as
 * though it were the effective configuration.
 */
export interface SettingsPort {
  /** Resolve the cascade as it applies to a run in `cwd`. Never spawns the `claude` CLI. */
  resolve(cwd: string): Promise<EffectiveSettingsSnapshot>;
}

/**
 * Where a readable directory came from.
 *
 * `cwd` is the working directory the app chose. `settings` is a tree a file on disk added, which
 * the app did not ask for. `app` arrived with the session pane: a live session reads the open
 * project AND the marketplaces resolved out of `~/.claude/plugins/known_marketplaces.json`, which
 * this app passes as `additionalDirectories` — chosen by the app, like `cwd`, but not the place the
 * session is running. Three origins rather than a flag, because "the app widened this" and "a file
 * you have never read widened this" are different things to consent to.
 *
 * `session` is the fourth, and the only one a PERSON authored: a live session asked to look outside
 * its scope, the user answered a prompt, and the answer holds until the session ends. It is an
 * origin on this list rather than a second list precisely so it is listed, attributed and revocable
 * through the one component that already renders directories — a flat list would destroy the
 * distinction that matters most here, which is "you granted this, in this session".
 */
export type ReadScopeOrigin = "cwd" | "app" | "settings" | "session";

/** A tree the run can read. Everything under it, with no prompt at any point. */
export interface ClaudeReadDirectory {
  /** Absolute path. */
  path: string;
  origin: ReadScopeOrigin;
  /** Which tier put it in scope. Null for the working directory, which the app chose. */
  tier: SettingsTier | null;
  /** The settings file it came from, when there is one. */
  file: string | null;
  /** Why it is readable, in a sentence the dialog renders verbatim. */
  note: string;
}

/** One permission rule the effective settings carry, and which file it came from. */
export interface ClaudePermissionRule {
  list: "allow" | "deny" | "ask";
  /** The rule as written, e.g. `Bash(git push:*)`. */
  rule: string;
  /** Null when the rule is in the merged result but in none of the files that were read. */
  tier: SettingsTier | null;
  file: string | null;
}

/**
 * Everything the confirmation says about what a run may SEE, as opposed to change.
 *
 * `summary` is derived here rather than in the renderer for the same reason every path is: the
 * renderer must not be the thing that decides what the user is told about a run.
 */
export interface ClaudeReadScope {
  /** Every tree in scope, working directory first. */
  directories: ClaudeReadDirectory[];
  /** The project the window has open. "" when there is none. */
  projectRoot: string;
  /** The open project is inside one of `directories` — the run can see what the user is looking at. */
  projectReadable: boolean;
  /** Write targets that sit outside every readable tree: the run writes where it cannot look. */
  writesOutsideReadScope: string[];
  /** Plain-English account of the read/write relationship. Rendered verbatim. */
  summary: string;
  /** Permission rules in the EFFECTIVE settings. The app itself passes none. */
  rules: ClaudePermissionRule[];
  /** Rules beyond the cap, counted rather than listed — a wall of text is not a disclosure. */
  rulesOmitted: number;
  /** Every tier consulted, low→high, with its file and its raw contribution. */
  sources: SettingsSourceInfo[];
  /** The merged `permissions.defaultMode` and where it came from, after the CLI's trust filter. */
  defaultMode: { mode: string; tier: SettingsTier | null } | null;
  /**
   * Set when the cascade could not be resolved: the list is then the app's own intent and nothing
   * more. Never left null to mean "there was nothing" — the two are different answers.
   */
  unresolved: string | null;
}

/**
 * Everything the confirmation modal needs, and the token that makes the run possible.
 *
 * Producing one of these spawns nothing. That is not a description of the current implementation —
 * it is enforced by `claude-preview.ts` importing no module that can start a process.
 */
export interface ClaudePreview {
  /**
   * Single-use, time-limited authorisation to run exactly `argv` in exactly `cwd`.
   *
   * Null when the CLI is unavailable: there is nothing to authorise, so the UI has nothing to
   * enable. The prompt is still returned in full — copying it into a session by hand is the
   * documented fallback, and it must work in every state.
   */
  token: string | null;
  /** The full prompt text, shown verbatim and scrollable. Never a summary. */
  prompt: string;
  /**
   * The EQUIVALENT command line, with argv[0] the resolved binary — what to run to reproduce this
   * yourself, which is what Copy prompt is for. The app runs it as an Agent SDK session, which adds
   * its own stream-protocol flags; the exact argv that was spawned comes back on `ClaudeRunResult`.
   */
  argv: string[];
  cwd: string;
  targets: ClaudeWriteTarget[];
  /**
   * What the run can read — the other half of `targets`, and the bigger one.
   *
   * Never optional. A preview without it would be a confirmation that silently says nothing about
   * the largest thing it is granting, which is precisely the state this field exists to end.
   */
  read: ClaudeReadScope;
  /**
   * What continuing this in the session pane would open, or null when this preview cannot be
   * handed off at all.
   *
   * Present so the confirmation can say what the OTHER button costs before it is pressed: the same
   * dialog offers a headless run and a conversation, and the conversation is the one that widens
   * something. Non-null only for the four create-\* forms — see `HandoffContext`.
   */
  handoff: HandoffContext | null;
  available: boolean;
  /** Absolute path of the resolved CLI, or null. */
  bin: string | null;
  /** Directories searched to decide `available`, in order. */
  searched: string[];
  /** Set only when `available` is false: a message naming what was looked for and where. */
  unavailable: string | null;
  /** Epoch ms after which the token is refused. */
  expiresAt: number;
}

/**
 * What a completed create-\* preview would hand to the session pane, if the user continues there.
 *
 * THE HANDOFF CARRIES THIS, AND NOTHING THE RENDERER SUPPLIED. It is built by `claude-preview.ts`
 * from the same `resolveCreateTarget` that chose the scaffold's path, read off the disk the scaffold
 * has already written, and it rides on the invocation the token names — so continuing in the pane
 * takes a token exactly as running headlessly does, and a renderer can no more nominate a writable
 * directory here than it can nominate a scaffold destination.
 *
 * Null on every request kind that is not a create-\* form or `update-skill-tags` (`maestro-task` is
 * the other one today): a task decides for itself what it edits, and its write target is the whole
 * project, which is precisely the thing the pane's accumulator must never be able to swallow in one
 * click.
 */
export interface HandoffContext {
  /** Which form was submitted, e.g. `create-skill`, or `update-skill-tags`. */
  kind: CreateRequest["kind"] | UpdateSkillTagsRequest["kind"];
  /** The kebab-case name the scaffold resolved — not always the one the form held. */
  name: string;
  /** The primary artifact: the file for a skill/agent, the directory for a plugin/marketplace. */
  artifact: string;
  /**
   * THE ONE PATH A HANDOFF ADDS TO THE WRITE SCOPE.
   *
   * The artifact's own directory wherever the artifact has one — a skill's directory, an agent's
   * directory, the plugin, the marketplace — because finishing an artifact in conversation means
   * writing beside it (a reference file, a README) and not only into the one file a headless prompt
   * named. Where the artifact is a lone file in a directory it SHARES (a project-target subagent
   * under `.claude/agents/`), it is the file itself: the alternative would hand the session every
   * other agent in that directory, which no form asked for.
   */
  writeScope: string;
  /** Which of those two `writeScope` is, so the header and the announcement can say it plainly. */
  scope: GrantScope;
  /**
   * What the scaffold left behind, read from disk when the preview was built: the artifact's
   * frontmatter, or the files inside its directory.
   *
   * Seeded into the conversation so the model does not re-ask for a name, a description or a set of
   * triggers the form already captured — and does not rewrite the `description:` the user approved
   * in the form's live preview because it never saw it.
   */
  state: string;
  /** Whether the artifact is already inside a git repository — `016`'s answer, so nothing offers `git init` for a repo that exists. */
  repo: string;
}

/** One piece of output as it arrives. Streamed; the UI never waits for completion to show output. */
export interface ClaudeOutputChunk {
  stream: "stdout" | "stderr";
  chunk: string;
}

/**
 * How a run ended.
 *
 * The four outcomes are distinguishable on purpose. "Failed" means the session ran and ended badly —
 * `error` says how, and the output is worth reading. "Crashed" means it never ran, or died on a
 * signal — the message is about the machine, not the prompt. Collapsing them into `ok: false` throws
 * away which of those two the user is looking at.
 */
export interface ClaudeRunResult {
  outcome: "ok" | "failed" | "crashed" | "cancelled";
  /**
   * 0 on success, null otherwise. A session is not a process exit: the CLI is a child the SDK owns,
   * and "why it ended" arrives as a result message rather than as a status. `error` carries that,
   * and is the field to render — a code here would be invented.
   */
  code: number | null;
  signal: string | null;
  /** Why it is not `ok`: a spawn-level failure, or the reason the session ended. */
  error: string | null;
  /** Everything the run wrote, also delivered as it arrived. Both are surfaced on every outcome. */
  stdout: string;
  stderr: string;
  /** Output exceeded the retained cap; the tail is kept and the head dropped. */
  truncated: boolean;
  durationMs: number;
  /**
   * What was ACTUALLY spawned, captured from the SDK's own spawn options — so it carries the
   * protocol flags the SDK adds and will not match the equivalent argv the modal displayed.
   */
  argv: string[];
  cwd: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// The session pane — one live, multi-turn conversation per open project.
//
// A run on `claude:run` is a previewed invocation: main authored the prompt, the user approved it,
// and a token authorises exactly that. A session is the other shape entirely — the user types
// every turn, so there is no prompt for main to build and nothing for a confirmation to display
// that the user did not just write. The invariant is restated rather than dropped: `session:say`
// carries USER-TYPED TEXT AND NOTHING ELSE, and it is stamped `origin: { kind: "human" }` at the
// SDK boundary, which is what makes "the renderer never authors a prompt" checkable rather than
// merely intended.
//
// What the session may WRITE starts as nothing, and exactly one thing in the app can change that:
// a create-* form the user submitted, handed off with the token its confirmation was built from
// (`session:handoff`, `HandoffContext`). There is no field on this surface by which a renderer could
// name a writable path — `020` built the prompt UI over an empty list, and `022` gave that list its
// only source. Everything else still asks.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One thing that happened in a session, as it happened.
 *
 * A discriminated union rather than a text stream, which is what `claude:run` delivers. A run's
 * output is destined for a `<pre>`; a transcript has to render an assistant's prose differently
 * from a tool call, and a refusal differently from both. Flattening them into text in main and
 * re-parsing them in the renderer is how the log view's shapes ended up in two places.
 */
export type SessionEvent =
  /** Assistant prose, one complete message at a time. */
  | { kind: "assistant"; seq: number; text: string }
  /** A tool the model used. Rendered through the same humanizer the log view uses. */
  | { kind: "tool"; seq: number; tool: string; target: string | null }
  /**
   * A tool call this app refused, with the reason the model was given — the same string, so the
   * transcript and the model's context agree about what happened.
   */
  | {
      kind: "refusal";
      seq: number;
      tool: string;
      target: string | null;
      reason: string;
      /** Who decided. Two of these arrive by routes that share no code — see `RefusalSource`. */
      source: RefusalSource;
      /** The SDK's own discriminator on an auto-denial: `rule`, `mode`, `classifier`, `asyncAgent`. */
      decidedBy: string | null;
    }
  /** A tool call waiting on a person. Answer it with `session:permission`, or it waits forever. */
  | { kind: "permission"; seq: number; request: PermissionPrompt }
  /**
   * A STRUCTURED QUESTION, waiting on a person — the pane's headline feature.
   *
   * It arrives on the same channel as a permission request and is nothing like one: the model is
   * not asking to do something, it is asking the user to decide something, with real options and a
   * description and a preview per option. Rendering it as "Claude wants to use a tool — Allow /
   * Deny" would be absurd, so it is its own member and its own card. Answer it with
   * `session:question`, or it waits exactly as long as a permission prompt does.
   */
  | { kind: "question"; seq: number; request: QuestionPrompt }
  /**
   * A pending request is no longer pending — because the user answered it, or because the session
   * went away and every outstanding ask was denied on its behalf.
   *
   * ONE EVENT FOR BOTH KINDS OF ASK, because there is one registry behind them. A question and a
   * permission request are parked by the same `createPermissionRegistry()` and drained by the same
   * `denyAll` on every exit; a second resolution event would mean a second thing to remember to
   * emit, and the one that gets forgotten leaves a card on screen that nobody can answer. The
   * renderer clears whichever list holds `requestId`.
   */
  | { kind: "permission-resolved"; seq: number; requestId: string; outcome: PermissionOutcome }
  /**
   * The read scope MOVED — the first thing in this app that can happen mid-session.
   *
   * `020` resolved the readable set once at session start and handed the same list to the hook and
   * to the disclosure. A session grant makes it mutable, and it has to reach BOTH or the header and
   * the boundary start disagreeing about what the model can see. This event is that second half:
   * main re-derives the disclosure the moment it widens the boundary, and the pane's header re-reads
   * it from here rather than from what a button click implied.
   */
  | {
      kind: "scope";
      seq: number;
      read: ClaudeReadScope;
      grants: SessionGrant[];
      /** Absolute paths the session may now write. Grows only through a create-\* handoff. */
      writable: string[];
      /** The same list with its provenance — which form opened each one, and what it wrote. */
      writes: SessionWrite[];
    }
  /**
   * Context appended to the conversation WITHOUT a model turn.
   *
   * A create-\* handoff seeds what was scaffolded, where it landed, and what is left to write. It
   * is a transcript entry rather than a notice because the user is entitled to read the whole of
   * what was put in front of the model on their behalf — and because it is the one entry that costs
   * nothing: `shouldQuery: false` holds it until the user's first typed turn.
   */
  | { kind: "context"; seq: number; title: string; text: string }
  /** Something about the session itself: stderr worth surfacing, a boundary event. */
  | { kind: "notice"; seq: number; text: string }
  /** A turn finished. `ok: false` means the session reported an error rather than an answer. */
  | { kind: "turn"; seq: number; ok: boolean; error: string | null; costUsd: number | null }
  /**
   * SPEND MOVED — pushed as it accrues, rather than only at the end (`024`).
   *
   * Fed from exactly the place that decides whether a `result` message was a turn at all: a
   * `shouldQuery: false` append is answered by its own zero-cost result, and a running figure that
   * counted it would report a turn that never ran. Same guard, same branch, one source.
   */
  | { kind: "spend"; seq: number; spend: SessionSpend }
  /**
   * The effort level or the model changed, or the session learned which models it could offer.
   *
   * Both are changeable on a LIVE session without losing the conversation — `setModel()` mid-turn,
   * `applyFlagSettings({ effortLevel })` from the next turn — so the header cannot render them from
   * what a click implied. It re-reads them from here, exactly as it re-reads the scope from
   * `{ kind: "scope" }`.
   */
  | { kind: "settings"; seq: number; effort: SessionEffort; model: string | null; models: SessionModel[] }
  /**
   * The session is over — no further turn can be sent. `error` is null on a clean close.
   *
   * `024` GAVE THE ENDING A REASON, and that is the difference between a door and a crash. A budget
   * or turn ceiling ends the query the same way a failure does; without `reason` the pane can only
   * render both as "the session ended", and the transcript the user is entitled to continue from
   * looks exactly like one that broke. `canContinue` is the door itself: true only for a ceiling,
   * never for an error, because a session that failed is not one that ran out of allowance.
   */
  | {
      kind: "ended";
      seq: number;
      error: string | null;
      reason: SessionEndReason;
      /** What it had spent when it stopped. Null when the session never reached a first turn. */
      spend: SessionSpend | null;
      canContinue: boolean;
    };

/**
 * Who refused a tool call — and the reason this is a field rather than a comment.
 *
 * The four values arrive through routes that share no code, and two of them are easy to build only
 * one of. `write-scope` and `read-boundary` are this app's own decisions; `user` is an answered
 * prompt; and `auto` is the SDK's `permission_denied` stream event, which reports deny RULES and
 * MODE denials — and which explicitly does **not** report hook denials, so a `read-boundary` entry
 * has to be written by the hook layer itself or it never appears at all.
 *
 * `question` is the fifth and the narrowest: an `AskUserQuestion` call that carried nothing the
 * pane could render as a choice. It is refused rather than parked, because a card nobody can answer
 * is a promise only teardown will ever resolve.
 */
export type RefusalSource = "write-scope" | "read-boundary" | "user" | "auto" | "question";

/**
 * How a pending ask ended. `cancelled` is the session going away underneath it.
 *
 * `answered` belongs to a QUESTION and to nothing else: a question is never allowed or denied — it
 * is answered, or it is cancelled with the session. It shares this union rather than getting one of
 * its own because both kinds of ask are parked in one registry and resolved by one event.
 */
export type PermissionOutcome = "allow" | "deny" | "stop" | "cancelled" | "answered";

/**
 * The answer to a permission request — the SDK's `PermissionResult`, narrowed to what this app
 * sends.
 *
 * TWO SHAPES, AND THE FALL-THROUGH IS A DENY. The SDK reads `null` as "the host answered out of
 * band" and then never writes a `control_response` at all; prompts do not time out, so the tool
 * call blocks forever with nothing on screen. Every producer of this type — `decideWrite`, which
 * aliases it as `WriteDecision`, and the renderer's Allow/Deny/Stop buttons — is therefore
 * incapable of producing `undefined` by falling through a branch.
 *
 * `interrupt` is what makes Deny and Stop two controls rather than one: a plain denial refuses the
 * call and lets the model adapt (it reads the message and tries something else), while `interrupt`
 * ends the turn. `decideWrite` never sets it — only a person does.
 */
export type PermissionAnswer =
  | {
      behavior: "allow";
      /**
       * The one permission update this app will ever author, and the reason it is typed this
       * narrowly rather than as the SDK's `PermissionUpdate`.
       *
       * The SDK's union also carries `addRules` (blanket allow rules), `setMode` (including
       * `bypassPermissions`) and four destinations, three of which WRITE TO DISK — the user's
       * repository, their machine-local project settings, or their home directory. Nothing in this
       * app has a reason to reach any of them, so the type cannot express them: what remains is a
       * directory added for the length of this session and nothing else. See
       * `SessionPermissionUpdate`.
       */
      updatedPermissions?: SessionPermissionUpdate[];
    }
  | { behavior: "deny"; message: string; interrupt?: boolean };

/**
 * What an ANSWERED QUESTION resolves to — the one place this app puts a value in `updatedInput`.
 *
 * `PermissionAnswer` above is a decision and carries no payload, which is the property every other
 * surface in this app is built to keep. A question cannot be answered that way: the answer IS the
 * tool's input, written back with the user's choices in it. So it is a second type rather than a
 * fifth field on the first one — the two are never interchangeable, and a diff that widened the
 * permission answer instead would have made every write prompt able to rewrite its own tool call.
 *
 * The payload is built in `agent-sdk.ts` from the input the SDK delivered and the labels
 * `answerQuestions` validated against it. Nothing here crosses a process boundary.
 */
export type QuestionAnswer = {
  behavior: "allow";
  /** The call as it arrived, plus `answers` (and `response` on a freeform reply). */
  updatedInput: Record<string, unknown>;
};

/**
 * What a parked ask resolves to — either kind, because one registry holds both.
 *
 * The deny arm is common to both members and is what teardown produces: a question nobody was left
 * to answer is refused exactly like a permission request, with a sentence the model can read.
 */
export type ParkedAnswer = PermissionAnswer | QuestionAnswer;

/**
 * A session-scoped directory grant, in the SDK's own `PermissionUpdate` shape — narrowed to the
 * single member this app is allowed to author.
 *
 * `destination: "session"` is the whole guarantee about disk. The alternatives are all worse than
 * they look: `localSettings` lands a rule in the user's repository, `projectSettings` lands one
 * they would commit, and `userSettings` is global to the machine. A grant that outlives the
 * conversation it was made in is not the thing the user was asked about, so the literal type is the
 * enforcement — a diff cannot widen it without changing this line.
 */
export interface SessionPermissionUpdate {
  type: "addDirectories";
  directories: string[];
  destination: "session";
}

/** Grant just the file that was asked about, or the directory containing it. */
export type GrantScope = "file" | "directory";

// ─────────────────────────────────────────────────────────────────────────────
// What a session may SPEND, and what it says when it has spent it (`024`).
//
// The third mutable thing about a live session, after what it may read (`023`) and what it may
// write (`022`) — and the first one that can END it. The decisions behind these types are written
// once, in `src/core/session-budget.ts`; what is here is only the shape they cross a process
// boundary in. Two of them are worth reading before the rest:
//
//   • `SessionEndReason` is the field this whole surface turns on. `019`'s pane ended when the SDK
//     stream ended and carried no reason with it, which is fine for a crash and useless for a door:
//     "the ceiling fires, the session ends cleanly, and the pane offers Continue" cannot be built on
//     an ending that cannot say why it happened.
//   • `SessionSpend` is an ESTIMATE throughout. It is the CLI's own client-side figure — the same
//     one the ceiling is compared against — and the work draws on the user's subscription. Rendering
//     it as an accounting figure promises something this app cannot deliver.
// ─────────────────────────────────────────────────────────────────────────────

/** Which ceiling ended a session, when one did. Both are doors: each offers Continue. */
export type SpendCeiling = "budget" | "turns";

/** How a session ended, in one word a UI can branch on. `closed` is a person or a teardown. */
export type SessionEndReason = "closed" | "budget" | "turns" | "error";

/** How hard the model thinks per turn. A larger lever than model choice for a session that reads. */
export type SessionEffort = "low" | "medium" | "high" | "xhigh" | "max";

/**
 * A model the session could run on, as the CLI itself lists them.
 *
 * Resolved by main from the SDK's `supportedModels()` and published with the session, so the
 * renderer picks an id off a list this process produced rather than naming one of its own — the
 * same discipline a grant's scope word follows.
 */
export interface SessionModel {
  id: string;
  label: string;
  description: string;
  /** Effort levels this model accepts. Empty when it supports none, and the control says so. */
  effortLevels: SessionEffort[];
}

/**
 * What a session has spent, as far as anyone can tell.
 *
 * `estimateUsd` is the conversation's lifetime figure and `allowanceUsd` is what has gone against
 * the ceiling in force right now. They are equal until the first Continue, and after one they are
 * the honest pair: the user is agreeing to another `ceilingUsd`, not being told the conversation
 * has spent nothing.
 */
export interface SessionSpend {
  /** The whole conversation's estimated spend, across every allowance it has been given. */
  estimateUsd: number;
  /** Estimated spend inside the CURRENT allowance — what `ceilingUsd` is measured against. */
  allowanceUsd: number;
  ceilingUsd: number;
  /** User turns answered in this conversation. A seeded `shouldQuery: false` context is not one. */
  turns: number;
  /** The CLI's per-allowance agentic-turn ceiling. */
  maxTurns: number;
  /** 1 when the session starts, +1 for every Continue. */
  allowances: number;
  /** Which ceiling ended it, or null while it runs. */
  ended: SpendCeiling | null;
}

/**
 * One thing the user can grant in answer to a prompt, resolved by the main process.
 *
 * The renderer renders these and sends back only a `scope` word — it never nominates a path, which
 * is `scaffold.ts`'s "a renderer describes an artifact and never nominates a directory" applied to
 * the permission wire. The paths are here so the BUTTONS can name them: "grant the file" and "grant
 * the directory" are the same sentence until the user can see that one of them says `~/.claude`.
 */
export interface SessionGrantOption {
  scope: GrantScope;
  /** Absolute path this option would make readable for the rest of the session. */
  path: string;
  /** The button's own words, e.g. `Allow this folder`. */
  label: string;
  /** What it costs, in a sentence — rendered verbatim beside the button. */
  note: string;
  /**
   * The grant reaches far more than the file that was asked about — a home directory, a filesystem
   * root, a top-level tree. Still offered, because the user may genuinely mean it, but never
   * offered quietly.
   */
  broad: boolean;
}

/** A grant that is in force. Dies with the session; nothing here is ever written to disk. */
export interface SessionGrant {
  /** Absolute path now readable. A directory means everything under it; a file means itself. */
  path: string;
  scope: GrantScope;
  /** The path the prompt was about, which is not always `path` — a file grant's directory is not. */
  target: string;
  /** The tool call that asked for it, so the header can say what this was for. */
  tool: string;
  /** Epoch ms. The header sorts by it, and it is what makes "granted just now" sayable. */
  grantedAt: number;
}

/**
 * One directory (or lone file) this session may write, and the form submission it came from.
 *
 * THE WHOLE OF THE PANE'S WRITE AUTHORITY IS A LIST OF THESE, and every entry names the artifact
 * that produced it. That is the property worth reading twice: a session opens with none, and the
 * only thing in the app that appends one is a create-\* form the user filled in and a deterministic
 * scaffold that already wrote a file there. Not a dialog they clicked through — an artifact they
 * made, minutes ago. Like `SessionGrant`, it dies with the session and reaches no file on disk.
 */
export interface SessionWrite {
  /** Absolute path now writable. A directory means everything under it; a file means itself. */
  path: string;
  scope: GrantScope;
  /** The artifact the form created, which is not always `path` — a lone file's directory is not. */
  artifact: string;
  /** Which form was submitted, e.g. `create-skill`. The header says what opened this. */
  kind: string;
  /** The artifact's resolved name, for the same reason. */
  name: string;
  /** Epoch ms, so the header can order additions and say "just now". */
  addedAt: number;
}

/**
 * What the RENDERER is allowed to send — a decision, never a result.
 *
 * The four buttons, and nothing that could become a fifth. `PermissionAnswer` above is the SDK's
 * own shape, and its allow arm carries `updatedPermissions`: a field that can add blanket allow
 * rules, flip the session to `bypassPermissions`, or widen the readable set permanently and
 * machine-wide, with destinations that write to the user's repository or to their home directory.
 * A renderer that could put a value there would be authoring policy rather than answering a
 * question, so the wire carries this instead and the main process constructs the answer.
 *
 * `reason` is what the model is told. It travels on `deny` and on `stop` because a denial with an
 * empty message wastes the one channel there is for steering — the model READS the refusal and
 * adapts — and main substitutes a real sentence rather than forwarding an empty string.
 */
export type PermissionChoice =
  | { choice: "allow" }
  | { choice: "deny"; reason: string }
  /** Deny AND end the turn. A different intent from a plain refusal, so it is a different button. */
  | { choice: "stop"; reason: string }
  /**
   * Allow, AND stop asking about this path for the rest of the session.
   *
   * A SCOPE WORD AND NOTHING ELSE. The path is not on the wire: main holds the prompt this answers
   * and resolves `scope` against the `SessionGrantOption` it already published, so a renderer
   * cannot name a directory here any more than it can name one on `create:scaffold`. A `scope` that
   * matches no option on that prompt grants nothing.
   */
  | { choice: "grant"; scope: GrantScope };

/**
 * One hunk of what a write would change. `before: null` means the file is being created.
 *
 * A prompt is not a file viewer: the bodies are clipped and the surplus hunks counted, because the
 * question being asked is "should this happen", not "review this patch".
 */
export interface PermissionDiffHunk {
  before: string | null;
  after: string;
}

export interface PermissionDiff {
  hunks: PermissionDiffHunk[];
  /** Hunks not included above, because the call carried more than a prompt should render. */
  more: number;
  /** True when at least one body was clipped for length. */
  clipped: boolean;
}

/**
 * What a permission prompt actually shows, per tool.
 *
 * PER TOOL, NEVER A PAYLOAD DUMP. A generic `{tool, input}` blob is technically correct and
 * practically useless: users click Allow blindly, which is worse than pre-accepting because it
 * looks like consent. So a fetch shows the COMPLETE url — query string included, never elided to a
 * hostname, because the session can read the user's project and an outbound request is how its
 * contents leave — and a write shows the path and what would change.
 */
export type PermissionDetail =
  /** `WebFetch`. `url` is verbatim from the call: nothing here shortens or normalises it. */
  | { kind: "fetch"; url: string; prompt: string | null }
  /** `WebSearch`. The query leaves the machine, so it is what the prompt shows. */
  | { kind: "search"; query: string }
  /** `Write`/`Edit`/`MultiEdit`/`NotebookEdit`. */
  | { kind: "write"; path: string; diff: PermissionDiff | null }
  /** A `Read` the boundary stopped. */
  | { kind: "read"; path: string }
  /** `Glob`/`Grep` — the root it would search and the pattern, since either can leave the scope. */
  | { kind: "scan"; path: string | null; pattern: string | null }
  /** Anything else: NAMED, with whatever the request carried, rather than dumped. */
  | { kind: "other"; summary: string };

/**
 * A tool call parked in the main process, waiting for a person.
 *
 * `requestId` is the idempotency key and the only handle the answer travels back on. A request
 * whose response was lost across a transport gap **is dispatched again** — by `reinitialize()`, and
 * by any `initialize` to a running session, whose response carries `pending_permission_requests`
 * that the SDK re-dispatches for you. Resolving the entry that already exists is correct; parking a
 * second one beside it leaks a promise the UI has nothing left to answer.
 */
export interface PermissionPrompt {
  requestId: string;
  /** The tool call this answers, when the SDK named one. */
  toolUseId: string | null;
  tool: string;
  /** The subagent that asked, or null for the session itself. */
  agentId: string | null;
  /** The path that triggered it — the SDK's `blockedPath` when it gave one, else our own. */
  target: string | null;
  /** Why a person is being asked, written for them. Never empty: an unexplained prompt is a blind Allow. */
  reason: string;
  /**
   * What the MODEL is told if this is denied and the user typed no reason of their own.
   *
   * A second sentence rather than a reuse of `reason`, because the two have different readers. It
   * is also how `decideWrite`'s refusal survives a write becoming a prompt: the engine's message
   * still reaches the model, verbatim, on the path where the call is actually refused.
   */
  denyReason: string;
  /** The SDK's own explanation of what forced the prompt, when it gave one. */
  decisionReason: string | null;
  /** The CLI's own prompt sentence, when it rendered one — preferred over reconstructing it. */
  title: string | null;
  detail: PermissionDetail;
  /**
   * What the user may grant for the rest of the session, beyond letting this one call through.
   *
   * EMPTY IS THE COMMON CASE AND IS NOT A DEFECT. Only a read the boundary stopped is grantable: a
   * refused WRITE is not (the write scope is `022`'s to grow, and widening reads from a write
   * prompt is exactly the accident `session-scope.ts` keeps checkable), and a `WebFetch` has no
   * path to grant. A prompt with no options renders Allow once / Deny / Stop, as it did before.
   */
  grants: SessionGrantOption[];
}

// ─────────────────────────────────────────────────────────────────────────────
// The structured question — the reason the pane exists, and the one carve-out in "a decision
// crosses the boundary, never a payload".
//
// When Claude needs a decision it asks a real question with real options instead of guessing, and
// the answer has to reach the tool as a payload — `updatedInput`, the field nothing else in this
// app is allowed to author. The carve-out is made provable rather than trusted, in three parts:
// the renderer sends a SELECTION (which question, which labels) and nothing else; the main process
// rebuilds the payload from the questions the MODEL asked; and every label is checked against the
// options it offered, with anything else rejected rather than forwarded. Same shape as `023`'s
// grant, which crosses as a scope word and is resolved against the options main published with the
// prompt — one layer up, and with a bigger payload on the far side.
// ─────────────────────────────────────────────────────────────────────────────

/** One choice on offer. `preview` is null unless the session declared a preview format. */
export interface AgentQuestionOption {
  /** The button's words — and the token an answer names it by. Never invented on this side. */
  label: string;
  /** What picking it means, rendered under the label. */
  description: string;
  /**
   * A mockup, a snippet, a config sample: what this option would actually look like.
   *
   * Null when the session did not opt into previews (`toolConfig.askUserQuestion.previewFormat` is
   * unset, and the model then emits none at all) or when the model had nothing to show.
   */
  preview: string | null;
}

/** One question, with its options. A question with fewer than two of them is not a choice. */
export interface AgentQuestion {
  /** The question in full. It is also the KEY the answer is recorded under, per the tool's shape. */
  question: string;
  /** A short chip label (≤12 chars) — what the card is titled while the question is the body. */
  header: string;
  /** Several answers are accepted. The card says so, and a single-select one refuses a second. */
  multiSelect: boolean;
  options: AgentQuestionOption[];
}

/**
 * A question parked in the main process, waiting for a person.
 *
 * `requestId` is the same idempotency key a `PermissionPrompt` carries, from the same registry —
 * see that type for why a redelivery must re-attach rather than park a second promise.
 */
export interface QuestionPrompt {
  requestId: string;
  toolUseId: string | null;
  /** The subagent that asked, or null for the session itself. */
  agentId: string | null;
  /** One to four of them, in the order asked. Every one has to be answered, or none. */
  questions: AgentQuestion[];
}

/**
 * Which option was picked, for one question — the whole of what the renderer sends per question.
 *
 * The question is named by INDEX into the prompt's own list and the options by their labels, so
 * everything on the wire is either an offset or a string the model itself wrote. Main resolves both
 * against the call it received; a label that was not offered is an error, not a filtered entry.
 */
export interface QuestionSelection {
  /** Index into `QuestionPrompt.questions`. */
  question: number;
  /** Labels picked, exactly as offered. One, unless the question is `multiSelect`. */
  labels: string[];
}

/**
 * What the RENDERER is allowed to send in answer to a question — a selection, never a payload.
 *
 * Two arms, because a user who disagrees with every option must be able to say so: `answer` picks
 * from what was offered, `reply` is typed text that reaches the model IN PLACE OF a structured
 * answer (the tool's own `response` field, which makes Claude read "The user responded: …" instead
 * of an answer list). Neither arm can express an `answers` map, a question's text, or an option
 * that was not on screen.
 */
export type QuestionChoice = { choice: "answer"; selections: QuestionSelection[] } | { choice: "reply"; text: string };

/**
 * One session event before the sequence number is stamped on it.
 *
 * Written as a distributive conditional because a bare `Omit<SessionEvent, "seq">` is NOT: applied
 * to a union it collapses to the shared keys, so `{ kind, text }` stops type-checking and every
 * emit site looks broken for a reason that is not about the emit site. The producer stamps `seq`;
 * everything else is decided where the event happens.
 */
export type SessionEventBody = SessionEvent extends infer T ? (T extends SessionEvent ? Omit<T, "seq"> : never) : never;

// ─────────────────────────────────────────────────────────────────────────────
// Picking up a conversation the app did not start (`025`).
//
// The CLI persists every session it runs — this app's own included, since `024` passes
// `persistSession: true` — under its own store. So a conversation someone started in their terminal
// is on disk, and the pane can attach to it. Three shapes cross the wire for that, and the split is
// the point: a LIST is cheap metadata main read from the store, a DISCLOSURE is the expensive walk
// of one transcript, and neither is a path a renderer nominated. What comes back on `session:resume`
// is an id that must have come from a list main published.

/**
 * One conversation on disk, as the store describes it — enough to recognise, not enough to trust.
 *
 * Every field is READ from the CLI's own session store by main. The renderer never names a session
 * file, a directory or a project: it picks a row out of this list by its `id`, which is the same
 * discipline as a grant carrying a scope word and a model selector carrying an id main published.
 */
export interface ResumableSession {
  /** The CLI's own session id. What a resume is issued against, and the only thing the wire takes. */
  id: string;
  /** The store's display title: a `/rename`, an auto-generated summary, or the first prompt. */
  summary: string;
  /**
   * The first meaningful thing the user typed.
   *
   * Listed BESIDE the summary rather than as a fallback for it: a generated summary is the model's
   * reading of a conversation, and the sentence the person actually wrote is what they will
   * recognise. When the store has only one of the two, that one stands alone.
   */
  firstPrompt: string | null;
  /** The branch recorded at the end of the session. Null when the session was not in a repository. */
  branch: string | null;
  /** The working directory it ran in — always the open project, or it is not offered at all. */
  cwd: string;
  /** Last write to the transcript, ms since epoch. */
  lastModified: number;
  /** First entry's timestamp, ms since epoch. Null when the store did not record one. */
  createdAt: number | null;
  /**
   * Transcript size on disk, in bytes.
   *
   * The cheap half of "what will replaying this cost" — it is on the listing because it is free,
   * while the token estimate below needs the file parsed and belongs to the disclosure.
   */
  sizeBytes: number;
}

/** One thing a stored transcript already read, and whether the pane could read it too. */
export interface ResumeRead {
  /** Absolute path, resolved against the recorded session's own working directory. */
  path: string;
  /** The tool that read it, so "Grep across the repo" and "Read one file" do not look the same. */
  tool: string;
  /**
   * False when the path is outside everything this pane session may read.
   *
   * THE ONES THAT MATTER. A resumed conversation was produced under the terminal session's rules, so
   * it can carry the contents of files the pane's boundary would refuse today — the boundary applies
   * going FORWARD only. These are exactly the paths the pane will now start asking about, because a
   * resumed session starts with no grants.
   */
  inScope: boolean;
}

/**
 * What the user is shown before a resume, and can decline.
 *
 * The one disclosure in this app that is about the PAST rather than about what is permitted next.
 * Everything else — `ClaudeReadScope`, the write scope, the grants — describes a boundary in force;
 * this describes context that already exists and that the boundary cannot retract.
 */
export interface ResumeDisclosure {
  /** The row this describes, carried along so the confirmation can restate what it is about. */
  session: ResumableSession;
  /** Turns in the transcript, as the store counts messages. */
  messages: number;
  /** Paths the transcript's own tool calls named, first-seen order, out-of-scope ones first. */
  reads: ResumeRead[];
  /** How many reads were dropped from `reads` for length. Zero when the list is complete. */
  more: number;
  /** How many of the listed reads are outside what this pane session may read. */
  outside: number;
  /** Estimated tokens replayed as input on the first turn. An estimate, and the note says so. */
  replayTokens: number;
  /** What that replay is estimated to cost, in USD, at the rate `replayNote` names. */
  replayUsd: number;
  /** The sentence about that cost — written once, in `session-resume.ts`, like every other. */
  replayNote: string;
  /** The sentence about what the transcript already carries, and what this list cannot see. */
  readNote: string;
  /** The sentence about what does NOT come across: grants, write scope, settings. */
  scopeNote: string;
}

/** Everything the pane header states about the session it is attached to. */
export interface SessionInfo {
  /** Null when no session is running: every other field then describes what one WOULD get. */
  id: string | null;
  projectRoot: string;
  /**
   * Where the session runs: the open project, and a create-\* handoff does NOT move it.
   *
   * A handoff widens what the session may write and leaves the conversation where it was. Moving
   * the cwd would move the read boundary's anchor mid-conversation and silently re-point every
   * relative path in the transcript — the failure `CwdChanged` is registered to notice.
   */
  cwd: string;
  /**
   * What it can see, in the same shape and rendered by the same component as the confirmation
   * dialog's disclosure. Not a second notion of "what this session can read".
   */
  read: ClaudeReadScope;
  /**
   * What it may write. EMPTY UNTIL A FORM IS SUBMITTED, and the header says so in words, because an
   * empty list on screen says nothing at all.
   *
   * The flat list of `writes[].path`, derived in one place so the two cannot disagree. It grows by
   * exactly one entry per create-\* handoff and by nothing else in the app.
   */
  writable: string[];
  /**
   * The same paths with their provenance: which form opened each, and what it wrote.
   *
   * The revocable-looking half of the write scope is deliberately NOT revocable: a grant answers a
   * question the session asked, and can be taken back because the session can be made to ask again.
   * A write scope entry answers a form the USER submitted, and the way to stop it is to end the
   * session — which is also what a project switch does.
   */
  writes: SessionWrite[];
  /**
   * Directories a person opened for this session, in force right now.
   *
   * Also present, and already attributed, inside `read.directories` as `origin: "session"` — this
   * list is the revocable handle on them, not a second notion of what is readable. A grant the user
   * cannot find again has not made the boundary optional, it has removed it.
   */
  grants: SessionGrant[];
  /**
   * What it has spent and what it may spend, as an ESTIMATE (`024`).
   *
   * Present whether or not a session is running: with none, it is what one WOULD be given, which is
   * how the header can state the ceiling before the user has spent anything at all.
   */
  spend: SessionSpend;
  /** Which ceiling ended the session, if one did — the pane offers Continue on either. */
  endReason: SessionEndReason | null;
  /** True while a session is resumable: it ended on a ceiling and its transcript is intact. */
  canContinue: boolean;
  /** The effort level in force. Changeable mid-session without losing the conversation. */
  effort: SessionEffort;
  /** The model in force, as the CLI reported it. Null before a session has initialised. */
  model: string | null;
  /** What the model selector may offer, resolved by main from the CLI's own list. */
  models: SessionModel[];
  /** The tools the session was offered, so the header can name them rather than imply them. */
  tools: string[];
  /** Skills declared for the session, including the help skill the deleted chat asked for by name. */
  skills: string[];
  /** False when the `claude` CLI could not be found: the composer says so instead of failing on send. */
  available: boolean;
  unavailable: string | null;
}

export interface SaveResult {
  /** Absolute path of the file written. */
  configPath: string;
  config: MaestroConfigV3;
  /**
   * `ok: false` with "maestro/SKILL.md not found" is the normal state for a project where
   * Maestro isn't installed yet — the config still saved.
   */
  render: RenderResult;
  rules: ApplyRulesSummary;
  /** Human-readable notes worth surfacing in the save toast. */
  warnings: string[];
}

// ─────────────────────────────────────────────────────────────────────────────
// The read-only surface folded in from apps/help-server (docs/plans/m6-help-server-merge.md).
//
// These describe what the machine and the open project ALREADY contain — installed plugins, the
// project's own marketplace manifest, the curated marketplaces' cache, the rule library, the CLI
// command table, the docs. Nothing here is written by the app, which is why the whole group is a
// single loader payload per view rather than a channel per question.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A plugin installed for this machine, as `~/.claude/plugins/installed_plugins.json` records it.
 *
 * Narrower than `@repo/claude-fs`'s `InstalledPlugin` on purpose: `installPath` and `projectPath`
 * are absolute paths on this machine that no view renders, and a contract carries what crosses,
 * not what the reader happened to have.
 */
export interface InstalledPluginInfo {
  /** `<plugin>@<marketplace>` — the key `claude plugin install` uses. */
  key: string;
  pluginName: string;
  marketplace: string;
  /** "user" or "project". */
  scope: string;
  version: string;
  /** ISO timestamp; "" when the record predates the field. */
  installedAt: string;
}

/** A skill or subagent contributed by a plugin, as the marketplace tab lists it. */
export interface DefinitionSummary {
  name: string;
  description: string;
}

/** A plugin listed in the OPEN PROJECT's own `.claude-plugin/marketplace.json`. */
export interface MarketplacePluginInfo {
  name: string;
  description: string;
  version: string;
  skills: DefinitionSummary[];
  agents: DefinitionSummary[];
  /** Whether `<name>@<this marketplace>` is installed on this machine. */
  isInstalled: boolean;
  installCommand: string;
}

/** A plugin from one of the curated marketplaces, read out of `~/.claude`'s marketplace cache. */
export interface CuratedPlugin {
  name: string;
  marketplace: string;
  /** Display name for the marketplace, e.g. "Anthropic Official". */
  marketplaceLabel: string;
  description: string;
  isInstalled: boolean;
  installCommand: string;
}

/**
 * A rule file in the project's `rules/` LIBRARY — authored rules, before any assignment.
 *
 * Deliberately not a `ProjectRule`, and deliberately not produced by `discoverProjectRules`.
 * The two answer different questions about overlapping files: this one is "what does this repo
 * publish", read from `<project>/rules/*.md`; `ProjectRule` is "what is assigned where", read
 * from every `.claude/rules/` in the tree, and is what a save MOVES. Naming both "rules" is what
 * the merge plan warned about, so the library keeps `title`/`paths` (its frontmatter) and the
 * assignable one keeps `id`/`dir`.
 */
export interface RuleLibraryEntry {
  filename: string;
  /** First `# heading`, falling back to the filename. */
  title: string;
  /** `paths:` frontmatter — which files the rule claims to apply to. Empty means all. */
  paths: string[];
  description: string;
}

/** A row of the CLI command table in `<project>/docs/claude-code.md`. */
export interface ClaudeCommand {
  command: string;
  description: string;
}

/** A markdown file under `<project>/docs/`, or under one of the global doc corpora. */
export interface DocMeta {
  slug: string;
  title: string;
  /**
   * Set only by `global-docs.ts`, always `"app"` — the app's own end-user docs are the only
   * global corpus. Absent (never `""`) for the per-project docs reader, whose one corpus has no
   * need to disambiguate itself.
   */
  group?: "app";
}

/**
 * One heading's worth of a doc, which is the unit docs search matches against.
 *
 * Per-heading rather than per-file so a hit can deep-link to `#headingId` and the reader can
 * highlight the term in place — searching whole files would only ever be able to name the file.
 */
export interface DocSection {
  slug: string;
  docTitle: string;
  /** Slugified heading text; the `id` the reader puts on the rendered heading. */
  headingId: string;
  headingText: string;
  bodyText: string;
  /** Same meaning as `DocMeta.group` — set only when this section came from the global reader. */
  group?: "app";
}

/** A doc's rendered body, as `data:doc` returns it. */
export interface DocContent {
  slug: string;
  title: string;
  content: string;
}

/**
 * The global docs page's corpus, and its search index.
 *
 * NOT gated on an open project — `app` is this app's own end-user docs, read from a directory the
 * app ships rather than from anything under a project root. Empty rather than the call failing
 * when the directory doesn't resolve (see `maestroAppDocsDir`).
 */
export interface GlobalDocsData {
  app: DocMeta[];
  /** Every section from the corpus, tagged with its `group` — the search index. */
  sections: DocSection[];
}

// ─────────────────────────────────────────────────────────────────────────────
// Usage stats — the one feature in the app whose tool may be FETCHED FROM THE NETWORK.
// See `src/core/ccusage.ts` for the decision and its reasoning; these shapes exist to let the UI
// state, before anything runs, which of the two it is about to do.
// ─────────────────────────────────────────────────────────────────────────────

/** Which slice of usage to ask ccusage for. Each is one subcommand. */
export type UsageStatsView = "session" | "blocks" | "daily" | "monthly";

/**
 * Where the `ccusage` that would run comes from.
 *
 * `local` — an executable already on this machine. Nothing is downloaded.
 * `npx` — no local copy, so a PINNED version would be fetched from npm and executed.
 * `none` — neither a local copy nor `npx`. Nothing can run, and the UI says so instead of
 *          discovering it at spawn time.
 */
export type CcusageSource = "local" | "npx" | "none";

/** Tokens and cost for one slice of usage. */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

/**
 * What `ccusage <view> --json` reduces to.
 *
 * Deliberately not help-server's forty flat fields (`latestSessionInputTokens`,
 * `totalMonthlyTotalTokens`, …), which were one naming scheme per view for the same four numbers.
 * The view is a field, the numbers are a shape, and a tab that adds a view adds no contract.
 */
export interface UsageStats {
  view: UsageStatsView;
  /** Rows ccusage returned: sessions, blocks, days or months. */
  entryCount: number;
  /** What the most recent row is called — a date, a month, a session id. "" when there are none. */
  latestLabel: string;
  /** The most recent row. */
  latest: UsageTotals;
  /** Every row summed. */
  total: UsageTotals;
  /** `blocks` only: how many are still open. */
  activeBlocks: number;
  /** `daily` only: the last seven days summed. Null for every other view. */
  recent: UsageTotals | null;
  /** ISO date (`YYYY-MM-DD`) of the newest row, "" when there are none. */
  lastUpdated: string;
}

/**
 * What would run to produce those stats — returned BEFORE anything is spawned.
 *
 * The whole reason this channel exists separately from a "get me the stats" call: with `source:
 * "npx"` the act of answering downloads a package from npm and executes it on the user's machine,
 * and that is a thing to be told about rather than to discover from a network graph.
 */
export interface UsageStatsPreview {
  /** Single-use, time-limited authorisation to run exactly `argv`. Null when nothing can run. */
  token: string | null;
  view: UsageStatsView;
  source: CcusageSource;
  /** Exactly what will be spawned, argv[0] resolved. Shown verbatim. */
  argv: string[];
  cwd: string;
  /** True when running `argv` fetches a package from the network. Drives what the UI has to say. */
  network: boolean;
  /** The version a network fetch would install — pinned, never `@latest`. */
  pinnedVersion: string;
  /** Absolute path of the local `ccusage`, when one was found. */
  bin: string | null;
  /** Directories searched, in order — the "we looked here" of a not-found message. */
  searched: string[];
  /** Set only when `source` is "none": what is missing and what to install. */
  unavailable: string | null;
  expiresAt: number;
}

/** How a usage-stats run ended. Every failure is a value here, never an exception at the UI. */
export interface UsageStatsResult {
  view: UsageStatsView;
  ok: boolean;
  /** Null when the run failed. */
  stats: UsageStats | null;
  /** Why it failed, in a sentence the UI shows as-is. Null on success. */
  error: string | null;
  /** What actually ran — diffable against the argv the preview displayed. */
  argv: string[];
  durationMs: number;
}
