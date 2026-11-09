# Task 170 — review round 1 (manager review fallback: task is in no epic)

## Goal
Guard the report and merge path in the scripts, and ship one `land-the-task` end skill that walks commit → rebase → version → regenerate → verify → report → approval-gated merge.

## Changed
- New: `apps/maestro/src/core/landing-guards.ts` (report SHA guard, merge target guard, switch-back, dirty-tree check), `apps/maestro/src/core/verify-command.ts` (verify resolution), `plugins/maestro/skills/land-the-task/SKILL.md`
- `apps/maestro/src/core/{config,types,epics}.ts`, `plugin-entries/maestro-{epic,session}.ts` + generated `scripts/lib/maestro-{epic,session}.cjs` and their `.claude/scripts` mirrors
- `plugins/maestro/scripts/maestro-epic.cjs` (report guard), `maestro-task-status.cjs` (merge guard, branch-only merge, verify after merge, new `switch-back`, `done` notice)
- `plugins/maestro/templates/maestro/SKILL.md` Steps 6 and 8 (+ rendered `.claude/skills/maestro/SKILL.md`)
- `.claude/maestro.json`: `verify_command: "pnpm verify"`, `end_skills.maestro: ["maestro:land-the-task"]`
- `plugin.json` 0.14.1 → 0.15.0 (minor: new skill)
- Tests adjusted: `worktree-merge.test.ts`, `epic-boundary-cli.test.ts`

## Did
- @backend: all of the above; confirmed end skills render identically in a worktree run (the `!` line expands at `/maestro` start in the start dir, before any worktree) — except a session *started inside* a worktree dir reads that worktree's maestro.json.

## Deviations from the ticket
- Merge guard refuses on tracked changes only; untracked files are listed, not refused (the existing collision check already refuses the ones a merge would overwrite; strict-clean would block this repo on lock files).
- `merge` now also accepts a task branch with no worktree (the old "branch without worktree" refusal is gone).
- Verify config location chosen: optional `verify_command` in `.claude/maestro.json`, else detected `verify`/`test` script via the lockfile's package manager; none → `VERIFY NOT CONFIGURED`.
- Seed: `land-the-task` is NOT seeded for new projects (it commits/merges → opt-in).

## Decisions
- Failed verify after merge exits 1 but leaves the merge in place (it reports, does not revert).
- switch-back pre-checks writability and prints `! git -C <root> switch <default>` instead of attempting a switch the sandbox would half-apply.

## Sibling impact
- Parallel task (report-id/refresh-leak) must rebase on this and take the next patch, as the ticket planned.
- `/maestro:land-the-task` only resolves here once the plugin cache pulls 0.15.0.

## Questions / known gaps (for @test)
- A base commit can pass the report guard on a task branch with no commits of its own; with no task branch, any default-branch commit passes; uppercase SHAs not detected.
- No new tests yet — @test owns them next.

## Verified
- Uncommitted working tree on HEAD `1af323d` (nothing committed yet). `pnpm verify` run by the orchestrator: exit 0, 160 test files / 3159 tests passed; parity test 44/44 (backend).
