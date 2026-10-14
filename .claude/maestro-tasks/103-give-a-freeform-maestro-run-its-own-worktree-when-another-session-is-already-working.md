# Give a freeform /maestro run its own worktree when another session is already working

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Since 098, every /maestro session can tell whether another live session (task or freeform) is working. A task session that finds one gets a worktree named after its task number. A freeform run (no task file) has no number, so when it finds another live session it can only stop and ask the user whether to share the main checkout.

Give a freeform run a worktree name of its own, derived from its session (for example a short session id), so the rule becomes the same for every session: no other live session means work in the main checkout; another live session means the session that starts second works in its own worktree. The freeform worktree is created, used by the subagents, and merged and cleaned up at the end exactly like a task worktree, through the same commands and the same orchestrator merge step; nothing about it appears in the task queue, status.json or the epic view. The first session never moves. Running alone still never creates a worktree.

## Acceptance criteria

- [ ] A freeform run that finds another live session (task or freeform) gets its own worktree and branch instead of asking to share the main checkout
- [ ] A freeform run with no other live session still works in the main checkout
- [ ] The freeform worktree is merged and cleaned up through the same merge step and command as a task worktree; a refusal or conflict is reported the same way
- [ ] Freeform worktrees never appear in status.json, the task queue or maestro-epic show
- [ ] Tests cover freeform-after-task, freeform-after-freeform, alone, and merging a freeform worktree; plugin libs rebuilt, mirrors refreshed, parity passes, pnpm verify passes, maestro plugin version bumped, and this repo's orchestrator re-rendered

## Blocked by

- `101-remove-the-braced-project-dir-variable-from-every-command-the-maestro-skills-run.md`
