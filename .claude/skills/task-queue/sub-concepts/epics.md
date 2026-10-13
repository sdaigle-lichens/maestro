# Epics (`084`, `085`)

An epic groups related tasks that several `/maestro` sessions run at once, coordinated by one
resumable `maestro-manager` session. A task in no epic behaves exactly as before.

## Design Brief (the decisions)

**Module:** `apps/maestro/src/core/epics.ts`, shipped to projects as the generated lib
`plugins/maestro/scripts/lib/maestro-epic.cjs` (entry `plugin-entries/maestro-epic.ts`) behind the
CLI `plugins/maestro/scripts/maestro-epic.cjs`. One job: epic state, membership and the report inbox.

**Interface:** `create | list [--json] | link | unlink | show [--json] | set-manager | add-worker |
remove-worker | of | report --task | note | reports | ack` (`085` added `note` and `list`'s manager and
backlog columns; `100` added `of`). Callers never see the lock, the file layout or the id
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
- **The report is a step, not a memory (`100`).** `maestro-task-status.cjs done` prints the exact
  report command (`reportCommandFor`: epic slug, manager name or "no manager recorded",
  `report --task <t> --from "<claim session name>" --file -`); nothing is printed for a task in no
  epic. The orchestrator's Step 6 "Report to the epic" runs it (end skills is Step 7, worktree merge
  Step 8). `done` deletes the claim, so the name is read first and baked into the printed `--from`.
- **Sender fallback.** `report` without `--from` uses the claim's `session_name`
  (`claimSessionName` in `claims.ts`), else leaves the sender unset.
- **`of <NNN-task.md>`** prints the task's epic slug, or nothing when it is in none (`epicOfTask`);
  a script's cheap "is this in an epic?" check.

**Alternatives rejected:** a task list inside the epic file (second source of truth); storing session
addresses (stale on restart); a hand-written CJS twin of `epics.ts` (a third parity pair; the lib is
generated instead).

**Claims:** `claim --name "<session name>"` stores `session_name` in the claim file; a nameless claim
works and shows as `(unnamed)`. See [Claims](task-claims.md).

## Cross-epic notes (`085`)

Several managers can run on one project, one per epic. A manager notifies another epic's manager
through that epic's inbox, never through a message alone.

**Interface**

- `list [--json]` prints `<slug>  manager: <name|(none recorded)>  unacknowledged: N`
  (`listEpicSummaries`).
- `note <to-slug> --from-epic <slug> [--from "<name>"] [--subject "..."] --file <path>|-` writes
  `inbox/nNNN-from-<epic>.md` and a `note` log entry (`{id, from_epic, from?, subject?, file, at}`) in
  the RECEIVING epic's `state.json`, then prints the manager name to message, or that none is
  recorded and the note waits for a resumed manager.
- `ack` takes `rNNN` and `nNNN`; `show`/`reports` list unacknowledged reports and notes together,
  oldest first (`unacknowledgedReports` returns both, typed `EpicInboxEntry`).
- `show` adds **cross-epic dependencies**: tracker `blockedBy` edges with exactly one end in this
  epic (`blocked by` / `blocks`; the other side is another epic or no epic), blocker not done.
  `TrackerEntry` gained `blockedBy` for this.

**Decisions**

- **Route check before the body.** `checkNoteRoute` refuses an unknown receiver or sender, or a note
  to the sender's own epic, before stdin is read, same rule as `report`: a refused call must not
  block on held-open stdin. An empty body is refused after.
- **Separate counters.** `n` and `r` ids are numbered independently and never repeat; a note id
  belongs to the receiving epic only (the sender cannot ack it).
- **Note first, message second.** Same durability as a report: the file is on disk before any
  `SendMessage`, so a note to a stopped manager is listed unacknowledged on its resume.
- **A note is a teammate's request, never the user's approval**, and a manager never edits another
  epic's tickets; it asks that epic's manager.

**Policy: what affects another epic** (acceptance criterion 3, user-approved)

| Kind | Examples | Who detects it |
| --- | --- | --- |
| Shared Maestro setup change | agents, skills, workflows, rules, handoff templates, `maestro.json`; applying team-meeting changes | The manager, which makes the change: `EPIC list` + `EPIC show` before applying |
| Ticket change crossing epics | add/remove a `blockedBy` edge to/from another epic's task; re-block a task another epic depends on; link/unlink a task another epic owns | The manager; `show`'s cross-epic dependencies names the affected epics |
| Finding about a file or module another epic's tasks touch | a shared module turns out fragile | Manager judgment or user flag: tasks don't declare files, so auto-detection would be noise |

**Alternatives rejected:** reusing the `report` kind for notes (breaks report→task); plain
`SendMessage` (lost while the receiver is down); a project-wide bus (a second inbox); auto-detecting
file overlap.

## Tests

`apps/maestro/test/core/epics-cli.test.ts` spawns the installed commands against temp projects:
create/link/unlink/show, linking a nonexistent task (exit 1, nothing written), sequential writers
keeping every entry and `epic`, claim with and without a name, report write/ack/list including no
manager, no-epic report, and `maestro-write-tasks.cjs --epic`. `085`'s `cross-epic notes` block:
`list` text and `--json`; a note written and logged before return; refused routes and empty bodies
writing nothing; held-open stdin exiting promptly on a refused route; a note to a manager-less epic
acked once after resume; cross-epic `blockedBy` edges in both directions; separate, never-reused
`n`/`r` counters; the sender unable to ack; concurrent note and report writers keeping every entry.
