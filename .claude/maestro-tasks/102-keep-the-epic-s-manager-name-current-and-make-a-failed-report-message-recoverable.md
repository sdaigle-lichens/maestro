# Keep the epic's manager name current and make a failed report message recoverable

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 100's report never reached the manager by message: the manager's session had restarted under a new name, the epic still recorded the old one, and the worker's send went to a dead name, after which it guessed a recipient. The maestro-manager skill already says to run set-manager when it opens or resumes, but a restarted session that continues its conversation never re-runs the skill's opening steps, so the stale name survives.

Two changes. In the maestro-manager skill's loop: each time the manager handles a report or note, it compares its own name in ListAgents with the epic's recorded manager and runs set-manager when they differ, before acknowledging. In the instruction that the epic report command prints after writing a report: if the message to the named manager fails, run ListAgents; if exactly one session plausibly matches, ask the user before messaging it; never conclude the manager is gone from one failed send, since the saved report file is the real delivery and the manager sees it as unacknowledged on its next check.

## Acceptance criteria

- [ ] The maestro-manager loop re-checks the session's own name against the recorded manager on every report or note and runs set-manager when they differ
- [ ] The report command's printed next step tells the worker what to do when the send fails: ListAgents, ask the user before messaging a plausible match, never treat one failed send as the manager being gone
- [ ] The report file remains the delivery; nothing about writing or acknowledging reports changes
- [ ] Tests that pin the report output are updated; plugin libs rebuilt if touched, mirrors refreshed, parity passes, pnpm verify passes, maestro plugin version bumped

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** The task ran in its own worktree because another session held a claim. Three subagents (backend, test, reviewer) had their channel-file writes into the main checkout's `.claude/channels/` denied by the auto-mode classifier ("Modify Shared Resources", "Irreversible Local Destruction"). Each handoff showed NO PAYLOAD and the route stalled until the user approved a manual write by the orchestrator, three times.
  **Fix:** none (follow-up task 104)
