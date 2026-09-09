# Expose the task-routing setting in the app's project settings

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Add a small checkbox card to the desktop app's `/maestro` page for the new "Use maestro tasks" setting, rendered alongside the existing Step 1 Gates card — same interaction pattern as `GatesCard`: writes to disk on every click, no Save button, and visible only once Maestro is installed for the open project (same visibility guard `GatesCard` uses).

Add the IPC contract for it: a read channel (e.g. `data:task-routing`) and a write channel (e.g. `project:task-routing:set`), mirroring the shape of the existing `gates` channel pair but for a single boolean rather than a two-field object, plus their typed bridge methods and main-process handlers. The read handler should never reject — fall back to `false` with no project open, same as the gates handler falls back to `DEFAULT_GATES`. Both handlers should build on `resolveUseMaestroTasks` and the `mergeSlice("task-routing", ...)` arm from the prior task rather than re-deriving the resolution rule.

## Acceptance criteria

- [x] Opening /maestro for an installed project shows the new checkbox reflecting the current value of use_maestro_tasks read from maestro.json — verified in a real window against `~/gits/maestro-048-task-routing`: checkbox reads `false` initially, matching `maestro.json` having no `use_maestro_tasks` key.
- [x] Clicking it writes .claude/maestro.json immediately with no Save button, toggling only use_maestro_tasks and leaving every other slice (workflows, rules, gates, project_tags, reports, handoffs) untouched — verified: single click flips the on-disk value to `true` with no Save button, and a before/after diff of the full config confirmed `workflows`, `rules`, `gates`, `project_tags`, `agents_available` byte-identical across the toggle.
- [x] The card does not render for a project with no Maestro installed, matching GatesCard's visibility rule — verified against `~/gits/maestro-048-uninstalled`: `STEP 1 GATES` and `TASK ROUTING` both absent from `document.body.innerText` before install, present after.
- [x] The read channel never rejects and returns false when no project is open — verified: `window.maestro.data.taskRouting()` called with no project open at all resolved (did not reject) with `{ useMaestroTasks: false }`.
- [x] Toggling the checkbox on, then running /maestro on a task that reaches Step 4, shows the /to-maestro-tasks directive added in the first task — demonstrating the UI write actually reaches the runtime. **Substitution noted**: rather than a full live orchestration to Step 4, ran `plugins/maestro/scripts/maestro-step4-gate.cjs` directly against the fixture project after the UI toggle (`CLAUDE_PROJECT_DIR=~/gits/maestro-048-task-routing node .../maestro-step4-gate.cjs`) and got the "on" line (`Step 4 — this project routes follow-up work through the task queue...`). This proves the runtime script Step 4 invokes reads exactly what the UI wrote — the whole connection this criterion checks for — without a full session run.

## Divergences

None of substance — the task page's "build on `resolveUseMaestroTasks` and the `mergeSlice("task-routing", ...)` arm from the prior task rather than re-deriving the resolution rule" was followed exactly. Worth recording: **`046` defined `resolveUseMaestroTasks` (in `src/core/config.ts`) and `MaestroTaskRoutingSlice` (in `src/core/types.ts`) but never re-exported either from the barrels `main/ipc.ts` and `shared/ipc.ts` actually import** (`src/core/index.ts` for the value, `src/core/contracts.ts` for the type) — so they were unreachable from the IPC layer until this task added those two re-exports. If `046`'s task page or any concept skill describes them as fully wired end-to-end, that description is stale.

## Verification

- `pnpm --filter maestro typecheck` — clean.
- `pnpm --filter maestro test` — 969/969 passing.
- `pnpm --filter maestro exec prettier --check` on every touched file — clean.
- Packaged app driven over CDP per the `test-maestro` skill against fixture projects `~/gits/maestro-048-task-routing` (installed) and `~/gits/maestro-048-uninstalled` (not installed). Both fixtures are outside this repo, left in place per the `test-maestro` skill's fixture rules.

## Blocked by

- `046-add-the-use-maestro-tasks-setting-and-the-step-4-gate-script.md`
