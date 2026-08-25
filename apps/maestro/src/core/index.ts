// The barrel for src/core — all node-side Maestro logic, framework-free.
//
// Imported by the app's main process (which exposes it over IPC) and, for the pure modules,
// re-bundled to CJS for the plugin's standalone Claude Code hook scripts by
// scripts/build-plugin-libs.mjs. Nothing here imports React, TanStack, or Electron.
//
// This barrel is MAIN-PROCESS ONLY: it re-exports modules that import fs and child_process. The
// renderer-safe surface is ./contracts.js (types) and ./text.js (pure string helpers), and
// test/isolation.test.ts fails if anything under src/{shared,preload,renderer} reaches past them.

export type {
  MaestroConfigV3,
  MaestroInstanceV3,
  MaestroNodeV3,
  MaestroEdgeV3,
  MaestroWorkflowV3,
  MaestroRuleV3,
  MaestroWorkflowsSlice,
  MaestroRulesSlice,
  MaestroSession,
} from "./types.js";

export {
  resolveWorkflowName,
  resolveSearchList,
  collectAgentSkills,
  bareAgentName,
  nodeLabel,
  successPathSteps,
  workflowNodeLabels,
  type AgentSkills,
  type SearchListResult,
} from "./success-path.js";

export {
  MANAGED_REGIONS,
  RENDERED_REGIONS,
  startMarker,
  endMarker,
  extractRegion,
  replaceRegion,
  syncManagedRegions,
  type SyncResult,
} from "./skill-regions.js";

export {
  maestroJsonPath,
  blankConfig,
  readJsonSafe,
  readConfig,
  serializeConfig,
  writeConfig,
  mergeSlice,
  type ConfigSlice,
} from "./config.js";

export { orchestratorSkillPath, successPath, handoffTable, renderOrchestrator, type RenderResult } from "./render.js";

export {
  readStdin,
  readJson,
  readSession,
  writeSession,
  appendSessionLog,
  sessionLogPath,
  SESSION_LOG_FILE,
} from "./session-runtime.js";

export { IGNORE_DIRS, MAX_DEPTH, walkDirs, rulesFilesIn, ruleSearchDirs } from "./fs-scan.js";

export {
  discoverAgents,
  discoverSkills,
  discoverProjectRules,
  discoverRuleLibrary,
  discoverProjectTree,
  discoverVibeRules,
  hasVibeRules,
  parseVibeList,
  findUpBundledAgents,
  BUNDLED_AGENTS_REL,
  type DiscoveredDefinition,
  type ProjectRule,
  type RuleLibraryEntry,
  type TreeNode,
} from "./discovery.js";

// help-server's read-only surface, folded in by docs/plans/m6-help-server-merge.md. All four
// read the OPEN PROJECT plus `~/.claude` — there is no container mount and no precompute file to
// recover a path from, which is what the merge retired along with port 3008.
export { listInstalledPlugins, readProjectMarketplace, projectMarketplacePath } from "./plugins.js";
export { listCuratedPlugins, CURATED_MARKETPLACES } from "./curated.js";
export { readClaudeCommands, claudeCommandsDocPath } from "./commands.js";
export { listDocs, readDoc, docSections, docsDir, isValidDocSlug, slugifyHeading } from "./docs.js";
export { globalDocsData, readGlobalDoc, type DocGroup, type GlobalDocsDirs } from "./global-docs.js";

export { applyRules, targetDirFor, type ApplyRulesSummary } from "./rules.js";

export { listTasks, closeTask, tasksDirFor, parseBlockedBy, type MaestroTask, type TaskStatus } from "./tasks.js";

export {
  parseLogLines,
  readSessionLog,
  tailSessionLog,
  sessionLogFileFor,
  type SessionLogEntry,
  type SessionLogTailEvents,
} from "./session-log.js";

export { saveConfig, type SaveResult } from "./save.js";

export {
  installRuntime,
  installStatus,
  installOrchestratorSkill,
  runtimeAssets,
  findRepoRoot,
  findUpPluginRoot,
  defaultPluginRoot,
  HOOK_REGISTRATIONS,
  type InstallReport,
  type InstallStatus,
  type OrchestratorSkillAction,
  type RuntimeAsset,
  type HookRegistration,
  type HookEvent,
} from "./install.js";

export {
  uninstallRuntime,
  uninstallPlan,
  purgeTargets,
  type UninstallOptions,
  type UninstallPlan,
  type UninstallReport,
} from "./uninstall.js";

export { detectImplAgents, type RepoDetection } from "./detect.js";

export {
  listMarketplaces,
  marketplacePath,
  marketplaceOwner,
  marketplacePlugins,
  type MarketplaceEntry,
  type MarketplaceOptions,
} from "./marketplaces.js";

// The deterministic half of the create-* flows. `./text.js` is the renderer's half —
// the same `buildDesc`/`clip` the scaffold writes with, so a form's live preview and the file that
// lands cannot disagree.
export {
  scaffoldCreate,
  resolveCreateTarget,
  validateCreateRequest,
  type CreateRequest,
  type CreateTarget,
  type ScaffoldOptions,
  type ScaffoldResult,
} from "./scaffold.js";

// The git half of the create-marketplace scaffold. Deliberately NOT imported by `scaffold.ts`:
// it is handed in as a port, so the scaffold's import graph — which `claude-preview.ts` shares —
// stays free of `child_process`. See `GitPort` in `contracts.ts`.
export { nodeGit } from "./git.js";
export { enclosingRepo } from "./repo.js";

export { buildDesc, clip, deriveName, firstSentence, joinOxford, stripNamespace, titleFromName } from "./text.js";

// The `claude -p` bridge, in three modules on purpose: preview cannot spawn, run cannot invent.
// Import `claude-preview.js` directly if you want that guarantee at the import level — pulling
// preview off this barrel re-exports the spawn path alongside it.
export {
  previewClaudeRun,
  CLAUDE_BASE_FLAGS,
  type ClaudePreview,
  type ClaudeReadScope,
  type ClaudeRequest,
  type ClaudeWriteTarget,
  type PreviewOptions,
} from "./claude-preview.js";

// What a run can READ, derived from the effective settings rather than from the app's intent.
// Pure — the resolution itself arrives as a `SettingsPort`, from `agent-sdk.js` below.
export { buildReadScope, withinDirectory, RULE_DISPLAY_CAP, type ReadScopeInput } from "./read-scope.js";

export { resolveClaudeCli, claudeSearchDirs, cliNotFoundMessage, type ClaudeCli } from "./claude-cli.js";

export {
  runPreviewedClaude,
  cancelClaudeRun,
  disposeClaudeRuns,
  spawnClaudeChild,
  terminateChildGroup,
  TokenRefused,
  type ClaudeRunDeps,
  type ClaudeRunEvents,
  type ClaudeOutputChunk,
  type ClaudeRunResult,
} from "./claude-run.js";

export {
  claimInvocation,
  clearInvocations,
  TOKEN_TTL_MS,
  type ClaudeInvocation,
  type InvocationPurpose,
} from "./claude-tokens.js";

// What a create-* form says to the session it hands off into: the seeded context the model reads
// and the announcement the user reads. Pure — it phrases a `HandoffContext` the preview resolved,
// and reads nothing itself. See ./session-handoff.ts.
export { handoffNotice, handoffSeed, handoffTitle, writeScopeNote } from "./session-handoff.js";

// The Claude Agent SDK — the steerable path to the same CLI, and the ground the session pane is
// built on. `runAgentSdkSmoke` proves a query runs in a PACKAGED build, which is the only place
// this slice's failure modes appear. `nodeSettings` is the first user-facing consumer: it resolves
// the settings cascade for the confirmation dialog's read disclosure, and is injected as a port
// rather than imported, so `claude-preview.ts` still cannot reach a process. See ./agent-sdk.ts.
export {
  runAgentSdkSmoke,
  writeSmokeReceipt,
  agentChildEnv,
  nodeSettings,
  resolveEffectiveSettings,
  billingFrom,
  startAgentSession,
  startPaneSession,
  paneSessionTarget,
  // The CLI's own session store, read through the SDK rather than walked (`025`).
  listStoredSessions,
  readStoredMessages,
  AGENT_SDK_PACKAGE,
  BILLING_ENV_VARS,
  SMOKE_PROMPT,
  SESSION_TOOLS,
  SESSION_DISALLOWED_TOOLS,
  PANE_TOOLS,
  PANE_SKILLS,
  type PaneSession,
  type PaneSessionRequest,
  type PaneSessionTarget,
  type AgentBilling,
  type AgentChildEnv,
  type AgentDenial,
  type AgentSdkSmokeResult,
  type AgentSession,
  type AgentSessionRequest,
  type AgentSessionResult,
  type SmokeOptions,
} from "./agent-sdk.js";

// What a run may WRITE, decided per tool call. Pure — the counterpart to `read-scope.ts`, and the
// module that replaced `--permission-mode acceptEdits`.
export {
  decideWrite,
  targetPathOf,
  READ_ONLY_TOOLS,
  WRITE_TOOLS,
  type WriteDecision,
  type WriteScopeInput,
} from "./write-scope.js";

// What a live session may READ, decided per tool call by a `PreToolUse` hook. Pure, and a THIRD
// module rather than a branch of the two above: `decideWrite` structurally cannot bound reads
// (`canUseTool` never sees them) and `read-scope.ts` only discloses. See ./session-scope.ts.
// `grantOptionsFor`/`grantOptionFor` are the other half of the same boundary: what a PERSON could
// open in answer to a prompt, and which of those options an answer named. Still pure — whether the
// path is a directory is the caller's answer, because that is the one part that needs the disk.
export {
  decideBoundary,
  boundaryTargetOf,
  grantOptionFor,
  grantOptionsFor,
  BOUNDED_TOOLS,
  UNBOUNDED_TOOLS,
  type BoundaryDecision,
  type BoundaryInput,
  type BoundaryTarget,
} from "./session-scope.js";

// When a session has to ask a PERSON, and what the question shows. Composes the two modules above
// rather than deciding anything itself — the third answer neither of them can give. Pure.
export {
  autoRefusal,
  decidePaneCall,
  describeCall,
  permissionReason,
  PANE_ASK_TOOLS,
  type PaneCallInput,
  type PaneVerdict,
} from "./session-permission.js";

// What a session may SPEND, and what it says when it has spent it. Pure, and a fifth module beside
// the four scope ones for the same reason they are four: a ceiling that ends the session is a
// different decision from one that refuses a call, and the door out of it — Continue, resuming the
// same conversation with a fresh allowance — is the only thing that makes a low ceiling usable.
export {
  accrueTurn,
  ceilingEnding,
  ceilingOf,
  exhaust,
  formatUsd,
  isEffortLevel,
  isPacingUnsupported,
  newSpend,
  pacingTokens,
  paneBudget,
  renewAllowance,
  spendLabel,
  spendNote,
  DEFAULT_CEILING_USD,
  DEFAULT_EFFORT,
  DEFAULT_MAX_TURNS,
  EFFORT_LEVELS,
  PACING_UNSUPPORTED_NOTICE,
  type BudgetPolicy,
  type CeilingEnding,
} from "./session-budget.js";

// Picking up a conversation this app did not start (`025`): which of the store's own rows may be
// offered for the open project, and the disclosure that has to be read before one is. Pure — the
// store is read by `agent-sdk.ts`, which is where the SDK and `fs` already live.
export {
  formatTokens,
  readNote,
  replayNote,
  resumableFrom,
  resumeDisclosure,
  resumedNotice,
  CHARS_PER_TOKEN,
  RESUME_LIST_LIMIT,
  RESUME_READ_CAP,
  RESUME_SCOPE_NOTE,
  REPLAY_USD_PER_MTOK,
  type StoredMessage,
  type StoredSession,
} from "./session-resume.js";

// The parked promises behind that ask: idempotent per request id, and resolved — denied — by every
// teardown path, because permission prompts do not time out and nothing else will. Pure.
export {
  createPermissionRegistry,
  type PermissionRegistry,
  type PermissionRequestHandle,
} from "./permission-registry.js";

// The other kind of ask, on the same wire and nothing like it on screen: a structured question read
// out of an `AskUserQuestion` call, and answered back into it. The one place in the app that
// authors a tool-input payload — which is why `answerQuestions` rebuilds it from the questions the
// MODEL asked and refuses any label that was not offered. Pure.
export {
  answerQuestions,
  describeQuestions,
  QUESTION_PREVIEW_FORMAT,
  QUESTION_REFUSAL,
  QUESTION_TOOL,
  QUESTION_UNRENDERABLE,
  type QuestionResolution,
} from "./session-question.js";

// Usage stats. The same preview-then-run shape and the same token store as the bridge above,
// because the thing being confirmed is the same kind of thing: a command about to run on the
// user's machine — and, when no local copy exists, one FETCHED FROM THE NETWORK first. The
// decision behind that, and why the version is pinned, is written at the top of ./ccusage.ts.
export {
  previewUsageStats,
  runUsageStats,
  resolveCcusage,
  ccusageArgv,
  ccusageNotFoundMessage,
  reduceUsage,
  emptyUsageStats,
  PINNED_CCUSAGE_VERSION,
  type CcusageCli,
  type CcusageSource,
  type UsageStats,
  type UsageStatsPreview,
  type UsageStatsResult,
  type UsageStatsView,
} from "./ccusage.js";

export {
  defaultV3Config,
  buildWorkflow,
  linearWorkflow,
  buildTestsWorkflow,
  seededAgentNames,
  type SkillMap,
} from "./seed.js";

export {
  readAllSkillTags,
  setSkillTags,
  skillMapFromTags,
  parseSkillTagsBlock,
  applySkillTagsBlock,
  DEFAULT_SKILL_TAGS_DB_PATH,
} from "./skill-tags.js";
