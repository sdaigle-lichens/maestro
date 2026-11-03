# Task worktrees start with dependencies ready

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

When the orchestrator gives a task its own git worktree (via the task-status `worktree` command, or `freeform-check` for a freeform run), the worktree is a fresh checkout with no installed dependencies. In tasks 133 and 134 of the manager-review epic this meant the test and review steps could only read code, not run it; lint and the full verify could not run in the worktree (missing node_modules, turbo, prettier); one worker resorted to a temporary node_modules symlink that had to be removed by hand before merging; and the user had to run the install themselves partway through. Make a task worktree able to run the project's tests before any test or review step runs in it. The approach is open and needs a design decision: e.g. installing into the worktree from the shared package store, linking to the main checkout's dependencies, or having the worktree command detect the missing install and stop the run with the exact command for the user to run. Constraints: the plugin is used in any project, so detect the package manager from the lockfile rather than assuming pnpm, and degrade to clear guidance when it can't tell; package installs usually can't run inside the Bash sandbox, so the design must work when the agent cannot install and the user has to; nothing temporary may be left that has to be cleaned up by hand before merge; and a worktree whose dependencies are missing must never be reported as tested. Includes the worktree command and its TypeScript source, the regenerated plugin libs and tracked mirrors, the orchestrator template's worktree step, tests, and a plugin version bump.

## Acceptance criteria

- [ ] After a task worktree is created and before any test or review step runs in it, the project's test command can run in the worktree, or the run has stopped with the exact command the user must run there
- [ ] The package manager is detected from the lockfile; an unknown setup gets clear guidance instead of a wrong command
- [ ] No step can report a task as tested while its worktree has no installed dependencies
- [ ] Nothing temporary needs manual cleanup before the merge
- [ ] Tests cover detection and the missing-dependencies path; libs rebuilt, mirrors refreshed, parity test passes, plugin version bumped (patch), pnpm verify passes

## Blocked by

None — can start immediately
