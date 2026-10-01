# Show worktree sessions as tabs in the Session Log

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Sessions that Maestro runs in a git worktree (see the task that isolates concurrent sessions in worktrees) write their own session log inside that worktree, which the desktop app cannot show today: the app tails one session log per window and only accepts the open project or a recent project as a viewing root, so a worktree's log would silently degrade to the main repo's. Make the Session Log a multi-tab view: the app lists the worktrees of the open project (git worktree list), offers a tab for each one that has a session log, and each tab tails and renders its own log with the same agent cards, logs panel and live indicator as today. Worktrees of the open project must become a deliberately recognised class of viewing root. Tabs must not be retargeted when the open project is switched (a worktree tab is not following the open project), and the single-owner tail design in the main process has to become one tail per window and tab. A worktree that disappears or has no log must degrade visibly, not show another run's log. This does not depend on Docker or Sandcastle and must also work for worktrees created by hand.

## Acceptance criteria

- [ ] The Session Log shows a tab for the main checkout and one for each worktree of the open project that has a session log
- [ ] Each tab shows only its own session's log and updates live
- [ ] Switching the open project does not re-point worktree tabs at the new project's main log
- [ ] A worktree path outside the open project's worktree list is rejected as a viewing root rather than falling back to the main repo's log
- [ ] A removed worktree or one with no log shows an explicit empty or removed state
- [ ] Works with worktrees created manually with git worktree add, not only ones Maestro created
- [ ] Verified in the running app with two concurrent sessions in two worktrees

## Blocked by

- `074-isolate-concurrent-sessions-in-a-git-worktree.md`
