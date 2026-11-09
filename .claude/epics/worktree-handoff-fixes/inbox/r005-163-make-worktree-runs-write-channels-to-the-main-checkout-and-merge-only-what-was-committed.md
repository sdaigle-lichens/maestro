# Report r005: 163-make-worktree-runs-write-channels-to-the-main-checkout-and-merge-only-what-was-committed.md

- Task: 163-make-worktree-runs-write-channels-to-the-main-checkout-and-merge-only-what-was-committed.md
- Written: 2026-11-09T01:25:49.066Z
- From session: worktree-handoff-fixes-163

Task 163 done on branch task-163, commit a6e2b9c (not yet merged).

- Fix 1: every injected route, payload, waiting lane, skill-gap note, `deliver:` and `missing:` line, and the guard use the absolute main-checkout channel path in a worktree run. Stored identity stays relative.
- Fix 2: `merge` refuses when git-ignored files exist only in the worktree, unless the user passes `--accept-ignored`. `done` does not refuse. No package manager or runner is named.
- Fix 3: git-excluded nested `.claude/` directories are copied into a new worktree (not symlinked).
- Plugin 0.13.32 -> 0.13.33, libs rebuilt, refresh:runtime run in the worktree.
- Verified on the commit: pnpm verify green (148 files, 2952 passed, 5 skipped); parity test 44/44.

Deviations: no clean-checkout verification (needs installed deps, task 135 scope); `missing:` lines are absolute too; new `--accept-ignored` flag; one existing test adjusted (channel-scope-collision).
Also in the commit: the task 164 seed drift (`.claude/handoffs/test/reviewer.md` and the `test/reviewer` entry in `.claude/maestro.json`), produced by refresh.
Ignored-files notice from `done`: none printed (run from the main checkout).
Merge order: 163 first; 164, 165, 166 rebase and take the next patch version.
