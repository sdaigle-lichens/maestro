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
export { agentRunsFromLog, resumeTarget, type AgentRun } from "../agent-runs.js";
