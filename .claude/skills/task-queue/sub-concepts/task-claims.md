# Claims (`066`)

Claims are how two concurrent sessions asking for "the next ready task" get two **different** tasks,
without touching `status.json` or the `done`/`ready`/`blocked` enum — a claim is an overlay on
`ready`, never a fourth status.

```
<project>/.claude/maestro-tasks/claims/
  .gitignore              "*", written by ensureClaimsDir() on first create
  <task-file>.md.json     { session_id, claimed_at, project_root, session_name? }
```

`session_name` (`084`) is optional and records the claiming session's name so an epic's manager can
find the worker by name. Since `113` the CLI fills it in: `storedName()` (the `maestro-<id8>` or
custom title the session-name hook put in `session.json`, see `maestro-architecture`) wins, and
`--name "<session name>"` is only the fallback; the orchestrator never reads its name from
`ListAgents`. A claim with neither still works and reads as unnamed. It is
exposed as `claim.sessionName` on `MaestroTask` only when set. See [Epics](epics.md).

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

## Worktree isolation (`074`)

When `claim` succeeds but **another live session is active** (holds a claim, or is a live freeform
session, below), the orchestrator runs
`maestro-task-status.cjs worktree <filename>` (template Step 2), which creates a sibling git worktree
`<parent>/<repo>-task-NNN` on branch `task-NNN` and moves the session's state into it
(`apps/maestro/src/core/worktree.ts` holds the pure naming/pointer helpers; the CLI does the `git`).

- **The queue never moves.** `status.json` and `claims/` always resolve to the *main checkout*, even
  when the code runs from inside a worktree — `mainCheckoutRoot(dir)` reads a linked worktree's
  `.git` file (`gitdir: <main>/.git/worktrees/<name>`) to find it. It exists twice, by hand:
  `worktree.ts` and `maestro-tasks.cjs` (which `tasksDirFor` goes through). Change one, change both.
- The command is a no-op (prints "no worktree needed") when no other live session is active, and
  **refuses, rather than reuses or overwrites,** a worktree path or branch that already exists —
  it tells the user and the orchestrator must not fall back to the main checkout.
- A worktree and its branch are **never auto-removed or merged by themselves**; `done` just reports
  branch + path to the user.

### Freeform session presence (`098`)

A freeform `/maestro` run (no task file) claims nothing, so a task session could not see it and both
would edit the main checkout. Its presence is its own `maestro_sessions/<id>/session.json`: a
recorded `workflow` and **no `active_task`** (a task session records `active_task` in the same call
and is found through its claim instead). `liveFreeformSession` in `maestro-task-status.cjs` reads it
with the same `isLive` rule as a claim (directory exists, `log.jsonl` modified within the idle cap).
Nothing is written to `claims/` or `status.json`, so a freeform run can never appear as a task.

- `liveForeignClaim` (used by `worktree`) falls through to `liveFreeformSession` after the claims, so
  a task session is told to isolate itself when a freeform session is live.
- `maestro-task-status.cjs freeform-check` is the freeform side (template Step 2, run after recording
  the workflow). With no other live session it prints "no worktree needed" (the first session never
  moves). `103`: with another live session it creates a worktree of its own, named from the session id
  instead of a task number: branch `freeform-<8 alnum chars of the id>`, path
  `<parent>/<repo>-freeform-<id>` (`freeformBranchFor`/`freeformWorktreePathFor`/`isFreeformBranch` in
  `worktree.ts`, exported through `maestro-session.cjs`). It shares `provisionWorktree` with the task
  `worktree` command, so refusals (path or branch already exists), the state move and the
  `worktree.json` pointer (`task` = the branch, plus `freeform: true`) are identical.
- `merge freeform-<id>` is the same `mergeWorktreeTask` as for a task, minus the "task is done" check
  (there is no queue entry); refusals and conflicts are reported the same way. A freeform worktree
  writes nothing to `claims/` or `status.json`, so it never appears in the queue or `maestro-epic show`.
- This logic is in the hand-written CJS only (no `claims.ts` twin); the hook-script change shipped as
  plugin `maestro` 0.11.15, the freeform worktree as 0.11.20.

### Finishing a worktree task (`076`)

`maestro-task-status.cjs merge <filename|NNN>` — a CLI subcommand (no new lib export, so no
`build:plugin-libs`), run by the orchestrator **only after the user explicitly asks** (template Step 4
offers it, never does it). Decided from how worktree tasks behave: the branch is a plain local
`task-NNN` the CLI already knows, the worktree is a sibling checkout, and `done` has marked the queue
in the main checkout — so the merge is one `git merge --no-ff` in the main checkout.

- **Refuses, changing nothing:** task not `done` in `status.json`; no branch / no worktree for it
  (found via `git worktree list`, not a guessed path); uncommitted changes in the worktree (the
  untracked `.claude/maestro.json` copy `worktree` made is ignored); main checkout on a detached HEAD
  or mid-merge; or git itself refusing because the merge would overwrite local changes.
- **Conflict:** the merge is aborted (`merge --abort`) so main is exactly as before, the worktree and
  branch stay, and the conflicting files are listed with how to resolve (merge the base into the
  branch inside the worktree, commit, ask again). The orchestrator never resolves one unasked.
- **Success:** `git worktree remove` (no `--force`), `git branch -d` (merged-only), and any session
  `worktree.json` pointer aimed at the removed path is deleted.
- **No pull-request mode, deliberately.** A PR needs a remote, a forge CLI and credentials the plugin
  cannot assume, and pushing is the one irreversible step; the branch is an ordinary local branch, so
  `git push -u origin task-NNN` plus the user's own PR flow works at any time before they ask for the
  merge. One local mechanism covers the in-use case; nothing is ever pushed.
