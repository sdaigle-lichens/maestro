# Review — task 171 (round 1, manager review run as human review: task is not in an epic)

## Goal
Unique epic report ids with unambiguous acks (including inboxes that already hold a duplicate), and a worktree `pnpm refresh:runtime` that generates only from its own checkout.

## Changed
- `apps/maestro/src/core/epics.ts` — id allocation, ack by handle/file, orphan inbox files
- `apps/maestro/src/core/report-defaults.ts`, `plugin-entries/maestro-report-defaults.ts` — `seededReportDefault`
- `plugins/maestro/scripts/maestro-install.js` — new `--checkout-seeds` flag
- `scripts/refresh-runtime.mjs` — passes `--checkout-seeds`
- `plugins/maestro/scripts/maestro-epic.cjs` (header comment), regenerated `scripts/lib/maestro-epic.cjs`, `lib/maestro-report-defaults.cjs`, and their `.claude/scripts/` mirrors
- `plugins/maestro/.claude-plugin/plugin.json` 0.15.1 → 0.15.2; `.claude/maestro.json` runtimeVersion stamp 0.15.0 → 0.15.2
- New tests: `test/core/epic-report-ids-171.test.ts` (10), `test/core/refresh-checkout-seeds-171.test.ts` (6)

## Did
- @backend: found both root causes, implemented the fixes and tests, bumped the version, rebuilt the libs.
- user: ran `pnpm refresh:runtime` (blocked for the sandbox).

## Root causes
- **Duplicate r009:** `state.json` is committed, so a git operation restored an older copy and dropped the r009-166 log entry. The inbox file was untracked and survived. Ids were counted from the log alone, so r009 was given out again. Fix: ids come from the log and the inbox file names together. Files are written with `wx`. The lock records an owner. Inbox files missing from the log are still listed and are re-logged on ack. An ack records its file. An ack on a shared id is refused (exit 1) and names each handle (`r009-166`, `r009-167`).
- **Refresh leak:** the ticket's guess was wrong; the root already resolves to the worktree. The machine-wide `~/.claude/maestro-handoff-defaults.sqlite` and `maestro-report-defaults.sqlite` are shared by every checkout. Any build that opens them runs `refreshSupersededSeeds`, which writes that build's seeds into them. A refresh elsewhere then saw the higher version in `syncProjectHandoffs`/`syncProjectReports` and copied the other branch's body in. The `runtimeVersion` change in the stash was not a leak: tasks 164 and 166 bumped to the same number. Fix: `--checkout-seeds` uses only bundled seeds and never opens the `~/.claude` stores.

## Deviations from the ticket
- The root cause differs from the ticket's assumption (see above).
- Not done: review ids (mNNN) are still allocated from the log only. The check that blocks an epic from ending ignores inbox files missing from the log. Normal installs and the app still read the shared stores, which is intended.

## Questions
- Does the review-id (mNNN) and epic-end orphan-file follow-up go to the queue?

## Verified
- Base commit e473388 plus the uncommitted working tree above (nothing committed yet).
- Parity test: 44/44 pass. `pnpm verify`: exit 0, 163 files / 3210 tests pass.
