## Goal

Task 180: the manager cleans up after a finished worker. A new `prune` command on the worker launcher removes this project's superseded worker images and stopped worker containers. A new `finish-worker` epic command records a worker as finished so its pane is no longer shown as active. The maestro-manager skill says when to ask the user to stop the session and when to prune.

## Deviations

- Added a `maestro.worker.project=<hash of project root>` label to `docker build`, so prune can tell this project's images from another project's. Images built before this carry no label. An unlabelled old image whose repo slug equals another project's (same folder name) cannot be told apart from this project's.
- Image layout 6 -> 7 (both manager directions: existing tags rebuild).
- `readyTasks` now ignores a finished worker's task as pending. This goes beyond the ticket's wording.
- Known gap: the epic-boundary start check still counts finished workers in "the epic already has workers".

## Decisions

- `--init` goes right after `--rm` in the launcher's `docker run` arguments (manager direction).
- The marketplace copy baked into the image skips any `.claude/epics` path, on both the git-tracked and the filesystem-copy paths (manager direction).
- Prune removes no image if the current tag cannot be computed, and says so.
- With no Docker it prints "nothing needed removing" and exits 0.
- `finish-worker <slug> <name>` sets `finished_at` and drops the pane. `showEpic.workers` lists active workers only, and a separate `finishedWorkers` list is added.

## Touches

- `apps/maestro/src/core/worker-runtime.ts` and `plugin-entries/maestro-worker-runtime.ts`: `--init`, layout 7, epics exclusion, `planPrune` / `formatPrune`.
- `plugins/maestro/scripts/maestro-worker-runtime.cjs`: `prune [--dry-run]`, image label.
- `apps/maestro/src/core/epics.ts` and `plugin-entries/maestro-epic.ts`: `finish-worker`, `finishedWorkers`.
- `plugins/maestro/skills/maestro-manager/SKILL.md`: new section "Cleaning up after a finished worker" plus loop steps 6 and 7.
- `plugins/maestro/.claude-plugin/plugin.json`: 0.15.12 -> 0.15.13.
- Generated libs rebuilt.
- Tests: new `test/core/worker-cleanup-180.test.ts`; `worker-runtime.test.ts` and `worker-runtime-cli.test.ts` adjusted.

## Sibling impact

- Task 179 (merged) owns the same launcher and image layout.
- Every epic worker started from here gets `--init`.
- The `.claude/scripts` mirrors are stale until the user runs `pnpm refresh:runtime`, so the parity test fails until then.

## Questions

- Is the unlabelled-old-image limitation acceptable, or should prune also require a project marker in the tag?
