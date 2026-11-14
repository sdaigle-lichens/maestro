# Review 182: landing steps take the default branch only from origin/HEAD

## Goal

Every landing step (task-branch start, rebase, merge, the main-checkout default-branch check, switch-back) resolves the default branch from origin/HEAD only. With origin/HEAD unset they refuse, change nothing, and print `git remote set-head origin --auto` and `git remote set-head origin <branch>`. Messages that name the default branch say it comes from origin/HEAD.

## Deviations

- The new worktree is created from the default branch (the local branch if it exists, else `origin/<def>`), no longer from the checked-out HEAD. The ticket's "task branches start from ... dev" requires it.
- About 20 existing test fixtures now set origin/HEAD after the init commit, because their repos have no remote and the main/master fallback is gone.
- `maestro-epic.cjs report` with origin/HEAD unset does not refuse. `checkReportCommit` already copes with a null default branch, and the ticket lists no such criterion.

## Decisions

- `defaultBranch` returns the origin/HEAD target minus `origin/`, else `null`. `originHeadUnsetMessage(root)` holds the single refusal text and is exported through `plugin-entries/maestro-session.ts`.
- Skill and template wording (`land-the-task` `<DEFAULT>`, the maestro-manager merge-plan base, template step 8) follow the same rule, with no "else main".

## Touches

- `apps/maestro/src/core/landing-guards.ts`, `plugin-entries/maestro-session.ts`; generated libs `maestro-session.cjs` and `maestro-epic.cjs`
- `plugins/maestro/scripts/maestro-task-status.cjs` (messages, header comment)
- `plugins/maestro/skills/land-the-task`, `skills/maestro-manager`, `templates/maestro/SKILL.md`
- `plugins/maestro/.claude-plugin/plugin.json` (patch bump to 0.15.14)
- `.claude/scripts` mirrors and the rendered orchestrator STEPS (via `pnpm refresh:runtime`)
- New `test/core/landing-guards-182.test.ts` (9 tests); about 20 fixtures updated

## Sibling impact

- The main checkout already carries an uncommitted plugin version 0.15.14, from 178 or 181. Whichever of 178, 181 and 182 merges later conflicts on `plugin.json` and the shared `maestro-epic.cjs` lib, and must rebase, re-bump and rebuild.
- `.claude/maestro.json` shows as modified in the worktree after `refresh:runtime`. The test or reviewer step should confirm that change is intended.

## Questions

- None blocking.

## Verified

- Based on commit 59cdbc1 on branch `task-182`. The work is uncommitted in the worktree.
- Full suite (`pnpm --filter maestro exec vitest run --testTimeout=60000`) after `pnpm refresh:runtime`: 3484 tests passed, 5 skipped, none failed. 179 of 187 files passed. The other 8 are not failures; the one unhandled error is a missing Playwright browser (`chrome-headless-shell` not installed).
- With the default 5 s timeout, 4 tests timed out under full-suite load (`epics-cli`, `landing-guards-173-backup` x2, `team-meeting-dry-run`). All pass with the longer timeout.
- Parity test: covered by the full run (green after refresh). `check`, `lint` and `typecheck` passed per the backend.
