// Bundle entry for plugins/maestro/scripts/lib/maestro-epic.cjs.
//
// Backs the `maestro-epic.cjs` CLI the orchestrator's done step, the `maestro-manager` skill and
// `to-maestro-tasks` invoke. `epics.ts` reaches only `tasks.ts`, `claims.ts`, `worktree.ts` and
// `session-paths.ts`, all `fs`/`path` only, so this bundle never pulls in `node:sqlite`.
// `132` adds the manager review request and verdict (and `human-review-gate.ts`, which imports
// nothing); `maestro-human-review-gate.js` requires `epicOfTask`/`readEpicState` from here to learn
// the manager's name. `epic-boundary.ts` adds `node:child_process` for its read-only git calls:
// a built-in, so it stays external and the bundle still runs under bare node.

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
  taskStatusOf,
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
  MANAGER_MESSAGE_MARKER,
  isValidPaneId,
  inboxPointer,
  newInboxAnnouncements,
  deliveryWords,
  reviewDeliveryWords,
  WATCH_MAX_SECONDS,
  WATCH_DEFAULT_SECONDS,
  WATCH_DEFAULT_INTERVAL_SECONDS,
} from "../epics.js";

// `176`: the CLI words its output for a containerized worker (see `deliveryWords`).
export { isContainerWorker } from "../worker-runtime.js";

export { runEpicBoundary, formatBoundary } from "../epic-boundary.js";

// `170`: `report` refuses a done report that names no commit on the task's branch. The git runner
// is injected by the CLI; `fs`/`path` only.
export { checkReportCommit, shaCandidates, declaresDone, type ReportCommitVerdict } from "../landing-guards.js";

// `177`: manager approval. The epic CLI's approve / approval-escalate / approval-check commands and
// the human-review gate hook (and its AskUserQuestion recorder) read and write approval records.
// `fs`/`path`/`crypto` only, so this bundle stays free of `node:sqlite`.
export {
  APPROVAL_STOPS,
  ESCALATION_REASONS,
  ESCALATION_TEXT,
  resolveManagerApproval,
  managerApprovalApplies,
  approvalsDir,
  normalizeStop,
  projectKeyFor,
  approvalFile,
  findApproval,
  checkApproval,
  sameCommit,
  approveStop,
  escalateStop,
  recordUserAnswer,
  readPendingEscalation,
  classifyEscalation,
  classifyGitOperation,
  isConfigSurface,
  isEscalationReason,
  escalationMarker,
  parseEscalationAnswer,
  approvalGuidance,
} from "../manager-approval.js";
