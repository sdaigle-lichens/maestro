# Expose the task-routing setting in the app's project settings

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Add a small checkbox card to the desktop app's `/maestro` page for the new "Use maestro tasks" setting, rendered alongside the existing Step 1 Gates card — same interaction pattern as `GatesCard`: writes to disk on every click, no Save button, and visible only once Maestro is installed for the open project (same visibility guard `GatesCard` uses).

Add the IPC contract for it: a read channel (e.g. `data:task-routing`) and a write channel (e.g. `project:task-routing:set`), mirroring the shape of the existing `gates` channel pair but for a single boolean rather than a two-field object, plus their typed bridge methods and main-process handlers. The read handler should never reject — fall back to `false` with no project open, same as the gates handler falls back to `DEFAULT_GATES`. Both handlers should build on `resolveUseMaestroTasks` and the `mergeSlice("task-routing", ...)` arm from the prior task rather than re-deriving the resolution rule.

## Acceptance criteria

- [ ] Opening /maestro for an installed project shows the new checkbox reflecting the current value of use_maestro_tasks read from maestro.json
- [ ] Clicking it writes .claude/maestro.json immediately with no Save button, toggling only use_maestro_tasks and leaving every other slice (workflows, rules, gates, project_tags, reports, handoffs) untouched
- [ ] The card does not render for a project with no Maestro installed, matching GatesCard's visibility rule
- [ ] The read channel never rejects and returns false when no project is open
- [ ] Toggling the checkbox on, then running /maestro on a task that reaches Step 4, shows the /to-maestro-tasks directive added in the first task — demonstrating the UI write actually reaches the runtime

## Blocked by

- `046-add-the-use-maestro-tasks-setting-and-the-step-4-gate-script.md`
