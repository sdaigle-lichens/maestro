# Show interim_settled session-log entries as their own row in the desktop log view

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 169 added a new session-log entry kind, interim_settled, written by the hand-off issues command when it settles an agent's interim stop. Its fields: ts (settle time), agent, agent_id, stop_ts (when the agent stopped), settled_as (missing or late_handback), label (the late hand-back's HANDOFF label, null when missing) and an optional handoff_issue (a judged problem with a late hand-back). The desktop app's log view does not know this kind and renders it as a generic entry. Give it a dedicated row that reads as 'this agent run's earlier stop was settled': agent and run id, when it stopped and when it was settled, whether it settled as a missing hand-off or a late hand-back (with the label), and the judged issue when present, styled like the existing hand-off rows (missing as a problem). Every displayed value comes straight from the log entry itself; no new data source and no computation from other entries. Older logs that contain no such entry render exactly as before. Code change in the desktop app's log view plus tests, and an update to the log-view concept notes (which currently say this kind renders generically).

## Acceptance criteria

- [ ] An interim_settled entry renders as a dedicated row showing agent, run id, stop time, settle time, settled_as and label, with the judged issue when present, and a test covers both the missing and the late_handback shapes
- [ ] All displayed values are read from the entry itself
- [ ] A log with no interim_settled entries renders unchanged, and a test covers it
- [ ] The log-view concept notes describe the new row instead of the generic-rendering gap; the app's lint, typecheck and tests pass

## Touched surfaces

- apps/maestro log-view renderer components and their tests
- apps/maestro/.claude/skills/log-view/sub-concepts/hook-writers.md
- no plugins/ change, so no plugin version bump

## Blocked by

- `169-write-a-durable-session-log-record-when-an-interim-stop-is-settled-as-missing.md`
