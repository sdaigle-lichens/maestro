# Make worktree runs write channels to the main checkout and merge only what was committed

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Three fixes found by the acces-portail-email walking-skeleton post-mortems (Maestro 0.13.27, Sonnet workers in git worktrees), all about a task running in a git worktree. This is a code change with tests, plus the orchestrator template's worktree and merge guidance, a rebuild of the generated plugin libs, a patch plugin version bump and the repo's runtime refresh.

1. Channel route in worktree runs. The route injected into a subagent names its payload file relatively (`.claude/channels/<scope>/<receiver>/<sender>.1.md`), while the worktree note in the same injection gives the main checkout's absolute channel directory. An agent working in the worktree resolved the relative route against the worktree, so the testing step wrote its payload under the worktree's `.claude/channels/` and the worker copied it across by hand. In a worktree session every injected channel path (routes to write, payloads waiting to read, the skill-gap note) must be the absolute main-checkout path, and so must every `deliver:` line the resume-target command prints for the orchestrator to hand a resumed agent, including a payload restored after a resumable session end (task 159), and the channel write guard must resolve and confine writes against that same path, so the two cannot disagree. Outside a worktree nothing changes. Earlier tasks 104, 139, 144 and 147 scoped and guarded worktree channel writes; this is the gap they left in the route text itself.

2. Clean-tree check before merge. A project's gitignore rule (`*.pem`) kept test fixtures out of the feature commit. Every step passed in the worktree, where the ignored files existed, but the merged commit failed lint and tests on the target branch, and the original file was lost when the worktree was removed. Before a worktree task is reported ready to merge (and before the worktree can be removed), the run must detect files the project's tests or checks depend on that are ignored or otherwise absent from the commit, and either verify the committed tree on its own (a clean checkout of the commit) or stop with a clear list of those files. The check must stay project-agnostic: no assumption about the package manager, the test runner or the file types. Choosing between a clean-checkout verification and a narrower ignored-file check is a design decision for this task, weighing cost against what it catches.

3. Git-excluded directories missing from worktrees. Directories excluded from git (for example a nested `apps/web/.claude` holding project skills) do not exist in a new worktree, so agents there run without them. When a task worktree is created, detect such directories that matter to the run (at least nested `.claude/` directories) and either make them available in the worktree or warn with what is missing. Task 135 covered installed dependencies only. Nothing temporary may be left that has to be cleaned up by hand before merge.

## Acceptance criteria

- [ ] In a worktree session, every channel path injected into a subagent is the absolute main-checkout path, and a test covers routes to write, payloads to read and the skill-gap note
- [ ] In a worktree session, every `deliver:` line printed by the resume-target command, including a payload restored after a resumable session end, is the absolute main-checkout path, and a test covers it
- [ ] The channel write guard accepts a write to that absolute path and confines it to the session's own scope exactly as before; a test covers a worktree agent writing its payload
- [ ] Outside a worktree, the injected text and the guard's behaviour are unchanged, and a test covers it
- [ ] Before a worktree task is reported ready to merge, a file the tests or checks need that is ignored or absent from the commit is caught, either by verifying the committed tree on its own or by listing those files and stopping; a test reproduces the gitignored-fixture case
- [ ] The clean-tree check names no specific package manager, test runner or file type
- [ ] Creating a task worktree detects git-excluded directories the run needs (at least nested .claude/ directories) and makes them available or warns about them, with a test, and leaves nothing to clean up by hand before merge
- [ ] The maestro plugin.json version gets a patch bump, the generated libs are rebuilt, pnpm refresh:runtime and the parity test pass (a sandboxed run hands the user ! pnpm refresh:runtime), and pnpm verify passes

## Touched surfaces

- plugins/maestro/scripts/maestro-inject-agent-context.js
- plugins/maestro/scripts/maestro-resume-target.cjs (its `deliver:` lines)
- plugins/maestro/scripts/maestro-channel-write-guard.js and apps/maestro/src/core/worktree-write-guard.ts
- plugins/maestro/scripts/maestro-task-status.cjs (worktree and merge commands) and its TypeScript source
- the orchestrator template's worktree and merge guidance (rendered STEPS / HANDOFFS)
- plugins/maestro/scripts/lib/*.cjs (generated) and the .claude/scripts mirrors
- plugins/maestro/.claude-plugin/plugin.json (version, shared)
- parallel OK with the other two tickets from this batch; merge order this one first, then the testing-step ticket, then the authoring ticket; each later one rebases, takes the next patch version and rebuilds generated files instead of hand-merging them
- base: current main (0.13.32 or later)

## Blocked by

None — can start immediately
