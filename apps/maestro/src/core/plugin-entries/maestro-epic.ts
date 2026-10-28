// Bundle entry for plugins/maestro/scripts/lib/maestro-epic.cjs.
//
// Backs the `maestro-epic.cjs` CLI the orchestrator's done step, the `maestro-manager` skill and
// `to-maestro-tasks` invoke. `epics.ts` reaches only `tasks.ts`, `claims.ts`, `worktree.ts` and
// `session-paths.ts`, all `fs`/`path` only, so this bundle never pulls in `node:sqlite`.
// `132` adds the manager review request and verdict (and `human-review-gate.ts`, which imports
// nothing); `maestro-human-review-gate.js` requires `epicOfTask`/`readEpicState` from here to learn
// the manager's name.

export {
  EPICS_DIR,
  isValidEpicSlug,
  epicDirFor,
  readEpicState,
  createEpic,
  listEpics,
  listEpicSummaries,
  setManager,
  addWorker,
  removeWorker,
  linkTasks,
  unlinkTasks,
  epicOfTask,
  taskClaimName,
  writeReport,
  reportCommandFor,
  checkNoteRoute,
  writeNote,
  acknowledgeReport,
  MANAGER_REDIRECT_CAP,
  REVIEW_VERDICTS,
  isReviewVerdict,
  reviewHistory,
  writeReviewRequest,
  recordReviewVerdict,
  unacknowledgedReports,
  showEpic,
  formatEpic,
  formatInboxEntry,
  DEFAULT_SPAWN_CAP,
  workerNameFor,
  launchCommandFor,
  readyTasks,
  formatReady,
} from "../epics.js";
