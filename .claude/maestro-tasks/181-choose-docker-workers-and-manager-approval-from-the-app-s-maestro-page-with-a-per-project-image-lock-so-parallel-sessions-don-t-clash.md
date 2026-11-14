# Choose Docker workers and manager approval from the app's /maestro page, with a per-project image lock so parallel sessions don't clash

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Today a user turns on containerized workers and manager approval only by hand-editing .claude/maestro.json (`worker_runtime`, `manager_approval`), and nothing stops two sessions of the same project from building or pruning the worker image at the same time.

**Settings in the app.** In the desktop app's /maestro page, in the existing post-install worker section that already edits `worker_model`, add: a Worker runtime choice (Host, the default, or Docker), and a Manager approval switch shown only when Docker is chosen, with one line saying what it does and that the escalation list still reaches the user. Saving writes only those two fields, through the same slice-merge as `worker_model`, so other slices are never clobbered. When Docker is chosen the page shows two readiness lines, computed in the main process from node-side core logic and passed over a new typed IPC channel (never from the renderer): whether the Docker daemon is reachable, and whether the worker token file exists (existence only: the token is never read, displayed or sent anywhere). It also offers a "Rebuild worker image" action that runs the launcher's existing image build for the project and shows its result, plus the launcher's prune in dry-run so the user sees what would be removed.

**Parallel safety.** Add a per-project lock, outside the repository and outside every container mount, taken by the launcher's image build and by prune: a second build of the same project waits and then reuses the image the first built instead of building again; prune waits for a build in progress, and a build waits for a prune. A lock held by a dead process is recovered. Two managers of the same project (two epics) are covered by the same lock.

**Settings changed mid-run.** Record `worker_runtime` and `manager_approval` for each worker when it is launched, in the epic's worker record. The approval gate uses the value recorded for that worker, not the live maestro.json, so turning manager approval on or off in the app changes only workers started afterwards; the page says so next to the switch.

This needs renderer code (the /maestro page section), main-process IPC handlers and the shared IPC contract, core logic (Docker and token readiness, the lock, the per-worker recorded settings, the gate reading them), the generated plugin libs and their .claude/scripts mirrors, the maestro-manager skill (where it says when settings take effect), tests, and a plugin patch version bump.

## Acceptance criteria

- [ ] The /maestro page offers Worker runtime (Host default, Docker) and, only with Docker, a Manager approval switch; saving writes only those fields to maestro.json and leaves every other slice unchanged
- [ ] With Docker chosen, the page shows whether the Docker daemon is reachable and whether the worker token file exists, computed in the main process; the token's contents are never read, shown or sent
- [ ] The page's Rebuild worker image action builds the project's image through the launcher and shows the result; a prune dry-run lists what would be removed
- [ ] Two image builds of the same project started at once produce one build; the second waits and reuses the image
- [ ] Prune and build never run at the same time for a project; a lock left by a dead process is recovered; the lock lives outside the repository and every container mount
- [ ] Each worker's runtime and manager-approval setting are recorded at launch; changing manager_approval afterwards does not change who approves that worker's stops, and the page says so
- [ ] Host workers and an unset worker_runtime behave exactly as before
- [ ] Tests cover the settings save (slice-merge), the readiness checks (daemon down, token missing), the lock (concurrent builds, build versus prune, stale lock), and the recorded per-worker setting used by the gate; the full suite is green
- [ ] plugins/maestro/.claude-plugin/plugin.json gets a patch bump, the generated libs are rebuilt and the .claude/scripts mirrors refreshed

## Manager direction

- (m006, on-track) Lesson from 180, where stub-only tests missed a real-daemon failure: before reporting done, show one live run against the real Docker daemon: two `maestro-worker-runtime.cjs image` builds of this project started at once producing one build, and the page's readiness lines and Rebuild action seen in a real app window (the project's `test-maestro` skill drives one). If your session cannot run Docker or the app, hand the user the exact commands, as for `pnpm refresh:runtime`, and put their output in the report.

## Touched surfaces

- apps/maestro/src/renderer/src/routes/maestro.tsx (worker section)
- apps/maestro/src/shared/ipc.ts, apps/maestro/src/preload, apps/maestro/src/main/ipc.ts (new readiness and rebuild channels)
- apps/maestro/src/core/worker-runtime.ts and plugin-entries/maestro-worker-runtime.ts (lock, readiness), plus plugins/maestro/scripts/maestro-worker-runtime.cjs
- apps/maestro/src/core/epics.ts, plugin-entries/maestro-epic.ts and human-review-gate.ts (recorded per-worker settings), plus generated libs
- apps/maestro/src/core/types.ts and the maestro.json slice-merge (worker_runtime, manager_approval)
- plugins/maestro/skills/maestro-manager/SKILL.md (when settings take effect)
- plugins/maestro/.claude-plugin/plugin.json (version, patch; standalone 178 also bumps it, whichever lands second rebases)
- generated libs and .claude/scripts mirrors (user runs `pnpm refresh:runtime`)

## Blocked by

None — can start immediately
