## Goal

Task 150 narrows the manager review to a direction check. The manager no longer judges commits, suite results or code. A redirect is only for work that contradicts the ticket, an epic decision or a sibling ticket, and it comes with a direction written into the task file. The redirect cap drops from 2 to 1, and `for @reviewer:` notes are gone. A loop-back from a test or reviewer step no longer resets a manager review that already passed.

## Deviations

- None from the ticket's stated changes.
- The `plugin-libs-parity` concept skill was not edited. The change touches no bundle layout, so it describes nothing that moved.

## Decisions

- `plan-step <label> pending` keeps its interface. Its reset skips a `manager review` that is already done and comes after the target, and a manager review named directly as the target still resets. This is the design the ticket decided.
- `MANAGER_REDIRECT_CAP` is 1 in `epics.ts`, the orchestrator template and maestro-manager. The plugin libs were rebuilt from source.
- The brief sections are now Goal, Deviations, Decisions, Touches, Sibling impact and Questions. The gate's denial message lists the same six.
- The patch version bump is 0.13.19 to 0.13.20.

## Touches

- `plugins/maestro/scripts/maestro-task-status.cjs` (plan-step reset).
- `apps/maestro/src/core/epics.ts` and `human-review-gate.ts`, and the rebuilt `maestro-epic` and `maestro-session` libs.
- `plugins/maestro/templates/maestro/SKILL.md`, the rendered orchestrator, and `plugins/maestro/skills/maestro-manager/SKILL.md`.
- `plugins/maestro/.claude-plugin/plugin.json`.
- The manager-review tests, plus `write-tasks-root.test.ts`.
- `.claude/epics/manager-review/EPIC.md`.
- The `maestro-architecture` skill and the `task-queue` epics sub-concept.

## Sibling impact

None found among the epic's other tickets. The loop-back rule and the cap apply to every ticket in the epic from the next round on.

## Questions

None for the manager.
