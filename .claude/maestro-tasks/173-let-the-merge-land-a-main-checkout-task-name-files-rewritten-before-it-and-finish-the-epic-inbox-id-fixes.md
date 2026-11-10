# Let the merge land a main-checkout task, name files rewritten before it, and finish the epic inbox id fixes

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Follow-ups found while landing task 171. Everything stays project-agnostic: maestro and its scripts do not always run in a sandbox, so sandbox handling remains a fallback, never the design assumption, and no repository-specific paths are hard-coded.

1. Merge of a task committed in the main checkout. After switch-back, the task merge refuses unless the default branch's task tracker marks the task done. Marking it done there leaves a local change to the tracker, which the task branch also changes, so git then refuses the merge with 'local changes would be overwritten'. The merge must land such a task without any manual step, merging the task's own tracker change rather than tripping over it.
2. Files rewritten between switch-back and merge. After switch-back in this session, a background tool regenerated derived files that the task branch also changes, and git refused the merge with a bare error. When a locally modified file would be overwritten by the merge, the merge must refuse with its own message: name each file, say whether its content matches the branch's copy, and print the command that resolves it. It must not discard anything on its own.
3. Epic review ids (mNNN) are still allocated from the epic log only. Allocate them like report ids now are (log plus inbox files, exclusive file creation), so a log that lost an entry never reissues an id.
4. The check that blocks an epic from ending ignores report files in the inbox that the log no longer lists. Make it count unacknowledged ones.
5. The published maestro-manager skill must document acknowledging a report by its handle (e.g. r009-166) and the refusal when an id is shared by two reports.
6. Review the plugin-libs-parity and installing-maestro concept notes against the sources changed since their last stamp, update them, and re-stamp them; also update any concept notes describing the merge path or the epic inbox.

This needs code in the plugin scripts or their TypeScript sources, tests for items 1 to 4, a published skill edit, rebuilt generated libs and mirrors, a patch version bump, and concept-note updates.

## Acceptance criteria

- [ ] Merging a task committed on its branch in the main checkout succeeds after switch-back with no manual step; a test covers it
- [ ] A locally modified file that the merge would overwrite makes the merge refuse with a message naming each file, whether it matches the branch's copy, and the resolving command; nothing is discarded automatically; a test covers it
- [ ] No sandbox is assumed and no repository-specific path is hard-coded in the merge changes
- [ ] Review ids are never reissued when the epic log lost an entry; a test covers it
- [ ] The epic-end check counts unacknowledged inbox report files missing from the log; a test covers it
- [ ] The published maestro-manager skill documents ack by handle and the shared-id refusal
- [ ] plugin-libs-parity and installing-maestro concept notes are reviewed, updated and re-stamped
- [ ] plugin.json gets a patch bump; libs and mirrors are refreshed and the parity test passes; the project's verify command is green on the reported commit

## Touched surfaces

- maestro-task-status merge / switch-back (plugin-entry source and generated lib)
- epic inbox review-id allocation and epic-end guard (apps/maestro/src/core/epics.ts, generated maestro-epic lib)
- plugins/maestro/skills/maestro-manager/SKILL.md
- plugins/maestro/.claude-plugin/plugin.json (patch bump)
- generated plugins/maestro/scripts/lib/*.cjs and .claude/scripts mirrors
- concept notes: task-queue, plugin-libs-parity, installing-maestro

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** The first implementation assumed the project is the git top level, so the Maestro-state exemption failed for a project in a subdirectory of the repo. @test found it in round 1, and in round 2 found two more defects of the same class (unwritablePaths joined repo paths onto the project dir; collidingUntracked mixed path bases). It took two @backend fix rounds before one path-base convention was set and audited.
  **Fix:** none
- **Problem:** A new test file failed Prettier. @test did not run the project's verify command (`pnpm verify`) before handing to review, so @reviewer failed on formatting and cost a round trip.
  **Fix:** none
- **Problem:** Each lib rebuild needed the user to run `! pnpm refresh:runtime` (the sandbox blocks `.claude/scripts/`), three times this session; @scribe's `skills stamp` hit EROFS on `.claude/skills/` and the computed stamps were applied with Edit instead.
  **Fix:** none
- **Problem:** The orchestrator recorded "mark-task-done" as a `plan` step, so the first `done` refused on its own node.
  **Fix:** none
- **Problem:** @test twice ended without writing its channel payload, so it had to be resumed to write it.
  **Fix:** none
- **Problem:** After `done`, the user asked to fix a reviewer warning (tracker re-applied only after cleanup). That fix brought in a new data-loss path, a second merge overwriting a leftover tracker backup, which @reviewer caught. A further wording round followed so that the refusal forbids copying the backup over the tracker: three more @backend rounds in all. The set-aside/re-apply design was not reviewed for multi-run failure modes up front.
  **Fix:** none
