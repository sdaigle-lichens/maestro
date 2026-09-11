# Claim a task so two sessions cannot take the same one

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

With two Maestro sessions running against one project, both can ask for "the next ready task" and
both get the same one — there is nothing on disk that says a task is already being worked. Give a
task an explicit, attributable, self-expiring **claim**.

**A claim is a file, not a status value, and that is the central decision.** `buildStatusMap` in
`tasks.ts` recomputes every task's status on each poll from the done-set plus `blockedBy`, emitting
only `done` / `ready` / `blocked`. An `in_progress` written into `status.json` would be erased by
the next recompute, and `status.json` is a read-modify-write of one shared file, so two sessions
claiming at the same instant can lose one another's write outright.

Instead:

```
<project>/.claude/maestro-tasks/claims/
  <task-file>.json        { session_id, claimed_at, project_root }
```

Created with an **exclusive create** (`flag: "wx"`). The create either succeeds or fails with
`EEXIST`, atomically, so two sessions racing for the same ticket cannot both win and neither needs a
lock. A failed claim is not an error — it means "someone has it, take the next one".

**Liveness comes free from `064`, and needs no heartbeat.** A claim is live when the claiming
session's `maestro_sessions/<session_id>/log.jsonl` was modified recently — the log is appended on
every tool call, so it already is a heartbeat. Two release paths follow from that:

- **Clean:** `SessionEnd` deletes the session's directory, so its claims are immediately detectable
  as dead and are dropped on the next read.
- **Crash:** the directory survives but the log stops being touched; a claim whose session log has
  been idle for more than **15 minutes** is treated as dead. That figure is decided, not a placeholder
  to tune — a live session touches its log on every tool call, so fifteen minutes of total silence
  means it is gone. Name it once (`CLAIM_IDLE_CAP_MS`) beside `CHANNEL_AGE_CAP_MS` rather than
  inlining the number at each read.

A dead claim is **reclaimable, not an error state**: reading the queue drops it, and the task goes
back to `ready`. Nothing should ever require a user to hand-clear a stuck ticket, which is the
failure mode a naive `in_progress` flag produces.

Claims are derived state, so they stay out of `status.json` entirely — `listTasks` overlays them at
read time, adding a `claim: { sessionId, claimedAt, live } | null` to `MaestroTask`. The status enum
is unchanged; a claimed task is still `ready`, with a claim on it. That keeps the whole
done/ready/blocked cascade and its two implementations (`tasks.ts` and `maestro-tasks.cjs`)
untouched.

**Surfaces:**

- `maestro-task-status.cjs` gains `claim <task>` (exclusive create, prints whether it won) and
  `release <task>` (removes its own claim only — never another session's). `done` releases the
  claim as part of closing.
- The orchestrator's "take the next ready task" path claims before starting and skips a task with a
  live claim, so the queue hands two concurrent sessions two different tasks. If every ready task is
  claimed, say so plainly rather than starting one anyway.
- The app's `/maestro-tasks` screen shows a claimed task as claimed, with the session and how long
  ago — and distinguishes a live claim from a dead one it is about to drop. It already live-refreshes
  via `tailTasks`, so the claims directory joins what that poller watches.

`claims/` is ephemeral project-local state: git-ignore it the same way `064` ignores
`maestro_sessions/` (a `.gitignore` containing `*` written on first create, plus the install
manifest entry), delete it on `/maestro-uninstall`, and never commit it.

**Out of scope:** any cross-machine coordination — claims are keyed on a session id that is only
meaningful on the machine that minted it, and a shared checkout on a network filesystem is not a
case this handles. No queue-wide lock, no ordering guarantee beyond "two sessions get two different
tasks", and no reservation of a task a session intends to take later.

## Acceptance criteria

- [ ] Two sessions asking for the next ready task at the same moment receive two **different** tasks;
      the losing claim fails with `EEXIST` and is handled as "take the next one", not as an error.
- [ ] A task with a live claim is skipped by the orchestrator's next-task selection; when every
      ready task is claimed, that is reported plainly rather than starting a claimed one.
- [ ] A claim whose session ended cleanly (its `maestro_sessions/<session_id>/` directory is gone) is
      treated as dead and the task is reclaimable, with no user action.
- [ ] A claim whose session crashed — directory present, log idle past the cap — is likewise treated
      as dead and reclaimable.
- [ ] `release` removes only the calling session's own claim; a claim held by another session is
      never removed by it.
- [ ] Closing a task releases its claim.
- [ ] `status.json`, the `done`/`ready`/`blocked` enum, and the `blockedBy` cascade are unchanged; a
      claimed task is still `ready` with a claim attached, and `tasks.ts` / `maestro-tasks.cjs` stay
      in agreement.
- [ ] `/maestro-tasks` shows claimed tasks with their session and age, distinguishes live from dead
      claims, and updates live through the existing tail.
- [ ] `claims/` is git-ignored in a project installed before this change, and is removed by
      `/maestro-uninstall`.
- [ ] Test coverage includes: two concurrent exclusive creates where exactly one wins; a claim for a
      removed session directory reading as dead; a claim with a stale log mtime reading as dead; a
      claim with a fresh log mtime reading as live; `release` refusing a foreign claim; and the
      status cascade being unaffected by any claim.

## Blocked by

- 064-per-session-maestro-session-state.md
