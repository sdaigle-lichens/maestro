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
  appendSessionLog,
  sessionLogPath,
  SESSION_LOG_FILE,
} from "../session-runtime.js";
