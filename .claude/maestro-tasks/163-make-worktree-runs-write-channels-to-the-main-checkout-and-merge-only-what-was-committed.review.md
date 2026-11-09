## Goal

Task 163: in a worktree run, (1) every injected channel path is the absolute main-checkout path, (2) `merge` stops when files exist only in the worktree and are git-ignored (they would be lost with the worktree), (3) creating a worktree copies git-excluded nested `.claude/` directories into it.

## Deviations

- Fix 2 does not verify a clean checkout of the commit. The ticket left the choice open. A clean checkout would need installed dependencies in a second checkout (task 135, out of scope per your direction) and would have to guess how to run the project's checks. The chosen check compares the worktree's ignored paths with the main checkout's and lists those present only in the worktree.
- The `missing:` lines of the resume-target command are absolute too, not only the `deliver:` lines the ticket names. That file is one an agent must write, so it had the same bug.
- Added `merge <task> --accept-ignored`, a waiver for the user. The ticket named no such flag.
- `done` prints the ignored-files notice but does not refuse; only `merge` refuses. Step 4 runs before the commit is offered, so refusing there would force a reorder.
- One existing test was adjusted: `channel-scope-collision.test.ts`.

## Decisions

- Presentation only changes. Stored paths (`resume_deliveries`, retire and restore keys) stay relative.
- Callers use `state.worktree.main_root`, never `projectDir`.
- Excluded nested `.claude/` directories are copied, not symlinked: a `dir/` ignore rule does not match a symlink, so a link would show as untracked. A copy that shows as untracked is removed again and reported.
- Direction constraints followed: no package manager, runner or file type is named in the ignored-file check, and nothing installs or depends on installed dependencies.

## Touches

- `apps/maestro/src/core`: `handoff-channels.ts` (`channelPathFor`), `handoff-payload.ts`, `channel-write-guard.ts`, the new `worktree-footprint.ts`, `plugin-entries/maestro-session.ts`.
- Plugin scripts: `maestro-inject-agent-context.js`, `maestro-resume-target.cjs`, `maestro-channel-write-guard.js`, `maestro-task-status.cjs`; the rebuilt `maestro-session.cjs`; the orchestrator template's worktree and merge guidance.
- Version bump 0.13.32 to 0.13.33.
- New tests: `worktree-channel-paths.test.ts`, `worktree-footprint.test.ts`.

## Sibling impact

- Tickets 164, 165 and 166 also bump the plugin version and rebuild generated files, so merge order stays 163 first, then the later ones rebase and take the next patch.
- The template's STEPS region changed, so the rendered orchestrator and `.claude/scripts` mirrors need `pnpm refresh:runtime` run in this worktree.

## Questions

- Is the `--accept-ignored` flag name acceptable?
- Is making the `missing:` lines absolute as well acceptable?
