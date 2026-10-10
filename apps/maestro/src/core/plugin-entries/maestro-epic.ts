// Bundle entry for plugins/maestro/scripts/lib/maestro-epic.cjs.
//
// Backs the `maestro-epic.cjs` CLI the orchestrator's done step, the `maestro-manager` skill and
// `to-maestro-tasks` invoke. `epics.ts` reaches only `tasks.ts`, `claims.ts`, `worktree.ts` and
// `session-paths.ts`, all `fs`/`path` only, so this bundle never pulls in `node:sqlite`.

export {
  EPICS_DIR,
  isValidEpicSlug,
  epicDirFor,
  readEpicState,
  createEpic,
  listEpics,
  setManager,
  addWorker,
  removeWorker,
  linkTasks,
  unlinkTasks,
  epicOfTask,
  writeReport,
  acknowledgeReport,
  unacknowledgedReports,
  showEpic,
  formatEpic,
} from "../epics.js";
