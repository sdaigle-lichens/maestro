# Epics (`084`)

An epic groups related tasks that several `/maestro` sessions run at once, coordinated by one
resumable `maestro-manager` session. A task in no epic behaves exactly as before.

## Design Brief (the decisions)

**Module:** `apps/maestro/src/core/epics.ts`, shipped to projects as the generated lib
`plugins/maestro/scripts/lib/maestro-epic.cjs` (entry `plugin-entries/maestro-epic.ts`) behind the
CLI `plugins/maestro/scripts/maestro-epic.cjs`. One job: epic state, membership and the report inbox.

**Interface:** `create | list | link | unlink | show [--json] | set-manager | add-worker |
remove-worker | report --task | reports | ack`. Callers never see the lock, the file layout or the id
scheme.

**Decisions**

- **The tracker is the only source of membership.** A task joins an epic through the `epic` field of
  its `status.json` entry. The epic keeps no task list, so there is nothing to drift. Every rebuild
  path (`tasks.ts` `buildStatusMap`, the CJS twin's `buildStatusMap`, `sync`, `markDone`) preserves
  `epic`; `setTaskEpic` rereads and writes only the named entries, all-or-nothing (a missing task
  writes nothing).
- **Session names, never addresses.** `state.json` stores the manager and worker NAMES. An address
  belongs to one process and changes on restart; the manager rediscovers live sessions by name with
  `ListAgents` each time it opens or resumes.
- **Durable inbox plus acknowledgement.** The done step's `report` writes
  `.claude/epics/<slug>/inbox/rNNN-<task>.md` and a `report` log entry. The manager acknowledges with
  `ack`; the entry is the only delivery proof (cross-session messages have none). A report written
  with no manager survives and is listed unacknowledged on resume. Ids never repeat.
- **Write discipline.** All `state.json` writes go through `updateState`: mkdir lock (5 s wait, 15 s
  stale), reread fresh, atomic rename. The tracker write is read-then-rename without a lock, so it is
  safe for sequential writers, not for overlapping ones (four simultaneous `link` processes lost
  updates when tried). Do not claim otherwise.
- **Epic dir lives in the main checkout** (`mainCheckoutRoot`), like the queue, so worktree runs
  and the manager see the same epic.
- **A manager's message is never the user's approval.** Stated in the `maestro-manager` skill and
  the orchestrator template's PRINCIPLES.
- **No epic, no cost.** `report` checks for an epic before reading stdin and exits 0 saying the task
  belongs to none.

**Alternatives rejected:** a task list inside the epic file (second source of truth); storing session
addresses (stale on restart); a hand-written CJS twin of `epics.ts` (a third parity pair; the lib is
generated instead).

**Claims:** `claim --name "<session name>"` stores `session_name` in the claim file; a nameless claim
works and shows as `(unnamed)`. See [Claims](task-claims.md).

## Tests

`apps/maestro/test/core/epics-cli.test.ts` spawns the installed commands against temp projects:
create/link/unlink/show, linking a nonexistent task (exit 1, nothing written), sequential writers
keeping every entry and `epic`, claim with and without a name, report write/ack/list including no
manager, no-epic report, and `maestro-write-tasks.cjs --epic`.
