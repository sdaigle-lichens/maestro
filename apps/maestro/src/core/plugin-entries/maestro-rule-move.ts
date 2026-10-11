// Bundle entry for plugins/maestro/scripts/lib/maestro-rule-move.cjs (`081`) — moving or
// unassigning a project rule from the terminal, with the same code `/rules`' Save runs
// (`saveConfig` -> `applyRules`). Required only by `plugins/maestro/scripts/maestro-rules.cjs`, and
// not copied into projects. No `node:sqlite`.

export {
  moveRule,
  unassignRule,
  listRules,
  assignRule,
  assignmentFor,
  resolveDestination,
  type RuleMoveResult,
  type RuleUnassignResult,
  type RuleListEntry,
} from "../rule-move.js";
