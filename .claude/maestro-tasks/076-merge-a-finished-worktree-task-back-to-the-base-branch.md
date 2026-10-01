# Merge a finished worktree task back to the base branch

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Today a task finished in a worktree leaves its branch and worktree in place and only reports them, so the user merges and cleans up by hand. Add an explicit, opt-in way to finish that work: bring a finished worktree task's branch into the base branch and remove the worktree and branch afterwards, or alternatively push it and open a pull request. The behaviour is never automatic by default; the user chooses it per task or via configuration. Conflicts must be surfaced to the user with the worktree intact, never resolved silently or by discarding work, and an unfinished or dirty worktree, or a branch whose task is not done, must be refused. The exact mechanism (local merge versus pull request, and whether it is a command, a skill or a step the orchestrator offers) is to be decided from how worktree tasks actually behave in use, since that is what this task depends on.

## Acceptance criteria

- [ ] A finished worktree task can be merged into the base branch on explicit request, and its worktree and branch are removed afterwards
- [ ] A pull-request path exists as an alternative, or the task records why one local mechanism is enough
- [ ] Nothing is merged, pushed or removed without an explicit request
- [ ] A merge conflict leaves the worktree and branch intact and tells the user what conflicted
- [ ] A dirty worktree, or one whose task is not done, is refused with a clear message
- [ ] Verified end to end against a real worktree task, including a conflicting case

## Blocked by

- `074-isolate-concurrent-sessions-in-a-git-worktree.md`
