// The IPC contract, shared by main / preload / renderer.
//
// This file is the seam that replaces TanStack Start's server functions. Where the web app had
// `createServerFn().handler()` — a function whose body was stripped from the client bundle by a
// build step — the desktop app has an explicit typed channel. The boundary is now enforced by
// the process split rather than by a convention about which helpers may be exported, which is
// what retires the whole "Server-only code and the client bundle" hazard class.
//
// Mostly type-only, so the renderer can use these types without pulling node in. One deliberate
// exception: a handful of runtime values re-exported from the renderer-safe `contracts.ts`
// (see the re-export below) — the renderer needs the actual arrays, not just their types, to
// render pickers like the Agent Types tab's Select and the Skills tab's tag editor.

// Imported from `../core/contracts.js`, NOT `../core/index.js`. The barrel re-exports fs and
// child_process; pulling a type from it would drag all of that into the renderer's type graph.
// `contracts.ts` is interfaces only. One word apart in an import line, so test/isolation.test.ts
// asserts nothing under src/{shared,preload,renderer} reaches past the renderer-safe modules.
import type {
  MaestroConfigV3,
  MaestroInstanceV3,
  MaestroNodeV3,
  MaestroEdgeV3,
  MaestroWorkflowV3,
  MaestroRuleV3,
  MaestroWorkflowsSlice,
  MaestroRulesSlice,
  MaestroGates,
  MaestroGatesSlice,
  MaestroProjectTagsSlice,
  MaestroReportEntry,
  MaestroReportsSlice,
  DiscoveredDefinition,
  ProjectRule,
  TreeNode,
  MaestroTask,
  SessionLogEntry,
  ChannelDelivery,
  PendingLane,
  SaveResult,
  RepoDetection,
  ConfigIssue,
  InstallStatus,
  InstallReport,
  ReportSyncSummary,
  ResolvedReport,
  ReportDefault,
  HandoffSyncSummary,
  ResolvedHandoff,
  ResolvedHandoffRoute,
  HandoffDefault,
  HandoffDefaultsListing,
  UninstallPlan,
  UninstallReport,
  ClaudeRequest,
  ClaudePreview,
  ClaudeWriteTarget,
  ClaudeReadScope,
  ClaudeReadDirectory,
  ClaudePermissionRule,
  HandoffContext,
  ReadScopeOrigin,
  SettingsTier,
  SettingsPermissions,
  SettingsSourceInfo,
  ClaudeOutputChunk,
  ClaudeRunResult,
  PermissionAnswer,
  PermissionChoice,
  PermissionDetail,
  PermissionDiff,
  PermissionOutcome,
  PermissionPrompt,
  AgentQuestion,
  AgentQuestionOption,
  QuestionChoice,
  QuestionPrompt,
  QuestionSelection,
  RefusalSource,
  ResumableSession,
  ResumeDisclosure,
  ResumeRead,
  GrantScope,
  SessionGrant,
  SessionGrantOption,
  SessionPermissionUpdate,
  SessionEffort,
  SessionEndReason,
  SessionEvent,
  SessionInfo,
  SessionModel,
  SessionSpend,
  SessionWrite,
  SpendCeiling,
  CreateOptions,
  CreateRequest,
  MarketplaceEntry,
  ScaffoldResult,
  InstalledPluginInfo,
  MarketplacePluginInfo,
  DefinitionSummary,
  CuratedPlugin,
  RuleLibraryEntry,
  ClaudeCommand,
  DocMeta,
  DocSection,
  DocContent,
  GlobalDocsData,
  CcusageSource,
  UsageStats,
  UsageStatsPreview,
  UsageStatsResult,
  UsageStatsView,
  UsageTotals,
  AvatarCategory,
  AvatarPartOption,
  AvatarLayers,
  AgentType,
  AgentDescriptionResult,
  AgentContentResult,
  AgentForkResult,
  AgentForkRecord,
  AgentSyncAction,
  AgentSyncApplyResult,
  AgentSyncEntry,
  AgentSyncSummary,
  DiffLine,
} from "../core/contracts.js";

// The one runtime (non-type) import in this file. `contracts.ts` is renderer-safe — no fs, no
// child_process — so a VALUE from it costs the renderer nothing; the tag editor needs the actual
// seven-entry array to render one toggle per tag, not just the type. `AVATAR_CATEGORIES`/
// `AVATAR_PARTS` are here for the same reason: the avatar picker renders one row per category and
// one swatch per option, not just the types. `AGENT_TYPES` is the Agent Types tab's Select options.
export {
  GLOBAL_TAG,
  AVATAR_CATEGORIES,
  AVATAR_PARTS,
  AVATAR_REQUIRED_CATEGORIES,
  EYE_RECOLOR_SHAPES,
  HAIR_RECOLOR_SHAPES,
  HEX_COLOR_RE,
  AGENT_TYPES,
  EDITABLE_AGENT_SOURCES,
  isEditableAgentSource,
} from "../core/contracts.js";

export type {
  MaestroConfigV3,
  MaestroInstanceV3,
  MaestroNodeV3,
  MaestroEdgeV3,
  MaestroWorkflowV3,
  MaestroRuleV3,
  MaestroWorkflowsSlice,
  MaestroRulesSlice,
  MaestroGates,
  MaestroGatesSlice,
  MaestroProjectTagsSlice,
  MaestroReportEntry,
  MaestroReportsSlice,
  DiscoveredDefinition,
  ProjectRule,
  TreeNode,
  MaestroTask,
  SessionLogEntry,
  ChannelDelivery,
  PendingLane,
  SaveResult,
  RepoDetection,
  ConfigIssue,
  InstallStatus,
  InstallReport,
  ReportSyncSummary,
  ResolvedReport,
  ReportDefault,
  HandoffSyncSummary,
  ResolvedHandoff,
  ResolvedHandoffRoute,
  HandoffDefault,
  HandoffDefaultsListing,
  UninstallPlan,
  UninstallReport,
  ClaudeRequest,
  ClaudePreview,
  ClaudeWriteTarget,
  ClaudeReadScope,
  ClaudeReadDirectory,
  ClaudePermissionRule,
  HandoffContext,
  ReadScopeOrigin,
  SettingsTier,
  SettingsPermissions,
  SettingsSourceInfo,
  ClaudeOutputChunk,
  ClaudeRunResult,
  PermissionAnswer,
  PermissionChoice,
  PermissionDetail,
  PermissionDiff,
  PermissionOutcome,
  PermissionPrompt,
  AgentQuestion,
  AgentQuestionOption,
  QuestionChoice,
  QuestionPrompt,
  QuestionSelection,
  RefusalSource,
  ResumableSession,
  ResumeDisclosure,
  ResumeRead,
  GrantScope,
  SessionGrant,
  SessionGrantOption,
  SessionPermissionUpdate,
  SessionEffort,
  SessionEndReason,
  SessionEvent,
  SessionInfo,
  SessionModel,
  SessionSpend,
  SessionWrite,
  SpendCeiling,
  CreateOptions,
  CreateRequest,
  MarketplaceEntry,
  ScaffoldResult,
  InstalledPluginInfo,
  MarketplacePluginInfo,
  DefinitionSummary,
  CuratedPlugin,
  RuleLibraryEntry,
  ClaudeCommand,
  DocMeta,
  DocSection,
  DocContent,
  GlobalDocsData,
  CcusageSource,
  UsageStats,
  UsageStatsPreview,
  UsageStatsResult,
  UsageStatsView,
  UsageTotals,
  AvatarCategory,
  AvatarPartOption,
  AvatarLayers,
  AgentType,
  AgentDescriptionResult,
  AgentContentResult,
  AgentForkResult,
  AgentForkRecord,
  AgentSyncAction,
  AgentSyncApplyResult,
  AgentSyncEntry,
  AgentSyncSummary,
  DiffLine,
};

/** A project the app has opened, as remembered in the recent-projects list. */
export interface ProjectRef {
  root: string;
  name: string;
  lastOpened: string;
}

export interface ProjectState {
  /** null before the user has picked a project. */
  current: ProjectRef | null;
  recent: ProjectRef[];
}

/** Everything the /workflows route needs to render, in one round trip. */
export interface WorkflowsData {
  projectRoot: string;
  config: MaestroConfigV3;
  /**
   * True when the project has no maestro.json and `config` is the starter seed rather than
   * anything on disk. The canvas opens populated, but nothing is persisted until the user saves.
   */
  seeded: boolean;
  /**
   * How the starter chain was chosen, and why — null once the project has a `maestro.json`, since
   * the config on disk is the user's answer and re-deriving one would be noise.
   *
   * Carried on the same payload as the seed rather than fetched from its own channel: the evidence
   * has to describe the chain the canvas is actually showing, and two round trips could disagree.
   */
  detection: RepoDetection | null;
  agents: DiscoveredDefinition[];
  skills: DiscoveredDefinition[];
  /**
   * Duplicate-agent-type collisions in `config` (`041`) — the canvas itself refuses to create one,
   * so this is what catches a hand-edit or a merge conflict that did. Empty on a healthy config.
   */
  configIssues: ConfigIssue[];
}

/** Everything the /rules route needs. */
export interface RulesData {
  projectRoot: string;
  config: MaestroConfigV3;
  seeded: boolean;
  tree: TreeNode[];
  projectRules: ProjectRule[];
  vibeRules: string[];
  /** False when the vibe-rules CLI isn't on PATH — the UI says so instead of listing nothing. */
  vibeRulesAvailable: boolean;
}

/**
 * Everything the /tools dashboard needs, in one round trip.
 *
 * ONE channel for four tabs, not four channels. help-server fetched each of these from its own
 * `createServerFn` and paid for it twice over: `getProjectMarketplace` and `getCuratedPlugins`
 * each re-read `installed_plugins.json` to decide their own `isInstalled` flags. The same lesson
 * as /rules in M2 — a view's tabs are one view, and a payload assembled in one pass cannot have
 * two tabs disagreeing about what is installed.
 */
export interface ToolsData {
  /** "" when no project is open; the route says so rather than rendering four empty tables. */
  projectRoot: string;
  installedPlugins: InstalledPluginInfo[];
  projectMarketplace: MarketplacePluginInfo[];
  curated: CuratedPlugin[];
  ruleLibrary: RuleLibraryEntry[];
  commands: ClaudeCommand[];
  /** The global Marketplace tab's primary content — every marketplace known to this machine. */
  marketplaces: MarketplaceEntry[];
  /** The new Rules tab: local-only, since no global rule tier exists anywhere in this codebase. */
  projectRules: ProjectRule[];
  agents: DiscoveredDefinition[];
  skills: DiscoveredDefinition[];
}

/** The doc list and the search corpus — both of which every docs view needs at once. */
export interface DocsData {
  projectRoot: string;
  docs: DocMeta[];
  /**
   * Every doc split at its headings. Carried alongside the list rather than fetched when the user
   * starts typing: search has to answer on the first keystroke, and the corpus is the same bytes
   * the list was built from, so a second read could only introduce a disagreement.
   */
  sections: DocSection[];
}

/** What `/maestro`'s post-install Project Tags section needs, in one round trip. */
export interface ProjectTagsData {
  /** The full global catalog — every entry the /templates tab has added. */
  catalog: string[];
  /** The open project's own `maestro.json.project_tags`, or `[]` when absent. */
  selected: string[];
}

/**
 * What `/maestro`'s Step 1 gates card needs, and what it writes back. Half of the pair that drives
 * the orchestrator's injected Step 1: the app writes `maestro.json.gates` here, and
 * `maestro-step1-gates.cjs` reads it at invocation time and prints the one directive line the
 * skill body injects. Nothing else connects the two — there is no shared code path.
 */
export interface GatesData {
  /** Resolved, never raw: an absent, partial or corrupt `gates` block reads back as both false. */
  gates: MaestroGates;
}

export type SaveInput =
  | { sliceType: "workflows"; slice: MaestroWorkflowsSlice }
  | { sliceType: "rules"; slice: MaestroRulesSlice }
  | { sliceType: "project-tags"; slice: MaestroProjectTagsSlice }
  | { sliceType: "gates"; slice: MaestroGatesSlice };

export const IPC = {
  projectGet: "project:get",
  projectPick: "project:pick",
  projectOpen: "project:open",
  projectForget: "project:forget",

  workflowsData: "data:workflows",
  workflowsReseed: "data:reseed",
  rulesData: "data:rules",
  toolsData: "data:tools",
  docsData: "data:docs",
  docContent: "data:doc",
  // The global Docs page's two corpora, NOT gated on an open project — see `src/core/global-docs.ts`.
  // A separate pair from `docsData`/`docContent` rather than the same channel widened, because the
  // per-project reader's slug space and the global one's are different files on disk; a single
  // channel would have to smuggle "which corpus" into what is otherwise the same shape.
  globalDocsData: "data:global-docs",
  globalDocContent: "data:global-doc",
  configSave: "config:save",

  // `/maestro`'s post-install Project Tags section: the global catalog plus the OPEN project's own
  // selection, in one round trip — no route loader here, this page fetches imperatively like its
  // existing `install:status` call. `project:tags:set` is the write path: saves the project-tags
  // slice, then unions in any bundled agent that newly matches one of the ADDED tags (never removes
  // one on uncheck — that stays a manual /workflows edit). See `project:tags:set` in `main/ipc.ts`.
  projectTagsData: "data:project-tags",
  projectTagsSet: "project:tags:set",

  // `/maestro`'s Step 1 gates checkboxes — the pair that drives the orchestrator's INJECTED Step 1.
  // `data:gates` reads the project's resolved gates (both off when no project is open, so the card
  // can render on a route reachable in that state); `project:gates:set` saves the `gates` slice and
  // returns what was saved. Unlike `project:tags:set` there is no second cross-slice write: a gate
  // flag implies nothing about which agents or skills the project has.
  gatesData: "data:gates",
  gatesSet: "project:gates:set",

  // The /agents page. `reportGet` resolves what's in effect for one agent (project override, else
  // global default, else none) — the SAME resolution `report-resolution.ts` gives the
  // SubagentStart hook, so the page can never show something other than what a run would actually
  // receive. `reportSave` is a plain file write, no Claude session, no token — same shape as the
  // /rules save path: it always writes a PROJECT override keyed by the agent's own name.
  reportGet: "report:get",
  reportSave: "report:save",

  // The /templates page's Reports tab — the GLOBAL tier's own write path, distinct from the pair
  // above. `reportGet`/`reportSave` always resolve/write a PROJECT override for one agent in the
  // OPEN project; these edit the machine-wide fallback every project without an override receives,
  // and need no project open at all. `templateReportsList` wraps `readAllAgentReportDefaults` —
  // every agent with a global default, keyed by agent name. `templateReportSave` calls the new
  // `writeAgentReportDefault`: a plain sqlite write, no Claude session, no token, same as
  // `reportSave` — it just bumps the edited report's `version` in the `reports` table instead of
  // writing a project file, which is what lets `report-sync.ts`'s existing staleness check pick up
  // the change on a project's next install/update.
  templateReportsList: "template:reports:list",
  templateReportSave: "template:reports:save",

  // The /templates page's Handoffs tab — the same pair one tier over, plus a DELETE, because a
  // handoff default has a full lifecycle where a report default does not: the pair roster is the
  // bundled agents crossed with themselves, so the user can create one Maestro never shipped, and
  // anything creatable has to be removable. `templateHandoffDelete` refuses a SEEDED id (main's
  // check, not the tab's) — `SEED_HANDOFFS` is the store's floor and `seedIfEmpty` only fires on a
  // store that has never been written to, so deleting a shipped pair would be irreversible. The
  // tab offers "Reset to default" for those instead, which is an ordinary save of the seed body.
  //
  // `templateHandoffsList` returns the rows AND the seeded id list (`HandoffDefaultsListing`):
  // `isSeededHandoff` lives in `handoff-seeds.ts`, which the renderer cannot import.
  templateHandoffsList: "template:handoffs:list",
  templateHandoffSave: "template:handoffs:save",
  templateHandoffDelete: "template:handoffs:delete",

  // The Handoffs tab's own project picker (`043`): a LOCAL "which project am I viewing" the tab
  // added for itself, distinct from every other channel on this page, which stays global. Reads
  // the same `agents_available` `readAgentsAvailable` already gives the concept-skills CLI — no
  // new store. `projectRoot` is validated the same way `data:tools`'s is: it must name the current
  // or a recent project, or the call falls back to the open project (or `[]` with none open).
  templateAgentsAvailable: "template:agents-available",

  // /agents' Interactions pane — the PROJECT tier for handoffs, exactly as `reportGet`/`reportSave`
  // are for reports. `handoffRoutes` answers "which routes leave this agent, and what template is
  // in effect for each" in one round trip, because the graph walk (`handoff-routes.ts`) is not
  // renderer-safe and a per-route resolve would reopen the global store once per row.
  // `handoffSave` always writes `.claude/handoffs/<sender>/<receiver>.md` and DROPS `syncedFrom`.
  handoffRoutes: "handoff:routes",
  handoffSave: "handoff:save",

  // The /templates page's Agent Types tab — backed by `agent-types.ts`'s own
  // `~/.claude/maestro-agent-types.sqlite`. `templateAgentTypesList` wraps `readAllAgentTypes`;
  // `templateAgentTypeSave` wraps `setAgentType` — a plain replace, not a version bump, since an
  // agent type has no project-tier counterpart for any sync step to compare against.
  //
  // ALSO the channel `/agents` reads/writes an agent's type through (`030`) — see `MaestroApi`'s
  // `templates` doc comment for the `projectScoped` flag that tells the two apart.
  templateAgentTypesList: "template:agent-types:list",
  templateAgentTypeSave: "template:agent-types:save",

  // The /templates page's Project Tags tab — a global CATALOG (add/remove, not per-item
  // assignment like the Reports/Agent Types pairs above), backed by `project-tags.ts`'s own
  // `~/.claude/maestro-project-tags.sqlite`. Seeded with backend/frontend/mobile — the same three
  // categories detect.ts's evidence matching looks for. Consumed by a project's own `project_tags`
  // (see `projectTagsData`/`projectTagsSet` above) and by the per-agent assignment below.
  templateProjectTagsList: "template:project-tags:list",
  templateProjectTagAdd: "template:project-tags:add",
  templateProjectTagRemove: "template:project-tags:remove",

  // The SAME tab's second section: which of the catalog's tags (or "global") each bundled/project
  // agent belongs to — a one-per-agent assignment backed by its own
  // `~/.claude/maestro-agent-project-tags.sqlite` (agent-project-tags.ts). Distinct from the
  // Agent Types tab's unrelated developer/planner/reviewer/annotator/tester classification, and
  // called "project tag" rather than "agent type" for exactly that reason — that name was taken.
  //
  // ALSO the channel `/agents` reads/writes an agent's project tag through (`030`) — see
  // `MaestroApi`'s `templates` doc comment for the `projectScoped` flag that tells the two apart.
  templateAgentProjectTagsList: "template:agent-project-tags:list",
  templateAgentProjectTagSave: "template:agent-project-tags:save",

  // Set one skill's two tag dimensions in the global (`~/.claude/maestro-skill-tags.sqlite`)
  // store — see `src/core/skill-tags.ts`. No project involved: a skill's tags are the same in
  // every project. Two channels, mirroring the two independent pill rows in the Skills tab.
  skillProjectTagsSet: "skill-tags:project-tags:set",
  skillAgentTypesSet: "skill-tags:agent-types:set",

  // An agent's cosmetic avatar in the `~/.claude/maestro-avatars.sqlite` store — see
  // `src/core/avatar-store.ts`. No token: purely cosmetic, keyed by the agent's name, same as
  // `skillProjectTagsSet` is keyed by skill id — global by default, project-scoped (`030`) when
  // called with `projectScoped: true`. All three of get/set/list take it, so a project-tier
  // agent's avatar cannot be written to one tier and read back from the other.
  // See `MaestroApi.avatar`'s doc comment.
  avatarGet: "avatar:get",
  avatarSet: "avatar:set",
  // Every stored avatar in one round trip — the /agents list draws a thumb per row, and a per-row
  // `avatar:get` would open the sqlite store once per agent on every render.
  avatarList: "avatar:list",

  // The /agents card's Description field. The ONE channel that edits a subagent definition in
  // place: unlike an agent's type, project tag or avatar — Maestro's own metadata, kept in global
  // sqlite stores keyed by agent name — a description is the frontmatter line Claude Code itself
  // reads to decide when to dispatch the agent, so an override kept beside the file would make
  // this page show one sentence while every run used another. Resolves the file through
  // `discoverAgents`' own tier order and refuses any tier this app does not own — see
  // `src/core/agent-descriptions.ts`.
  agentDescribe: "agent:describe",

  // "Fork into this project" — the card's escape hatch for the three tiers `agent:describe`
  // refuses. A read (resolve the template through `discoverAgents`' own tier order) plus a write
  // to `.claude/agents/<name>.md`, no Claude session, no token — same shape as `reportSave`. See
  // `src/core/agent-fork.ts`.
  agentFork: "agent:fork",

  // `031` — keeping a fork in step with the template it came from. TWO channels for the same
  // reason install/status and install/run are two: `agent:sync` is a pure READ that computes a
  // summary on project selection and writes nothing to `.claude/agents/` (those files may be
  // committed, and a diff nobody asked for is hard to explain), while `agent:sync:apply` writes
  // exactly one agent, for exactly one explicit review action. See `src/core/agent-sync.ts`.
  agentSync: "agent:sync",
  agentSyncApply: "agent:sync:apply",

  // The /agents page's Content tab — the selected agent's markdown BODY (everything after the
  // closing frontmatter `---`), read-only, resolved through the same tier order `agentDescribe`
  // walks. See `src/core/agent-descriptions.ts`'s `getAgentBody`.
  agentContent: "agent:content",

  // The Content tab's write path (`045`) — the eighth write path in the /agents edit session,
  // gated on the SAME `isEditableAgentSource` check as `agentDescribe`. Preserves the frontmatter
  // block byte-for-byte and rewrites only the body beneath it — the inverse of what `agentDescribe`
  // does. See `src/core/agent-descriptions.ts`'s `setAgentContent`.
  agentContentSave: "agent:content:save",

  tasksList: "tasks:list",
  tasksClose: "tasks:close",

  createOptions: "create:options",
  createScaffold: "create:scaffold",

  installStatus: "install:status",
  installRun: "install:run",
  // Task 027: the cheap runtimeVersion check + refresh, run automatically on project selection.
  // A separate channel from installRun so `install:status` stays a pure read — see InstallProvider.
  installAutoRefresh: "install:auto-refresh",
  installUninstallPlan: "install:uninstall-plan",
  installUninstall: "install:uninstall",

  // Two channels, deliberately not one. `claude:preview` builds the prompt and cannot spawn;
  // `claude:run` spawns and cannot build. See MaestroApi.claude below.
  claudePreview: "claude:preview",
  claudeRun: "claude:run",
  claudeCancel: "claude:cancel",

  // The session pane. NOT a third half of the bridge above: a previewed run needs a token because
  // main authored the prompt and the user approved it, and a session turn needs none because the
  // user typed it. `session:say` therefore carries a user input value and nothing else — that is
  // the invariant, restated, and `test/isolation.test.ts` pins the call site.
  sessionStart: "session:start",
  // Continue a create-* form's work in the pane. It takes the PREVIEW TOKEN and nothing else — the
  // same discipline as `claude:run`, applied to the one thing that can widen what a session may
  // write. See `MaestroApi.session.handoff`.
  sessionHandoff: "session:handoff",
  sessionSay: "session:say",
  sessionStop: "session:stop",
  // The answer to one parked permission request. A CHOICE, not a permission result — see
  // `PermissionChoice`, and `MaestroApi.session.answer` below.
  sessionPermission: "session:permission",
  // The answer to one parked QUESTION. Its own channel rather than a fifth arm of `PermissionChoice`
  // — the two asks share a registry and nothing else, and a channel that meant "allow this write"
  // and "I pick option B" would be one field pulling in two directions. What crosses is a SELECTION
  // (which question, which labels), never an answers payload — see `MaestroApi.session.answerQuestion`.
  sessionQuestion: "session:question",
  // Take back a directory the user granted earlier in this session. Narrows only: it can remove an
  // entry from the grant list and has no shape by which it could add one.
  sessionRevoke: "session:revoke",
  // THE DOOR IN THE SPEND CEILING (`024`). A session that reached its ceiling ended cleanly and left
  // its transcript on disk; this resumes THAT conversation with a fresh allowance. It carries the
  // session id and nothing else — the id to resume against, the figures and the scope all come off
  // the record main is already holding, so a renderer can no more choose what a continuation
  // inherits than it can choose a prompt.
  sessionContinue: "session:continue",
  // PICKING UP A CONVERSATION THIS APP DID NOT START (`025`) — three channels, in the order the user
  // meets them. `session:resumable` lists what the CLI's own store holds for the open project;
  // `session:resume-detail` walks ONE transcript and says what it already read and what replaying it
  // costs; `session:resume` attaches to it, forking so the terminal session keeps its own history.
  // All three carry a session ID and nothing else, and the id must be one main published on the
  // list — this is the one place on the surface where an id names something main has no record of,
  // which is exactly why it is checked rather than resolved.
  sessionResumable: "session:resumable",
  sessionResumeDetail: "session:resume-detail",
  sessionResume: "session:resume",
  // The two levers the header can move on a live session. Both carry a value from a list MAIN
  // published — an effort level from a closed set, a model id from the CLI's own `supportedModels()`
  // — and both leave the conversation exactly where it is.
  sessionEffort: "session:effort",
  sessionModel: "session:model",
  sessionEnd: "session:end",
  sessionInfo: "session:info",

  // Usage stats, in the same two halves and for the same reason: with no local `ccusage`, running
  // one means fetching a package from npm and executing it, so what would run is returned before
  // anything does. See src/core/ccusage.ts.
  statsPreview: "stats:preview",
  statsRun: "stats:run",

  logSubscribe: "log:subscribe",
  logUnsubscribe: "log:unsubscribe",

  // `/maestro`'s Channels block (`037`) — every `.claude/channels/<receiver>/` lane holding at
  // least one undelivered file, right now. READ-ONLY: `036`'s hooks are the only thing that
  // delivers, retires or sweeps a channel file; this just reads `handoff-channels.ts`'s
  // `pendingLanes()`, the same functions those hooks use, re-exported to the app.
  channelsPending: "channels:pending",

  revealInFolder: "shell:reveal",
} as const;

/** Push channels: main → renderer. */
export const IPC_EVENTS = {
  claudeOutput: "claude:output",
  sessionEvent: "session:event",
  logInit: "log:init",
  logEntry: "log:entry",
  logReset: "log:reset",
  projectChanged: "project:changed",
} as const;

/** The surface exposed on `window.maestro` by the preload script. */
export interface MaestroApi {
  project: {
    get(): Promise<ProjectState>;
    /** Opens a native directory picker. Resolves null if the user cancels. */
    pick(): Promise<ProjectState | null>;
    open(root: string): Promise<ProjectState>;
    forget(root: string): Promise<ProjectState>;
    onChanged(cb: (state: ProjectState) => void): () => void;
    gates: {
      /**
       * Set the OPEN project's Step 1 gates to exactly `gates` — `/maestro`'s Step 1 gates card
       * calls this on EVERY checkbox change, with no Save button. Saves the `gates` slice and
       * nothing else, and returns what was saved. Rejects when no project is open.
       */
      set(gates: MaestroGates): Promise<MaestroGates>;
    };
    tags: {
      /**
       * Toggle the OPEN project's `project_tags` to exactly `tags` — `/maestro`'s post-install
       * section calls this on every checkbox change. Saves the project-tags slice, then unions in
       * any agent whose stored `agent-project-tags.ts` assignment newly matches one of the ADDED
       * tags into `agents_available` (never removes one on uncheck — that stays a manual
       * `/workflows` edit). Returns the resulting `project_tags`. Rejects when no project is open.
       */
      set(tags: string[]): Promise<string[]>;
    };
  };
  data: {
    workflows(): Promise<WorkflowsData>;
    /**
     * Rebuild the starter config around a different implementation-agent chain — what the user
     * corrected the detection to. Pure: it writes nothing, so the canvas can be re-seeded as often
     * as the user changes their mind, and the project stays unconfigured until they press Save.
     */
    reseed(implAgents: string[]): Promise<MaestroConfigV3>;
    rules(): Promise<RulesData>;
    /**
     * The /tools dashboard's four tabs. Never rejects: an absent file is an empty section.
     *
     * `projectRoot`, when given, must name the CURRENT project or one from the recent list — main
     * validates it against that allowlist and falls back to the open project on anything else. It
     * is how a view-without-switching UI asks about a project other than the one this window has
     * open; omit it and this behaves exactly as before.
     */
    tools(projectRoot?: string): Promise<ToolsData>;
    /** The doc list plus the search corpus. Never rejects; a project with no docs/ returns []. */
    docs(): Promise<DocsData>;
    /**
     * One doc's body. REJECTS — on a bad slug, a missing file, or an unreadable one — because a
     * reader that renders a blank page for all three tells the user nothing. Call it through
     * `callMain` and show the reason.
     */
    doc(slug: string): Promise<DocContent>;
    /**
     * The global Docs page's landing data: both corpora's doc lists plus the combined search
     * index. NOT gated on an open project — see `GlobalDocsData`. Never rejects; a corpus whose
     * directory hasn't resolved in this build contributes an empty list rather than failing the
     * whole page.
     */
    globalDocs(): Promise<GlobalDocsData>;
    /**
     * One doc's body from the global corpus. REJECTS on an invalid slug, a missing file, or an
     * unreadable one — same discipline as `doc` above, and for the same reason.
     */
    globalDoc(group: "app", slug: string): Promise<DocContent>;
    /**
     * `/maestro`'s post-install Project Tags section: the global catalog plus the OPEN project's
     * own `project_tags` selection, in one round trip. Never rejects; no project open reads back
     * `selected: []`.
     */
    projectTags(): Promise<ProjectTagsData>;
    /**
     * `/maestro`'s Step 1 gates card: the open project's RESOLVED gates. Never rejects — no
     * project open, or an absent/corrupt `gates` block, both read back as two falses, which is
     * exactly what the runtime script resolves them to as well.
     */
    gates(): Promise<GatesData>;
  };
  config: {
    save(input: SaveInput): Promise<SaveResult>;
  };
  /**
   * The /agents page. `get` resolves what's in effect for one agent — project override, else
   * global default, else none. `save` is a plain file write (no Claude session, no
   * `claude:preview`/`run`, no token): it always writes `.claude/reports/<agentName>.md` and
   * records the entry keyed by that SAME agent name, never an inherited global id.
   */
  reports: {
    get(agentName: string): Promise<ResolvedReport>;
    save(agentName: string, content: string): Promise<ResolvedReport>;
  };
  /**
   * The /agents page's Interactions pane — the same pair as `reports` above, one tier over.
   *
   * `routes` is deliberately not a `get(handoffId)`: the pane lists one entry per outgoing route
   * from the project's graph, and the walk that produces that list (`handoff-routes.ts`) is not
   * renderer-safe. It comes back already resolved, so the pane makes ONE round trip per selection
   * rather than one plus one per row.
   *
   * `save` takes the `"<sender>/<receiver>"` id the route it came from carries, and always writes
   * this project's own `.claude/handoffs/<sender>/<receiver>.md`, dropping `syncedFrom` — a
   * hand-authored save stops tracking the global default and becomes the project's answer.
   */
  handoffs: {
    routes(agentName: string): Promise<ResolvedHandoffRoute[]>;
    save(handoffId: string, content: string): Promise<ResolvedHandoff>;
  };
  /**
   * The /templates page — the GLOBAL tier's write path, and the reason it is its own namespace
   * rather than a widened `reports.*` above: that pair always resolves/writes a PROJECT override
   * for the OPEN project, and this always edits the machine-wide fallback tier every project
   * without an override falls back to. No project needed — nothing here is gated on one being open.
   *
   * `agentTypes` and `agentProjectTags` are also where `/agents` reads and writes an agent's
   * classification, with a different intent (`030`): a `user`/`maestro`/plugin-tier agent is the
   * same agent everywhere, so editing it from either page writes the one shared global row — but a
   * `project`-tier agent is one project's own file, and `/agents` passes `projectScoped: true` for
   * one of those so its row can't be read back from, or overwritten by, another project. `/templates`
   * never passes it and always sees/edits the global tier, exactly as before.
   */
  templates: {
    reports: {
      /** Every agent with a global default, keyed by agent name. */
      list(): Promise<Record<string, ReportDefault>>;
      /**
       * Upsert one agent's global default. A plain write — no Claude session, no
       * `claude:preview`/`run`, no token — that bumps the report's `version`.
       */
      save(agentName: string, content: string): Promise<ReportDefault>;
    };
    /**
     * The Handoffs tab. Same tier and same intent as `reports` above, plus the lifecycle a report
     * default has no need of: the pair roster is a user-picked project's own `agents_available`
     * (`043`; `agentsAvailable` below is how the tab reads it), so a user can author a route for
     * agents Maestro never shipped, and anything creatable must be removable.
     *
     * `list` carries the seeded id set alongside the rows because `isSeededHandoff` lives behind
     * the `src/core` boundary. `save` upserts — writing an id with no row inserts it at version 1,
     * which is how a pair is created. `remove` REFUSES a seeded id: `SEED_HANDOFFS` is the store's
     * floor and a delete of a shipped pair could not be undone, so the tab offers those a Reset to
     * default (an ordinary `save` of the seed body) instead.
     */
    handoffs: {
      list(): Promise<HandoffDefaultsListing>;
      save(handoffId: string, content: string): Promise<HandoffDefault>;
      remove(handoffId: string): Promise<void>;
    };
    /**
     * The Handoffs tab's pair-roster source (`043`). Reads ONE project's `agents_available` — the
     * project is whichever one the tab is locally viewing, never the app's globally-open project
     * (picking one here must not call `project.open`/`pick`). `projectRoot` must name the current
     * or a recent project; anything else falls back to the open project, and no project open (or
     * none picked yet) reads back `[]` rather than rejecting — the tab disables Create on empty.
     */
    agentsAvailable(projectRoot: string): Promise<string[]>;
    /** The Agent Types tab: one type per agent, global by default — see the namespace doc above. */
    agentTypes: {
      /**
       * Every agent's type, keyed by agent name. `projectScoped: true` (only ever from `/agents`)
       * overlays the OPEN project's own project-tier rows on top of the global ones.
       */
      list(projectScoped?: boolean): Promise<Record<string, AgentType>>;
      /**
       * Replace one agent's type with `tag`. `projectScoped: true` writes the OPEN project's own
       * row instead of the global one — pass it only when the agent being edited is project-tier.
       */
      save(agentName: string, tag: AgentType, projectScoped?: boolean): Promise<AgentType>;
    };
    /**
     * The Project Tags tab: a global catalog, not a per-item assignment — add/remove a tag name,
     * seeded with backend/frontend/mobile. `add`/`remove` both return the full catalog after the
     * change, so the tab renders the store's own echo rather than predicting it from the click.
     */
    projectTags: {
      list(): Promise<string[]>;
      add(tag: string): Promise<string[]>;
      remove(tag: string): Promise<string[]>;
    };
    /**
     * The SAME tab's second section: one project tag (or "global") per agent — the OTHER half of
     * the project ↔ agent mapping, distinct from `agentTypes` above. `save` returns the stored
     * value back, same echo discipline as `agentTypes.save`. Same `projectScoped` discipline too.
     */
    agentProjectTags: {
      /** Every agent's project tag, keyed by agent name. */
      list(projectScoped?: boolean): Promise<Record<string, string>>;
      /** Replace one agent's project tag with `tag` (a catalog entry, or "global"). */
      save(agentName: string, tag: string, projectScoped?: boolean): Promise<string>;
    };
  };
  /**
   * Skill tags — global, keyed by skill id, edited from the /skills page. Two independent
   * dimensions (project tags, agent types), each returning the stored (deduped, sorted) values
   * back so the page trusts the store's echo over its own click.
   */
  skillTags: {
    setProjectTags(skillId: string, tags: string[]): Promise<string[]>;
    setAgentTypes(skillId: string, tags: string[]): Promise<string[]>;
  };
  /**
   * An agent's cosmetic avatar — global by default, keyed by agent name, edited from the
   * create-subagent form and the /agents detail pane. `get` resolves null when nothing has been
   * saved for that name yet.
   *
   * `projectScoped: true` (`030`) scopes all three calls to the OPEN project instead of the global
   * tier — pass it only when the agent is project-tier (a `target: "project"` create-subagent, or
   * an `/agents` edit of a project agent); a `user`/`maestro`/plugin-tier agent's avatar stays the
   * one shared global row.
   */
  avatar: {
    get(agentName: string, projectScoped?: boolean): Promise<AvatarLayers | null>;
    set(agentName: string, layers: AvatarLayers, projectScoped?: boolean): Promise<AvatarLayers>;
    /** Every agent with a saved avatar, keyed by agent name. Agents without one are simply absent. */
    list(projectScoped?: boolean): Promise<Record<string, AvatarLayers>>;
  };
  /**
   * An agent's own `description`, written back into the `.md` it was discovered in. REJECTS rather
   * than no-opping when the agent has no definition file, when its tier is not one of
   * `EDITABLE_AGENT_SOURCES` (an installed plugin's agents live in a cache the next update
   * overwrites), when the file is read-only (a packaged build's bundled agents), or when its
   * frontmatter uses a description shape this app can't rewrite without corrupting it. Echoes back
   * the normalized description and the file it changed.
   */
  agents: {
    describe(agentName: string, description: string): Promise<AgentDescriptionResult>;
    /**
     * Fork a `user`/`maestro`/plugin-tier agent into this project's `.claude/agents/`. `newName`
     * defaults to the template's own name — shadowing, not a rival: a project agent with the same
     * name wins `discoverAgents`' own tier order, so the list shows one row, sourced from the
     * project. A different `newName` writes a coexisting agent instead, with its frontmatter
     * `name:` rewritten to match.
     *
     * Rejects when the agent is already project-tier (nothing to fork FROM), when `newName` isn't
     * kebab-case, or when it collides with a file already in `.claude/agents/`.
     */
    fork(agentName: string, newName?: string): Promise<AgentForkResult>;
    /**
     * Which of this project's forked agents are still in step with their template (`031`).
     *
     * A pure read — it writes nothing, so it is safe to run on every project selection. The verdict
     * per agent comes from the same `decideSync` the report sync uses, so this page, the `/maestro`
     * count and the `maestro`/`maestro-update` skills cannot disagree about whether a fork is stale.
     * An agent with no provenance record — hand-authored, or detached — is not in the result at all.
     */
    sync(): Promise<AgentSyncSummary>;
    /**
     * Apply ONE review action to ONE forked agent: `update` (take the new body, keep my
     * description), `keep` (leave it, stay tracked, ask again next version) or `detach` (drop the
     * provenance record — it is just a project agent now). The only call in this namespace that
     * rewrites an agent's `.md`, and it does so one agent at a time on purpose.
     */
    syncApply(agentName: string, action: AgentSyncAction): Promise<AgentSyncApplyResult>;
    /**
     * The Content tab's one round trip: the selected agent's markdown BODY — everything after the
     * closing frontmatter `---`, for a file resolved through the same tier order `describe` walks
     * (project, user, maestro/bundled, then every installed plugin). Rejects when no tier has a
     * definition file for the name, the same "a stale list" failure `describe` reports.
     */
    content(agentName: string): Promise<string>;
    /**
     * The Content tab's write path (`045`) — the eighth write path in the /agents edit session.
     * Rejects on the same grounds as `describe` (no definition file, an un-editable tier, a
     * read-only file), and preserves the frontmatter block byte-for-byte, rewriting only the body
     * beneath it — the inverse of what `describe` rewrites. The body is written verbatim, with no
     * normalization: unlike a description it is not a single frontmatter line.
     */
    saveContent(agentName: string, content: string): Promise<AgentContentResult>;
  };
  tasks: {
    list(): Promise<MaestroTask[]>;
    close(filename: string): Promise<MaestroTask[]>;
  };
  /**
   * The four create-* forms. Two operations, mirroring the bridge's own split for the same reason:
   * one of them writes, and it is not the one that can reach a model.
   *
   * `scaffold` does everything deterministic — the directory, the frontmatter, the manifest, the
   * marketplace registration — and returns what it wrote. No model is involved and none can be:
   * the module behind it calls nothing. The artifact exists the moment the user presses Create.
   *
   * Whatever is left (a skill's prose, an agent's system prompt) is a `ClaudeRequest` like any
   * other, so it goes out through `claude.preview` and the confirmation dialog. These routes have
   * no spawn path of their own; that is the point, since a route that shelled out directly would
   * have opted out of the preview the user is owed.
   */
  create: {
    /** The marketplaces and plugins the selectors offer, read from ~/.claude at call time. */
    options(): Promise<CreateOptions>;
    /**
     * Write the deterministic part. Rejects on an invalid request and on a failed write — and a
     * failed write leaves the disk as it found it, so the caller reports a reason rather than
     * discovering a half-made artifact later.
     */
    scaffold(request: CreateRequest): Promise<ScaffoldResult>;
  };
  install: {
    /**
     * `projectRoot`, when given on any of these four, must name the CURRENT project or one from
     * the recent list — main validates it against that allowlist and falls back to the open
     * project on anything else, never throwing over a bad or stale one. Omit it and every one of
     * these behaves exactly as before, against the open project.
     */
    status(projectRoot?: string): Promise<InstallStatus>;
    /**
     * Install or update Maestro's runtime in the open project. Idempotent, and rejects (rather
     * than half-writing) when it cannot proceed — so the caller must go through `callMain`.
     */
    run(projectRoot?: string): Promise<InstallReport>;
    /**
     * Task 027: refresh the runtime IFF it's already installed and its stamped `runtimeVersion`
     * doesn't match what the app ships — the cheap comparison, decoupled from `status()`'s content
     * hashes, that lets a project already current cost zero file writes. Never installs fresh.
     * Resolves `null` when there was nothing to refresh (including "not installed at all").
     */
    autoRefresh(projectRoot?: string): Promise<InstallReport | null>;
    /**
     * What each level of an uninstall would remove, right now. Reads only — this is what fills
     * the purge confirmation, so it can name the files before anything is deleted.
     */
    uninstallPlan(projectRoot?: string): Promise<UninstallPlan>;
    /**
     * Remove the runtime. `purge` is the destructive level: it also deletes the orchestrator
     * skill, the copied scripts and `maestro.json`. `deleteMaestroTasks` is a second, independent
     * opt-in on top of that — it takes `.claude/maestro-tasks/` too, and only if `purge` is also
     * true. Both default to false ON THE MAIN SIDE too — the renderer has to ask for each
     * explicitly, so no call can turn into a purge, or take the task queue, by accident.
     *
     * `projectRoot` trails `opts` here rather than leading, so the existing
     * `uninstall({ purge, deleteMaestroTasks })` call sites keep type-checking untouched.
     */
    uninstall(opts?: { purge?: boolean; deleteMaestroTasks?: boolean }, projectRoot?: string): Promise<UninstallReport>;
  };
  /**
   * The `claude -p` bridge. Two operations, and the split is the security design.
   *
   * `preview` builds the prompt from a REQUEST — never from prompt text the renderer supplies —
   * and hands back the exact argv, the working directory, what may be written, whether the CLI
   * was found, and a single-use token. It cannot spawn: the main-process module behind it imports
   * no child_process, and `test/core/claude.test.ts` walks its import graph to keep it that way.
   *
   * `run` takes that token and NOTHING ELSE, so there is no argument by which a caller could make
   * the run differ from the preview the user confirmed. The property this buys is that the only
   * executable prompts are ones the user was shown; a renderer bug cannot invent one and run it.
   * Collapsing these into a single "run this prompt" call looks like a simplification and is the
   * removal of that guarantee.
   */
  claude: {
    preview(request: ClaudeRequest): Promise<ClaudePreview>;
    /**
     * Start the previewed run. `onOutput` fires as output arrives — these runs are minutes long,
     * so the UI must never wait for the resolve to show anything. Resolves with how it ended;
     * rejects only when the token is refused (forged, replayed, or expired).
     */
    run(token: string, onOutput: (chunk: ClaudeOutputChunk) => void): Promise<ClaudeRunResult>;
    /** Stop a run. Signals the child's whole process group, so the CLI's own children go too. */
    cancel(token: string): Promise<void>;
  };
  /**
   * The session pane — one live, multi-turn conversation per open project.
   *
   * The bridge above and this are the app's two ways to reach a model, and they differ in who
   * authored the prompt. A run executes a string MAIN built and the user approved, so it needs a
   * token to prove the two are the same string. A session turn is a string the USER TYPED, so
   * there is nothing to prove and nothing to preview — the guarantee restates as: `say` carries a
   * user input value and nothing else, and main stamps it as human-authored at the SDK boundary.
   *
   * What a session may do is fixed before it starts and reported by `start`: it reads the open
   * project and the marketplaces the app resolved, and it writes NOTHING. There is no call here by
   * which a renderer could widen either.
   */
  session: {
    /**
     * Start a session against the open project, replacing any this window already had. Rejects
     * when no project is open. Resolves with `id: null` when the CLI could not be found — the pane
     * says so rather than failing on the first send.
     */
    start(): Promise<SessionInfo>;
    /**
     * Continue a create-\* form's work here, with the token its confirmation dialog was built from.
     *
     * A TOKEN AND NOTHING ELSE — the only call on this surface that widens what the session may
     * write, and the reason it takes what `claude:run` takes. The invocation the token names carries
     * the artifact main resolved when it built the preview, so the directory that becomes writable
     * is the one the confirmation displayed and there is no argument here by which it could be
     * another. Single-use: a preview is spent headlessly or in the pane, never both.
     *
     * Starts a session if the window has none. Rejects on a refused token (forged, replayed,
     * expired) and on a preview that did not come from a create-\* form.
     */
    handoff(token: string): Promise<SessionInfo>;
    /** What a session in this window can see and do right now. Reads only; starts nothing. */
    info(): Promise<SessionInfo>;
    /** One turn, as the user typed it. False when the session is gone. */
    say(id: string, text: string): Promise<boolean>;
    /** Interrupt the turn in flight. The session stays usable. */
    stop(id: string): Promise<boolean>;
    /**
     * Answer a parked permission request.
     *
     * A CHOICE crosses, never a permission result. The SDK's own allow shape carries
     * `updatedPermissions` — blanket allow rules, `bypassPermissions`, a permanently widened read
     * scope, any of it saved into the user's repository or home directory — so the renderer sends
     * one of three words plus its reason and main constructs the answer. Same discipline as
     * `claude:run` taking a token: the boundary carries a decision, never a payload.
     *
     * False when the request is no longer pending — answered already, or the session ended under
     * it, both of which are ordinary rather than errors.
     */
    answer(id: string, requestId: string, choice: PermissionChoice): Promise<boolean>;
    /**
     * Answer a parked structured question.
     *
     * A SELECTION crosses — which question, which option labels — and never the payload the tool
     * reads. That payload is the one this app authors, and it is authored at the far end, inside
     * `startPaneSession`, out of the questions the SDK actually delivered: every label is checked
     * against the options the model offered and an unoffered one is refused rather than forwarded.
     * So the renderer picks from a list; it cannot write into it. Same shape as a grant carrying a
     * scope word and no path.
     *
     * The freeform arm (`{ choice: "reply", text }`) carries typed text, which this surface is
     * already allowed to carry — it is the same thing `say` carries, routed into the answer instead
     * of into a new turn.
     *
     * False when the question is no longer pending, and also when the selection was REJECTED; the
     * two are distinguished in the transcript, where a rejection arrives as a notice saying why.
     */
    answerQuestion(id: string, requestId: string, choice: QuestionChoice): Promise<boolean>;
    /**
     * Revoke a directory this session granted, naming it by path.
     *
     * A PATH crosses here and that is not the hole it looks like: main matches it against the grants
     * it is already holding and removes one, so an unrecognised path does nothing. The direction is
     * the guarantee — this call can only ever narrow what the session may read. Granting still goes
     * through `answer`, where the renderer sends a scope word and main resolves the path itself.
     *
     * False when no grant matches, or when the session is gone. Both are ordinary.
     */
    revoke(id: string, path: string): Promise<boolean>;
    /**
     * Continue a session that stopped at its spend or turn ceiling, with a fresh allowance.
     *
     * THE ID AND NOTHING ELSE, for the reason `handoff` takes only a token: what the continuation
     * inherits — the transcript to resume, the lifetime figures, the grants and the write scope —
     * is main's own record of the conversation that stopped, and there is no argument here by which
     * a renderer could name a different one or a larger allowance.
     *
     * Rejects when the id names no stopped session, and when it names one that ended some other way:
     * a session that failed is not a session that ran out of allowance.
     */
    continue(id: string): Promise<SessionInfo>;
    /**
     * The conversations Claude Code's own store holds for the open project, newest first (`025`).
     *
     * Reads only; starts nothing and costs nothing. Main asks the CLI for the store rather than
     * walking `~/.claude/projects` itself, drops everything whose recorded working directory is not
     * this project, and drops this window's own conversation — Continue is the door to that one.
     * The renderer names no directory and no file here: it gets a list, and may later send back one
     * `id` FROM that list.
     */
    resumable(): Promise<ResumableSession[]>;
    /**
     * What one of those conversations already read, and what replaying it costs.
     *
     * THE DISCLOSURE, AND IT IS ABOUT THE PAST. Every other disclosure in this app describes a
     * boundary in force; this one describes context that already exists and that the boundary cannot
     * retract — a transcript produced under the terminal session's rules can hold the contents of
     * files from anywhere on disk, and resuming puts them back in front of the model. The user is
     * shown this and can decline.
     *
     * Rejects on an id this window was not offered, and on one whose transcript has since gone.
     */
    resumeDetail(id: string): Promise<ResumeDisclosure>;
    /**
     * Attach to it, FORKING: the session the user started keeps its own history.
     *
     * An id and nothing else, and the id must be one `resumable()` published. What the new session
     * gets is what a fresh one gets — same tools, same read boundary, same `settingSources: []`,
     * same prompts — plus the transcript. What it does NOT get is anything about the old session's
     * permissions: no grants, nothing writable, and a fresh allowance, because none of that was
     * agreed to here.
     */
    resume(id: string): Promise<SessionInfo>;
    /**
     * Change how hard the model thinks, from the next turn. The transcript is untouched.
     *
     * A word from a closed set (`SessionEffort`), checked in main against the same list the session
     * was configured from. False when the session is gone or the word is not one of them.
     */
    setEffort(id: string, effort: SessionEffort): Promise<boolean>;
    /**
     * Change the model mid-conversation, from the list `SessionInfo.models` published.
     *
     * The id is validated against that list on the main side, so what crosses is a choice from
     * something this process produced rather than a model name the renderer invented — the same
     * discipline as a grant's scope word. `null` resets to the CLI's own default.
     */
    setModel(id: string, model: string | null): Promise<boolean>;
    /** End the session and reap the CLI's process group. */
    end(): Promise<void>;
    /**
     * Everything that happens in this window's session, in order.
     *
     * SINGLE-OWNER, like `log.subscribe` and for the same reason: main keys one session per
     * `webContents.id`, so a second subscriber would receive another owner's transcript. The owner
     * is `SessionProvider`, mounted once in `__root.tsx`.
     */
    subscribe(onEvent: (event: SessionEvent) => void): () => void;
  };
  /**
   * Usage stats, behind the same preview-then-run split as the bridge.
   *
   * The split is not ceremony copied from above: with no local `ccusage`, answering "what have I
   * spent?" downloads a package from npm and executes it on this machine. `preview` says so —
   * `network: true`, plus the exact argv and the PINNED version — and spawns nothing. `run` takes
   * the token that preview issued and nothing else, so the command that executes is the one that
   * was on screen. help-server did neither: `npx ccusage@latest` on every view, unannounced.
   */
  stats: {
    /** What would run, and whether it touches the network. Never rejects. */
    preview(view: UsageStatsView): Promise<UsageStatsPreview>;
    /**
     * Run the previewed command and reduce its output. Rejects only when the token is refused
     * (forged, replayed, expired, or issued for a Claude run rather than this one); a ccusage that
     * fails or answers in an unrecognised shape resolves with `ok: false` and a reason.
     */
    run(token: string, view: UsageStatsView): Promise<UsageStatsResult>;
  };
  log: {
    /**
     * Start the tail and receive pushes. Returns an unsubscribe function.
     * Replaces the SSE route + EventSource the web app used.
     *
     * SINGLE-OWNER. The main process keys one tail per `webContents.id` and stops any existing
     * tail before starting a new one, so a second subscriber in the same window silently steals
     * the tail from the first, and whichever unsubscribes first kills it for both. The one owner
     * is `SessionLogProvider`, mounted once in `__root.tsx`; read from it via `useSessionLog()`
     * rather than subscribing again. A test asserts there is exactly one call site.
     */
    subscribe(handlers: {
      onInit(entries: SessionLogEntry[]): void;
      onEntry(entry: SessionLogEntry): void;
      onReset(): void;
    }): () => void;
  };
  shell: {
    reveal(target: string): Promise<void>;
  };
  /**
   * `/maestro`'s Channels block (`037`) — every receiver lane in `.claude/channels/` holding at
   * least one undelivered file, right now.
   *
   * READ-ONLY, and there is exactly one call because there is exactly one thing to ask: `036`'s
   * hooks are the only code that delivers (`SubagentStart`), retires (the same hook, by moving a
   * file to `.consumed/`) or sweeps (`SessionEnd`) a channel file. This never does any of that —
   * it is the read `pendingLanes()` already computes, so a second implementation of the lifetime
   * rule never has the chance to drift from the hooks'.
   */
  channels: {
    pending(): Promise<PendingLane[]>;
  };
}
