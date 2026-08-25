// Bundle entry for plugins/maestro/scripts/lib/maestro-session.cjs.
//
// The export surface here must stay IDENTICAL to what the hand-written .cjs exported — the
// standalone hook scripts `require()` these names. `scripts/build-plugin-libs.mjs` bundles this
// file to CJS; a parity test asserts the name list matches.

export {
  resolveWorkflowName,
  resolveSearchList,
  collectAgentSkills,
  bareAgentName,
  nodeLabel,
  successPathSteps,
  workflowNodeLabels,
} from "../success-path.js";

export {
  readStdin,
  readJson,
  readSession,
  writeSession,
  appendSessionLog,
  sessionLogPath,
  SESSION_LOG_FILE,
} from "../session-runtime.js";
