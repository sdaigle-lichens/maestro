# Let worktree agents write their channel files without a classifier denial

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

When a task runs in its own worktree, its subagents write their handoff payloads into the main checkout's .claude/channels/, and Claude Code's auto-mode classifier intermittently denies that write as modifying a shared resource (seen in tasks 101, 102 and 137). Today the orchestrator works around it by writing the channel file itself (task 104), which costs a denied call and an extra step per handoff, leaves the file unstamped so the receiver only gets its path, and makes handoff-issues report a stale NO PAYLOAD for a resumed agent whose earlier file still exists. First establish whether an explicit project permission allow rule for writes under .claude/channels/ stops the classifier from judging those writes in auto mode; record what was observed. If it does: have maestro-install and maestro-update add that allow rule to the project's settings (merged idempotently, like the hook registrations), and tell subagents to create a channel file with the Write tool (which creates the folder) rather than mkdir in Bash, in the guidance the SubagentStart hook injects and the orchestrator template. Keep the orchestrator-writes-it fallback for a denial that still happens, and stop handoff-issues from reporting NO PAYLOAD for a resumed agent whose channel file from this run already exists. If the allow rule does not stop the denial, stop after recording the evidence and report it, so a different approach (channels inside the worktree) can be ticketed. Includes the installer change, the injected guidance and template text, the handoff-issues change, regenerated plugin libs if a plugin-entries source changes, tests, this repo's developer skill on channels, and a plugin version bump (patch).

## Acceptance criteria

- [ ] The task records whether an allow rule for .claude/channels/ writes stops the auto-mode classifier denial in a worktree run
- [ ] maestro-install and maestro-update add the allow rule idempotently; running either twice leaves settings unchanged the second time
- [ ] Subagent guidance and the orchestrator template say to write channel files with Write, not mkdir
- [ ] handoff-issues no longer reports NO PAYLOAD for a resumed agent whose channel file from this run exists
- [ ] The orchestrator-writes-it fallback still works when a write is denied
- [ ] If the allow rule does not help, the evidence is reported and nothing else is changed
- [ ] Tests cover the settings merge and the handoff-issues change; the plugin version is bumped (patch) and pnpm verify passes

## Blocked by

None — can start immediately
