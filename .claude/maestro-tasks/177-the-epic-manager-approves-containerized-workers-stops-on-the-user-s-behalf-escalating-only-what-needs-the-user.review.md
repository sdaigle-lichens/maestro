# Manager review brief — task 177

## Goal
Opt-in `manager_approval` (off by default, docker workers only): the epic manager's approval record is the approval for a worker's human-review, commit and merge stops; a fixed escalation list still reaches the user in the manager session.

## Deviations
- None from the ticket's direction. Tests are not written yet (the @test step owns them).
- Registered one extra hook: the human-review gate script also runs on PostToolUse(AskUserQuestion), to record the user's answer to a marked escalation question.

## Decisions
- Records live outside the repo under `~/.config/maestro/approvals`, keyed by project/epic/task/stop, mounted read-only into worker containers and exposed through `MAESTRO_APPROVALS_DIR`. The mount exists only when the setting is on.
- A record matches only on the exact task, stop and commit; pane text and messages never count.
- `approve` and `approval-escalate` refuse inside a container, when the setting is off, and while an escalation is pending.
- The only way to write a `source:user` record is the manager session's own AskUserQuestion answer to a marked escalation question, captured by the hook.
- The escalation classifier covers: red or partial suite, scope change, decision conflict, outward-facing or destructive git operation, config surface (agents, skills, workflows, rules, settings), security finding, and a second redirect.

## Touches
- `apps/maestro/src/core/manager-approval.ts` (new), `human-review-gate.ts`, `worker-runtime.ts`, `types.ts`, `install.ts`
- `plugin-entries/maestro-epic.ts`, `plugin-entries` for the gate, and their generated libs
- `plugins/maestro`: the epic CLI, the gate hook script, `hooks.json`, `maestro-install.js`, the worker template, the maestro-manager skill, `plugin.json` (0.15.9 → 0.15.10)

## Sibling impact
- Host workers and any project with the setting unset or off see no change.
- The `.claude/scripts` mirrors and the rendered orchestrator are stale until `pnpm refresh:runtime` is run.

## Questions
- None for the direction.
