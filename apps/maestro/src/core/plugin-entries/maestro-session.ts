// Bundle entry for plugins/maestro/scripts/lib/maestro-session.cjs.
//
// The export surface here must stay a SUPERSET of what the hand-written .cjs exported — the
// standalone hook scripts `require()` these names, so adding one is safe and renaming or removing
// one breaks a script that runs outside this workspace. `scripts/build-plugin-libs.mjs` bundles
// this file to CJS; a parity test asserts the original name list is still all there.

export {
  resolveWorkflowName,
  resolveSearchList,
  collectAgentSkills,
  bareAgentName,
  nodeLabel,
  successPathSteps,
  workflowNodeLabels,
} from "../success-path.js";

// Hook arbitration: lets the plugin's copy of a hook stand down when the project registers the
// same hook itself. Required by every hook script the plugin ships, and a no-op in the copy of
// that same script installed into a project.
export { projectOwnsHook } from "../hook-arbitration.js";

export {
  readStdin,
  readJson,
  readSession,
  writeSession,
  ensureSessionRunId,
  appendSessionLog,
  sessionLogPath,
  SESSION_LOG_FILE,
} from "../session-runtime.js";

// Per-session state directories (`064`). Every hook script and every orchestrator-invoked CLI
// resolves "which session am I" through this one module — payload `session_id` → the
// `CLAUDE_CODE_SESSION_ID` env var → `null` — and builds its paths from the result, so the three
// ephemeral files can never again be shared between two concurrent sessions. `fs`/`path` only, so
// it costs nothing against the "no node:sqlite in maestro-session.cjs" property below.
export {
  SESSIONS_DIR_NAME,
  SESSION_LOG_NAME,
  SESSION_STATE_NAME,
  SESSION_TASKS_NAME,
  SESSION_ID_ENV,
  LEGACY_SESSION_FILES,
  isValidSessionId,
  resolveSessionId,
  sessionsRoot,
  sessionPathsFor,
  resolveSessionPaths,
  ensureSessionsRoot,
  ensureSessionPaths,
  listSessionIds,
  removeSessionState,
  type SessionPaths,
  type SessionIdSource,
} from "../session-paths.js";

// Agent channels (`036`) — lanes, stamps, retire, sweep. `fs`/`path` only, so this costs nothing
// against the "no node:sqlite in maestro-session.cjs" property below.
export {
  channelDir,
  laneFor,
  writeStamp,
  readLane,
  retire,
  sweep,
  formatStampedContent,
  parseStampedContent,
  CHANNEL_AGE_CAP_MS,
  type ChannelEntry,
  type SweepResult,
} from "../handoff-channels.js";

// Handoff protocols (`033`), the parts that must reach the hook WITHOUT `node:sqlite`.
//
// `handoffRoutes` is the route walk the hook used to carry inline — lifted so the injector and the
// install-time sync cannot disagree about which routes a project has. `resolveHandoff` is the
// three-tier order, shared with the app for the same reason `resolveReport` is. `SEED_HANDOFFS` /
// `isSeededHandoff` are the floor: the sqlite tier lives in its own bundle the hook requires inside
// a try/catch, and this is what answers when that require throws. Keep `grep -c "node:sqlite"` on
// the generated maestro-session.cjs at 0.
export { handoffRoutes, routesFrom, handoffPairs, type HandoffRoute } from "../handoff-routes.js";

// Config hygiene (`041`) — the collision the canvas already refuses to create (two placed
// instances on one workflow sharing a bare agent), reported wherever a config a human may have
// hand-edited is read: the app on load, `/maestro-update` before it re-renders, and install/update
// sync. Pure, leans on `bareAgentName` above — costs nothing against the "no node:sqlite in
// maestro-session.cjs" property.
export { duplicateAgentTypes, validateConfig, type ConfigIssue } from "../config-validate.js";

export {
  resolveHandoff,
  type HandoffResolution,
  type HandoffSource,
  type GlobalHandoffInput,
} from "../handoff-resolution.js";

export {
  SEED_HANDOFFS,
  PRIOR_SEEDS as PRIOR_HANDOFF_SEEDS,
  isSeededHandoff,
  isValidHandoffId,
  splitHandoffId,
  handoffId,
} from "../handoff-seeds.js";

// Resume-target resolution (`039`) — reads the same append-only log's `kind:"handoff"` entries as
// an agent-type -> agent-id index, so a condition edge routing back to an agent that already ran
// this run can be RESUMED instead of dispatched cold. No new state: `fs`-free, taking the log's
// already-parsed lines.
//
// `hasCompletedRun` (`040`) reads the same index for a different question — not "which agent_id
// should this resume", but "is THIS SubagentStart itself a resume" — so `maestro-inject-agent-context.js`
// can skip re-injecting static context that's already in the resumed agent's history.
export { agentRunsFromLog, resumeTarget, hasCompletedRun, type AgentRun } from "../agent-runs.js";

// Skill-id -> SKILL.md path resolution (`061`) — the runtime fallback for a project skill
// discovered outside the repository root's `.claude/skills`, which the Skill tool never indexes.
// `fs`/`path` only, so this costs nothing against the "no node:sqlite in maestro-session.cjs"
// property above; shared by `maestro-resolve-skill-path.cjs`, `maestro-inject-agent-context.js`,
// and `maestro-install.js`'s own `discoverProjectSkillIds`.
export {
  walkProjectSkillIds,
  resolveProjectSkillPath,
  isRootSkillPath,
  type ProjectSkillEntry,
} from "../skill-resolve.js";
