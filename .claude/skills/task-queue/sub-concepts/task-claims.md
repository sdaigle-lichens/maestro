# Claims (`066`)

Claims are how two concurrent sessions asking for "the next ready task" get two **different** tasks,
without touching `status.json` or the `done`/`ready`/`blocked` enum — a claim is an overlay on
`ready`, never a fourth status.

```
<project>/.claude/maestro-tasks/claims/
  .gitignore              "*", written by ensureClaimsDir() on first create
  <task-file>.md.json     { session_id, claimed_at, project_root }
```

- **Created with an exclusive `fs` create (`flag: "wx"`).** The create either succeeds (this session
  won the race) or fails with `EEXIST` (someone else has it — take the next ready task instead).
  `EEXIST` is never an error condition here.
- **Liveness is derived, never trusted from the file's own content.** A claim is live iff its
  session's `maestro_sessions/<id>/` directory still exists AND that session's `log.jsonl` was
  modified within `CLAIM_IDLE_CAP_MS` (15 minutes, named beside `CHANNEL_AGE_CAP_MS` in
  `handoff-channels.ts`) — `064`'s per-session log already doubles as a heartbeat, so no new one was
  needed. A clean `SessionEnd` deletes the whole session directory, so that claim reads as dead
  immediately; a crashed session's directory lingers, so its claim ages out only once the log has
  been idle past the cap.
- **Dead claims are reclaimable, not an error state.** `readClaims` reaps them on read: a claim
  found dead is still returned once more (`live: false`, so a caller mid-read can show it dying),
  then its file is best-effort deleted, so the next read — and the next `claimTask` attempt — sees a
  clean slate with no user action.
- **`listTasks` overlays a claim at read time**, adding `claim: { sessionId, claimedAt, live } |
  null` to `MaestroTask`. The status enum and the `blockedBy` cascade are untouched — a claimed task
  is still `ready`, with a claim on it. `closeTask`/`done` releases the task's claim as part of
  closing.
- `maestro-task-status.cjs` gains `claim <filename>` (exclusive create, reports whether it won) and
  `release [filename]` (removes only the calling session's own claim, refusing a foreign one;
  falls back to `active_task` the same way `done` does).
- `claims/` is ephemeral, project-local, git-ignored the same way `064` ignores `maestro_sessions/`
  — see `installing-maestro`'s manifest sub-concept for the gitignore-manifest/`ensureXDir()` split
  this reuses, and its uninstall-and-purge sub-concept for why removing it isn't just another
  `SESSION_FILES` entry.

## The second parity pair

`apps/maestro/src/core/claims.ts` (`claimTask`/`releaseTask`/`readClaims`/`isSessionLive`) and the
claim/release logic hand-written directly inside `plugins/maestro/scripts/maestro-task-status.cjs` —
not in `lib/`, and not generated; there is no `plugin-entries/claims.ts` — must independently stay in
sync the way the cascade pair does. Parity is checked in `test/core/claims.test.ts` and
`test/core/task-claims-cli.test.ts`, not by `parity.test.ts`'s snapshot-diff pattern, since there is
no legacy CJS claims module being replaced.
