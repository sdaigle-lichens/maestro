# Isolate concurrent sessions in a git worktree

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Today two Maestro sessions in one checkout cannot pick the same task (claims, 066) but still edit the same working tree, so they can conflict on files, dirty state, builds and tests. When a session claims a task and another LIVE session already holds a claim in the same repository, the orchestrator creates a git worktree on its own branch for this session's task and does all of the task's work there. A solo session, or one that finds no live foreign claim, behaves exactly as today in the main checkout. Decisions already made: (1) trigger only on a live foreign claim, never always; (2) the worktree is a sibling directory of the repo (named after the repo and the task), on a branch named after the task number; (3) when the task is done, the branch and worktree are left in place and the user is told to merge — nothing is auto-merged, pushed, or removed; (4) the task queue's status.json and claims stay shared and live in the main checkout, never forked per worktree, so a close or claim from inside a worktree is seen by every session; (5) no Docker or Sandcastle. The committed project-local install travels into the worktree, while gitignored per-session state is minted fresh there. The orchestrator's state root and the agents' working directory must move into the worktree while the queue root still resolves to the main checkout, so root resolution has to distinguish the two. A claim whose session dies is reaped by the existing liveness logic; its worktree is not deleted automatically, but the next session that sees it must not mistake it for live work. Out of scope here, filed as follow-up tasks: showing worktree sessions as tabs in the desktop app's Session Log (075) and an explicit opt-in merge or pull-request path for finished worktree branches (076).

## Acceptance criteria

- [ ] With no other live claim, a session claims and runs a task in the main checkout with no worktree created
- [ ] With another live session holding a claim, the second session's claim creates a sibling worktree on a task-named branch and runs the task there
- [ ] Subagents dispatched during the task operate inside the worktree, and edits made there do not appear in the main checkout's working tree
- [ ] status.json and claims written or read from inside the worktree are the main checkout's, so closing the task from the worktree marks it done for every session and the app's /maestro-tasks view
- [ ] On done, the worktree and branch remain, and the session reports the branch name and path for the user to merge
- [ ] A dead session's worktree is not removed and does not block or confuse a later session claiming other tasks
- [ ] A task whose worktree path or branch already exists is handled with a clear message instead of a crash
- [ ] Verified with two real concurrent sessions against one repository, including the gitignored session state in the worktree being separate from the main checkout's

## Blocked by

None — can start immediately
