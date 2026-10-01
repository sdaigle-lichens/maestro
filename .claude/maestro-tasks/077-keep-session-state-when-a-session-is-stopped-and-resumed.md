# Keep session state when a session is stopped and resumed

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Stopping a Claude Code session and resuming it under the same session id currently loses the session's Maestro state, because the SessionEnd cleanup deletes the whole per-session directory on every end. After a stop and resume, the active workflow, active task and generated instances are gone, the session log has lost its pre-restart history (the earlier agent dispatches no longer appear), and the task claim held by that session is judged dead because its session directory no longer exists, so a concurrent session could take over a task still in progress. First establish, against the real hook payload, which SessionEnd reason values occur for a stop that will be resumed versus a final end, and record the finding. Then make cleanup keep the session's state when the end is resumable and keep removing it when it is final, so a resumed session finds its workflow, active task and log intact and its claim stays live. Both the node cleanup and its bash twin must make the same decision from one shared rule. Behaviour for a genuine end of session must not change. A fix to the task-status done/release commands (falling back to the session's own claim) already exists and is separate.

## Acceptance criteria

- [ ] The SessionEnd reason values observed for stop-then-resume versus a final end are documented, with how they were observed
- [ ] Stopping and resuming a session leaves its session.json (workflow, active_task) and log.jsonl intact, and its task claim still counts as live
- [ ] A final session end still removes only that session's state, and never a sibling session's
- [ ] The node cleanup and the bash cleanup apply the same rule, defined once
- [ ] Tests use real temp project directories with HOME and CLAUDE_CODE_SESSION_ID pinned, and cover resumable end, final end, and an unrecognised or missing reason
- [ ] plugins/maestro/.claude-plugin/plugin.json version is bumped and any generated plugin lib is rebuilt via pnpm --filter maestro build:plugin-libs
- [ ] pnpm --filter maestro typecheck and pnpm --filter maestro test pass

## Blocked by

None — can start immediately
