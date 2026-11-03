# Review: task 135, round 1

Worktree: /home/superadmin/gits/maestro-task-135 (branch task-135)

## Changed

- `apps/maestro/src/core/worktree-deps.ts` (new): lockfile-based package manager detection and installed-dependencies check
- `apps/maestro/src/core/plugin-entries/maestro-session.ts`: exports the new functions
- `plugins/maestro/scripts/maestro-task-status.cjs`: `worktree` and `freeform-check` print a `STOP:` notice with the exact install command when dependencies are missing; `done` refuses while the session's worktree lacks dependencies
- `plugins/maestro/scripts/lib/maestro-session.cjs`: regenerated (see deviations)
- `plugins/maestro/templates/maestro/SKILL.md`: the worktree step says to stop and relay the install command; no @test/@reviewer dispatch and no "tested" report until deps are installed; no installing or symlinking
- `plugins/maestro/.claude-plugin/plugin.json`: 0.13.2 -> 0.13.3
- `.claude/scripts/lib/maestro-session.cjs`, `.claude/scripts/maestro-task-status.cjs`: refreshed mirrors
- `apps/maestro/test/core/worktree-deps.test.ts` (new): detection, ambiguous/unknown cases, install command, installed/missing/not-applicable states, and the real CLI path

## Did

- @backend: implemented detect-and-stop (the design you chose), tests, lib rebuild, mirrors and version bump. Nothing was run because the worktree has no node_modules.

## Deviations from the ticket

- **Nothing verified.** No vitest, check, lint, typecheck, parity test or `pnpm verify` has run. The acceptance criterion "pnpm verify passes" is unmet until dependencies are installed.
- **Hand-fixed bundle.** `maestro-session.cjs` was built with the main checkout's esbuild through a loader hook. That dropped `"use strict";`, which was restored by hand. It must be rebuilt properly once dependencies exist and should match.
- **Version bump may conflict.** The main checkout's `plugin.json` is already modified, so 0.13.3 may conflict at merge.
- `freeform-check` has no test of its own, though it shares the code path.

## Next steps for you

1. `! pnpm --dir /home/superadmin/gits/maestro-task-135 install`
2. Rebuild libs and compare: `pnpm --filter maestro build:plugin-libs`, then check `git diff`
3. Run the worktree-deps, worktree-isolation and parity tests, then `pnpm verify`
