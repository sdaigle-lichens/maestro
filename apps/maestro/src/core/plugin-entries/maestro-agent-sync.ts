// Bundle entry for plugins/maestro/scripts/lib/maestro-agent-sync.cjs.
//
// `031` asks the `maestro` and `maestro-update` skills to "print the same diff to the console and
// ask there. Both paths read one shared decision function, so the terminal and the app cannot
// disagree about whether a fork is stale." This bundle is how that holds: the skills call
// `maestro-agent-forks.cjs`, which requires this, which is `agent-sync.ts` + `sync-decision.ts` +
// `diff.ts` compiled from the same TypeScript the desktop app runs. There is no second
// implementation to drift.
//
// WHAT IT MUST NOT PULL IN: `node:sqlite`. `agent-fork.ts` writes three global sqlite stores on a
// renamed fork, so the sidecar reads and the frontmatter arithmetic were split into
// `agent-fork-record.ts` for exactly this bundle — a project's Claude session may be running a
// `node` older than 22.5, where `node:sqlite` does not exist at all, and a top-level require of it
// here would take the whole feature down rather than one optional store.

export {
  computeAgentSync,
  applyAgentSync,
  type AgentSyncAction,
  type AgentSyncApplyResult,
  type AgentSyncEntry,
  type AgentSyncOptions,
  type AgentSyncSummary,
  type PluginTemplateSource,
} from "../agent-sync.js";

export { decideSync, type SyncDecisionInput, type SyncTracking, type SyncVerdict } from "../sync-decision.js";

export { diffLines, hasChanges, unifiedDiffText, type DiffLine } from "../diff.js";

export {
  agentForksPath,
  bodyForHashing,
  hashAgentBody,
  mergeForkBody,
  readAgentForks,
  removeAgentFork,
  writeAgentForkRecord,
  type AgentForkRecord,
} from "../agent-fork-record.js";
