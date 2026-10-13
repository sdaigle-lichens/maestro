# Make the epic report a step a /maestro session cannot skip

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Two task sessions in a row (093, 099) finished without reporting to their epic manager; the user had to ask each one explicitly. The orchestrator's report instruction is a paragraph inside the Post Mortem step, whose first rule is 'on a clean session, write nothing', so a clean session reads the whole step as a no-op. It is also not a tracked task node: the mark-task-done node exists precisely so the done step can't be dropped, but once it is checked off the session's task list is empty and it stops. Separately, reports arrive with the wrong sender ('orchestrator', 'maestro') instead of the session's name.

Make reporting as hard to drop as marking the task done. When the active task belongs to an epic: the mark-task-done node's subject says it also reports to the epic; marking the task done prints the exact report command to run next (naming the epic and its manager); and the report instruction lives in its own step rather than inside Post Mortem. When the task belongs to no epic, nothing new is printed or required. When the report is written without a sender name, fall back to the session name recorded when the task was claimed.

## Acceptance criteria

- [ ] Marking an epic task done prints the report command to run next, naming the epic and its manager; marking a task with no epic done prints nothing new
- [ ] When the active task is in an epic, the orchestrator's last tracked node covers both marking it done and reporting
- [ ] The report instruction is its own orchestrator step, not part of Post Mortem, in both the rendered project skill and the plugin template
- [ ] A report written without a sender uses the session name from the task's claim
- [ ] Tests cover the epic and no-epic done output and the sender fallback; plugin libs rebuilt, mirrors refreshed, parity test passes, maestro plugin version bumped

## Blocked by

- `098-keep-a-freeform-maestro-session-and-a-task-session-from-sharing-the-main-checkout-unknowingly.md`
