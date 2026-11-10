# Review — task 173, round 1 (manager review run as a human review: task has no epic)

## Goal

Make the merge land a task that was committed in the main checkout. Make it refuse, with a clear message, when a local file it would overwrite has changed. Never reissue an epic review id. Make the epic-end check count orphaned inbox reports. Document ack by handle. Item 6 (concept notes) is left for @scribe.

## Changed

- `apps/maestro/src/core/landing-guards.ts`: pre-merge check for files the merge would overwrite; parser for git's overwrite error
- `plugins/maestro/scripts/maestro-task-status.cjs`: `merge` reads "done" from the branch's tracker; merges `status.json` itself (set aside, merge, re-apply; resolves a tracker-only conflict)
- `apps/maestro/src/core/epics.ts`: review ids (mNNN) allocated from the log plus inbox files, claimed with an exclusive `inbox/mNNN-<task>.md` pointer file
- `apps/maestro/src/core/epic-boundary.ts`: the epic-end check counts unacknowledged inbox files the log no longer lists, named by handle
- `apps/maestro/src/core/plugin-entries/maestro-session.ts` plus the rebuilt libs `maestro-session.cjs` and `maestro-epic.cjs`, with their `.claude/scripts` mirrors
- `plugins/maestro/skills/maestro-manager/SKILL.md`: ack by handle (`r009-166`), shared-id refusal
- `plugins/maestro/.claude-plugin/plugin.json`: 0.15.2 to 0.15.3 (`.claude/maestro.json` `runtimeVersion` follows, via refresh)
- New tests: `test/core/landing-guards-173.test.ts` (items 1–2, real git repos, 11 tests) and `test/core/epic-inbox-ids-173.test.ts` (items 3–4, 5 tests)

## Did

- @backend: items 1–5, rebuilt the libs, patch bump, tests
- user: `pnpm refresh:runtime` (the sandbox blocked the mirrors)

## Deviations from the ticket

- None in scope. Not handled:
  - A conflict in a state file other than `status.json` (e.g. an epic `state.json`) still aborts and lists the files, as before.
  - A review pointer whose log entry was lost only keeps its id from being reused; it is not listed again as a waiting review.

## Decisions

- The merge treats the task as done when the branch's own tracker says so, so no `done` run on main is needed after switch-back.
- The overwrite refusal compares git blob ids to say whether a file matches the branch's copy. It prints a `git restore` command for identical files and `git stash push`/`pop` for different ones, and runs neither itself.
- The repository top comes from `git rev-parse --show-toplevel`. No sandbox is assumed and no path is hard-coded.

## Sibling impact

- Any project's merge: the refusal message is new, and a rewrite that happens after the check falls back to parsing git's own error.
- Epic managers: review requests now also create an inbox pointer file. Pointer files are never shown as orphaned reports.

## Questions

- Is leaving non-tracker state-file conflicts as an abort acceptable for this ticket?

## Verified

- Base HEAD `9459582` plus the uncommitted working tree (nothing committed yet)
- `pnpm verify`: lint, check, typecheck all pass; test 165 files, 3230/3230 passed
- `parity.test.ts` + `worktree-merge.test.ts`: 60/60 after the refresh
