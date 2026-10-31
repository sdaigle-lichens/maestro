## Changed

Worktree `/home/superadmin/gits/maestro-task-134` (branch `task-134`), 15 tracked files changed plus 1 new test:

- Config model: `apps/maestro/src/core/types.ts`, `config.ts`, `contracts.ts`, `index.ts`
  - The optional `worker_model` field.
  - A `worker-model` slice and `resolveWorkerModel`.
- Launch command: `apps/maestro/src/core/epics.ts`
  - `launchCommandFor` adds `--model '<value>'`.
  - `readyTasks` reads the model from `maestro.json`.
- Plugin libs, rebuilt: `plugins/maestro/scripts/lib/maestro-epic.cjs` and `maestro-rule-move.cjs`.
- Tracked mirror: `.claude/scripts/lib/maestro-epic.cjs`.
- Version bump: `plugins/maestro/.claude-plugin/plugin.json`, 0.12.11 to 0.12.12 (patch).
- Desktop app IPC:
  - `apps/maestro/src/shared/ipc.ts`
  - `apps/maestro/src/main/ipc.ts`
  - `apps/maestro/src/preload/index.ts`
  - `apps/maestro/src/renderer/src/dev-stub/maestro-install.ts`
- Desktop app UI: a new `WorkerModelCard` in `apps/maestro/src/renderer/src/routes/maestro.tsx`.
- Tests: new `apps/maestro/test/core/worker-model.test.ts`, plus one case added to `apps/maestro/test/core/epics-cli.test.ts`.

## Did

- @backend: added the config field, slice merge and resolver, and the quoted `--model` flag in the launch command. It rebuilt the libs, refreshed the mirror, bumped the version and wrote the unit and CLI tests. Lint, typecheck, the full test suite (115 files) and the parity test pass.
- @frontend: added the IPC read and write channels and a `WorkerModelCard` text field with Save and Enter on the `/maestro` page. It is shown only when Maestro is installed and reloads when the project changes. Typecheck and the relevant tests pass.

## Deviations from the ticket

- No renderer tests were added: `routes/maestro.tsx` has no test file to extend.
- `pnpm --filter maestro check` cannot run in the worktree because prettier is missing there. Prettier was run from the main checkout on the changed files instead.
- The full `pnpm verify` has not run yet. @test is next.
- The skill text and the maestro.json field docs are not written yet. @scribe is later in the path.
- `apps/maestro/node_modules` is a temporary symlink to the main checkout's copy. It is untracked and gitignored, and should be removed before the merge.
- Blank or whitespace-only values are treated as unset (the key is deleted). The ticket did not specify this.
