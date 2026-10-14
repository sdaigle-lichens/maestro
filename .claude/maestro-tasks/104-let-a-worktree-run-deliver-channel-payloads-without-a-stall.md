# Let a worktree run deliver channel payloads without a stall

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

When a task runs in its own worktree, the task queue and .claude/channels/ stay in the main checkout. During task 102 a subagent working in the worktree had its write to the main checkout's channel file (.claude/channels/frontend/backend.1.md) denied by the auto-mode classifier (Modify Shared Resources). The handoff then reported NO PAYLOAD and the route stalled until the user approved a manual write. First establish whether every channel write from a worktree is denied or only this one. Then make a worktree run deliver channel payloads without a stall: either make that write permitted, or have the orchestrator write the channel file on the agent's behalf. The handoff-issues message (and any denial guidance) should say which of the two applies, so the orchestrator does not have to ask the user what to do.

Evidence so far, which points to a broader cause than one path. In task 102, three subagents working in the worktree (backend, test, reviewer) had their writes into the main checkout's `.claude/channels/` denied, on three different channel files with two different stated reasons. Each handoff showed NO PAYLOAD, and the user had to approve a manual write by the orchestrator each time. In task 101, also run in a worktree, the frontend and test subagents each had their first channel-file write denied, and a plain retry succeeded both times. So the denials are intermittent rather than a fixed rule, which fits the auto-mode classifier judging each cross-checkout write on its own.

A related worktree gap to fix in the same pass. In task 103, the backend subagent's shell started in the main checkout rather than the worktree, so its first `pnpm` commands ran against the main checkout (nothing changed, by luck). The dispatch prompt names the worktree path, but nothing tells a subagent that its shell does not start there, or that it must aim every command at the worktree (`pnpm --dir <worktree>`, `git -C <worktree>`, absolute paths) without `cd`, which the project's guardrails forbid. Make that part of what a subagent receives in a worktree run, so its commands land in the worktree from the first one.

## Acceptance criteria

- [ ] The cause is established: whether all channel writes from a worktree are denied or only some, and why
- [ ] A worktree run's subagent can get its handoff payload into .claude/channels/ without the route stalling on a user prompt, or the orchestrator has a documented, sanctioned way to write it for the agent
- [ ] The NO PAYLOAD message from handoff-issues says which path applies in a worktree run
- [ ] In a worktree run, every subagent is told that its shell starts outside the worktree and how to aim its commands at it (`pnpm --dir`, `git -C`, absolute paths, no `cd`)
- [ ] Nothing about how channel payloads are retired or read by SubagentStart changes
- [ ] Tests that pin the changed output are updated; plugin libs rebuilt if touched, mirrors refreshed, parity passes, pnpm verify passes, maestro plugin version bumped

## Blocked by

None — can start immediately
