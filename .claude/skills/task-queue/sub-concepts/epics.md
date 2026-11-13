# Epics (`084`, `085`)

An epic groups related tasks that several `/maestro` sessions run at once, coordinated by one
resumable `maestro-manager` session. A task in no epic behaves exactly as before.

## Design Brief (the decisions)

**Module:** `apps/maestro/src/core/epics.ts`, shipped to projects as the generated lib
`plugins/maestro/scripts/lib/maestro-epic.cjs` (entry `plugin-entries/maestro-epic.ts`) behind the
CLI `plugins/maestro/scripts/maestro-epic.cjs`. One job: epic state, membership and the report inbox.

**Interface:** `create | list [--json] | link | unlink | show [--json] | set-manager | add-worker |
remove-worker | of | ready | report --task | note | review-request | review-verdict | reports | watch | ack` (`085` added `note` and `list`'s manager and
backlog columns; `100` added `of`; `125` added `ready`; `132` added `review-request`/`review-verdict`; `158` added `boundary`; `176` added `watch` and `add-worker --pane`). Callers never see the lock, the file layout or the id
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
- **The CLI fills in the caller's own name (`113`).** Sessions are named from their id
  (`maestro-<id8>`, `maestro-mgr-<id8>`, or a user-set custom title kept as is) by the
  `maestro-session-name` hook, which re-applies it on restart, so a restarted session keeps its
  name. `create --manager`, `set-manager` (name now optional), `report --from`, `note --from` and
  `ack --by` record the caller's stored name (`ownName()` → `storedSessionName`) in preference to
  the passed one, which is only a fallback. `add-worker`, run by the manager FOR a worker, prefers
  the caller's stored name only when the caller is a worker and not this epic's manager, else the
  `--task` claim's name (`taskClaimName`), else the typed name. This replaces `102`'s
  compare-with-`ListAgents`-then-`set-manager` step before every ack.
- **A failed send is not a gone manager (`102`).** `report` and `note` print a `sendFailedHint` after
  the "message the manager" line: on a failed `SendMessage`, run `ListAgents`; if exactly one session
  plausibly matches, ask the user before messaging it; never conclude the manager is gone from one
  failed send. The saved file is the delivery. Not printed when no manager is recorded.
- **Durable inbox plus acknowledgement.** The done step's `report` writes
  `.claude/epics/<slug>/inbox/rNNN-<task>.md` and a `report` log entry. The manager acknowledges with
  `ack`; the entry is the only delivery proof (cross-session messages have none). A report written
  with no manager survives and is listed unacknowledged on resume. Ids never repeat.
  - `171`: a new id is one past the highest used in the log AND in the inbox file names, because a
    git reset of the committed `state.json` can drop a log entry while its file stays. Inbox files are
    written `wx` (never overwrite), under the epic lock.
  - `171`: an ack records the entry's `file`, so it covers exactly that entry. An id shared by two
    entries is refused, listing each entry's handle (`r009-167`), and must be acked by handle or file
    name. `show`/`reports` print the handle.
  - `171`: a report or note file no log entry names is listed as an orphan, and `ack` re-logs it first.
  - `171`: `withLock` writes an owner token and releases only its own lock.
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
- **The report guard (`170`, `checkReportCommit` in `landing-guards.ts`).** A report that declares the
  task done (tracker `done`, or an `Outcome:`/`Status:` done line) is REFUSED, exit 1, nothing written,
  unless it names an existing commit:
  - while `task-NNN` has commits the default branch lacks: a commit on that branch, not already on the default branch;
  - otherwise: a default-branch commit whose message names `task-NNN` or the task file (the
    `Merge task-NNN (...)` commit `merge` writes, or a squash, hand merge or fast-forward naming the task).
  The refusal says what is missing (no SHA, no such commit, or not on the branch).
- **Sender fallback.** `report` without `--from` uses the claim's `session_name`
  (`claimSessionName` in `claims.ts`), else leaves the sender unset.
- **`of <NNN-task.md>`** prints the task's epic slug, or nothing when it is in none (`epicOfTask`);
  a script's cheap "is this in an epic?" check.

**Alternatives rejected:** a task list inside the epic file (second source of truth); storing session
addresses (stale on restart); a hand-written CJS twin of `epics.ts` (a third parity pair; the lib is
generated instead).

**Claims:** `claim` stores `session_name` in the claim file, the stored session name first and
`--name` only as a fallback (`113`); a nameless claim works and shows as `(unnamed)`. See [Claims](task-claims.md).

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
- `ack` takes `rNNN` and `nNNN`, or (`171`) a handle (`r009-167`) or file name; `show`/`reports` list unacknowledged reports and notes together,
  oldest first (`unacknowledgedReports` returns both, typed `EpicInboxEntry`).
- `132`: `EpicInboxEntry` also covers a `review` entry (`mNNN`, `{task, round, file, at, from?}`,
  `file` relative to the main checkout) from `review-request`. It is listed until a `verdict` log
  entry (`{id, task, verdict, effective, capped?}`) names it or a newer request for the same ticket
  supersedes it; `ack` refuses it. `m` is a third independent counter. The redirect cap (1 since `150`) and the
  worker's side are in `maestro-architecture`'s **Manager review** section.
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

## Spawning workers: `ready` (`125`)

Before the first spawn the manager makes sure `EPIC.md` holds a merge-plan table (`145`): one row per task with merge order, base branch, the version-file owner and the shared touched surfaces. Spawning follows that order. `ready <slug> [--cap <n>] [--json]` is the manager's spawn list (`readyTasks`, `formatReady`). The
`maestro-manager` skill runs it, then opens one herdr tab per `[spawn]` task (`herdr tab create`,
`herdr pane run <launch command>`, then `add-worker --task`); without herdr, or outside a herdr pane
(`HERDR_ENV` not `1`), or with `herdr status server` not printing `status: running`, it prints the
commands instead. The CLI itself never touches herdr. Under the Bash sandbox the herdr calls need
the opt-in `maestro-sandbox-allow.cjs --herdr` entries (`127`; offered by install and update, never
default, since `herdr pane run` escapes the sandbox) — see `installing-maestro`.

Each unfinished epic task (tracker `epic === slug`, oldest first) lands in exactly one bucket:

| Bucket | Rule |
| --- | --- |
| `running` | A **live** claim (`readClaims` → `live`). Wins over a recorded worker. |
| `pending` | A worker recorded with `add-worker --task` and no live claim: spawned, not started, or its claim aged out. |
| `ready` | Tracker `ready` **and** every `blockedBy` entry the tracker knows is `done` — a hand-edited stale `ready` never spawns a blocked task. Blockers in other epics or none count too. |

A fourth list, `waitingOnMerge` (`146`), holds tasks whose blockers are all done but at least one is
`unmerged` (see [Task files](task-files.md)); it is never spawnable. `formatReady` prints each as
`waiting on merge: <blockers> done but not merged (run merge or mark-merged)`. `ready` is not given
to it, so the manager must merge the blocker (or `mark-merged` after a hand merge) first.

`slots = max(0, cap − running − pending)`; the text marks the first `slots` ready tasks `[spawn]`,
the rest `[waits for a slot]`. `DEFAULT_SPAWN_CAP` is 5; `--cap` must be an integer ≥ 1.

- **`pending` is the double-spawn guard.** Without it a worker that has not claimed yet looks ready
  and a second one is spawned for the same task. A worker that never starts holds its slot until
  `remove-worker`.
- **Names and commands are derived, not stored.** `workerNameFor` → `<slug>-<NNN>` (or
  `<slug>-<basename>` with no number); `launchCommandFor` →
  `claude -n '<name>' [--model '<m>'] '/maestro .claude/maestro-tasks/<task.md>'`, POSIX
  single-quoted; `--model` is the project's `worker_model` (`134`, `resolveWorkerModel`), omitted
  when unset. The
  `maestro-session-name` hook keeps a `claude -n` name (`113`).
- **`cwd` is `mainCheckoutRoot`**, so run from a worktree it still prints the main checkout as the
  launch directory.
- **The docker runtime (`175`).** With `worker_runtime: "docker"` in `maestro.json`, `launchCommandFor`
  prints `node .claude/scripts/maestro-worker-runtime.cjs run --name '<name>' [--model '<m>']
  '.claude/maestro-tasks/<task.md>'` instead; the herdr steps do not change. `run` (in
  `worker-runtime.ts`, wrapped by `maestro-worker-runtime.cjs`) starts `docker run -it --rm` with:
  - the repo bind-mounted at its host path, and `.claude/settings.json`, `.claude/settings.local.json`
    (a copy with its `hooks` section removed), `.claude/scripts`, `.claude/hooks`, `.git/hooks` and
    `.git/config` mounted read-only over it;
  - the task's `<repo>-task-N` worktree mounted at its own path, so it exists on both sides;
  - `CLAUDE_CODE_OAUTH_TOKEN` read from `~/.config/maestro/worker-token` and passed by environment
    name only, never printed or put in argv. A missing file stops the launch before any container starts.

  The herdr socket is never mounted: pane input from the manager stays the only control channel.
  `image` builds the per-project image, tagged by a hash of the enabled plugins pinned to their host
  versions, the npm packages the hooks need, the Claude Code version, the uid/gid and the project path.
  **Not yet proven in a real container:** the in-container inbox-write prompt (unverified; left for task
  177's Docker run), plugin loading, worktree trust and the disabled sandbox. Each stays unverified until
  a real worker run records it in the task's report.

## Containerized workers: inbox, `watch` and pane replies (`176`)

A containerized worker is not in `ListAgents` and has no `SendMessage` route to its manager. Its
`report`, `note` and `review-request` print "no message is needed" instead of the SendMessage and
ListAgents lines (`deliveryWords`, `reviewDeliveryWords`), chosen by `isContainerWorker` from
`MAESTRO_WORKER_RUNTIME=docker`, which the launcher sets. Host output is unchanged.

| Piece | What it does |
| --- | --- |
| `watch <slug> [--for s] [--interval s]` | Read-only. Prints an `inboxPointer` line for each unacknowledged report or note and each unanswered review request, already-waiting ones first, each once per run (`newInboxAnnouncements`). Default 25 min, capped at 29 min (under Monitor's 30); the manager re-arms it. An acked entry is never announced. |
| `add-worker ... --pane <id>` | Records `EpicWorker.pane` (`state.json`, optional; `isValidPaneId`). `show` prints `(pane <id>)`. |
| Manager reply | `herdr pane run <pane> "[manager message] ..."`. The worker receives it as typed input. |
| `MANAGER_MESSAGE_MARKER` (`[manager message]`) | Pane input looks like user typing, so the marker says a manager wrote it. A worker never counts marked text as approval; a human review still prompts in the worker's own pane. |
| Review fallback | A containerized worker with a recorded manager does not fall back to a human review because the manager is missing from `ListAgents`. Host workers keep the old fallback. |

**Image plugin coverage (`176`).** `gatherImageSpec` now includes the user-scope enabled plugins from
`~/.claude/settings.json`, baked into the image as its own `user-settings.json` (`userSettingsJsonFor`;
image layout 4 in `imageTagInputs`). A local-directory marketplace is repointed to its baked copy, and a
pin whose install directory is gone is refused like an absent plugin. Before a worker starts, `run`
executes `imagePluginProbe` in the image; `parseProbeOutput` lists what is missing, and
`missingPluginMessage` refuses and names the plugin and the fix (rebuild; `docker image rm <tag>` when
`image` reuses it). The probe checks presence only: that the directory exists and the baked settings
enable the id. It does not show that Claude loads the plugin.

## Manager approval for containerized workers (`177`)

Opt-in: `"manager_approval": true` in `maestro.json` (absent or any other value is off). It applies only
to a containerized worker (`managerApprovalApplies`): a host worker always asks the user.

| Piece | Where |
| --- | --- |
| Record directory | `~/.config/maestro/approvals/` (`MAESTRO_APPROVALS_DIR` overrides). Outside the repo. Files: `<project>/<epic>/<task stem>/<stop>.json`. |
| Container mount | Read-only at `/home/worker/.config/maestro/approvals`, added only when the setting is on (`workerMounts`); `MAESTRO_APPROVALS_DIR` points there. A worker reads records, never writes one. |
| Manager's decision | `maestro-epic.cjs approve --task <t> --stop <stop> --commit <sha> --decision approved\|rejected`, `source: "manager"`. |
| Escalation | `approval-escalate` writes `<stop>.escalation.json` and prints the question to ask the user. |
| User's answer | PostToolUse `AskUserQuestion` on `maestro-human-review-gate` (`source: "user"`). Records only in the epic's manager session (its stored name equals the recorded manager), only for a question carrying the `approval-escalation:<task>:<stop>` marker, and only for an answer starting "Approve" or "Reject". |
| Check | `maestro-epic.cjs approval-check --task <t> --stop <stop> [--commit <sha>]`. |

**Matching (`checkApproval`).** A record approves only the exact task (basename), stop and commit. The
commit matches when both are at least 7 hex characters and one is a prefix of the other. Other task,
other stop, other commit, a `rejected` decision and a malformed file are all refused, with the reason named.

**Escalation list (`classifyEscalation`).** The manager cannot approve these; it runs `approval-escalate`
and the user answers in the manager session:

| Reason | Triggers when |
| --- | --- |
| `suite-not-green` | `--suite` is not `green` (for a merge, the merged result) |
| `scope-change` / `decision-conflict` / `security-finding` | named by the manager with `--escalation` |
| `outward-git` | a git or `gh`/`glab` command passed with `--op`: a push (force included), branch delete, history rewrite |
| `config-change` | a path passed with `--paths` under agents, skills, rules, workflows, handoffs, reports, hooks, templates, `maestro.json`, settings, `CLAUDE.md`/`AGENTS.md` |
| `second-redirect` | the ticket's redirect count reaches two |

The manager supplies these facts as flags; the CLI does not inspect the diff.

A rejection is always recordable. A pending escalation blocks a manager approval for that stop, and a
user record at the same commit cannot be replaced by the manager.

**Gate.** With the setting on and a containerized worker, `checkHumanReview` denies `AskUserQuestion` at
a human review whose review file exists, and the denial says whether a matching record exists
(`approvalGuidance`). The gate covers the human-review stop only; the commit and merge stops are checked by the
orchestrator's `approval-check`. Pane text and `[manager message]` lines are never approval.

## Epic boundaries: `boundary` (`158`)

`boundary <slug> start|end [--force]` decides whether the epic's start or end skills are due, claims
the run and writes its scope. Module: `apps/maestro/src/core/epic-boundary.ts` (`runEpicBoundary`,
`formatBoundary`), shipped in the generated lib `maestro-epic.cjs`. The git calls live there, not in
`epics.ts`, which keeps its fs/path-only rule; `epics.ts` exports `updateState` for it. Every git call
is read-only with a 10 s timeout, and a failure means "no git answer", never an error.

**Output:** one line. `nothing to run` (no list for this phase), `not due: <reason>`,
`already ran at <time>`, or `run <skills>` with the absolute scope file and its path count. The run is
claimed when the line is printed.

**State:** `state.json` gains `boundaries: { base?, start?: { at }, end?: { at } }`, where `base` is the
commit recorded at the start moment. Each run gets `.claude/epics/<slug>/boundary/<phase>-<n>/`, one
past the highest number on disk, so a rerun never overwrites an earlier folder.

| Phase | Due when | Scope |
| --- | --- | --- |
| `start` | At least one task, no recorded worker, no live claim, no task done | `## Touched surfaces` of the epic's tasks, existing files only |
| `end` | At least one task, every task done **and merged**, no unacknowledged report or note | Files changed from `base` to HEAD, existing files only |

- **Once only.** A phase with a claim returns `already ran`. `--force` re-runs it in a new folder. On a
  phase never claimed it changes nothing, and the due checks still apply. A forced start keeps `base`.
- **Base commit.** Recorded once at the start moment, even when the start list is empty and only the end
  list is configured, so the end scope works. Not recorded when the start moment has passed.
- **End fallback.** No base, an unreachable base or a non-git project uses the Touched surfaces rule.
- **Touched surfaces.** Only a bare or backticked path counts. Annotations (any whitespace), globs,
  `~`, absolute paths and `..` add nothing.
- **Scope paths.** Relative to the git root, or to the project when it is not in a repository. The end
  diff uses `diff.relative=false` with the `.` pathspec, so a project nested in its repository gets only
  its own files, and a user's `diff.relative` setting cannot change the paths.
- **Claim.** The decision, git calls, scope write and record run in one `updateState` callback. A throw
  records nothing and the retry runs. Concurrent callers: exactly one runs.
- **Stale claims.** A claim without a live session does not count as running, so it does not block the start.

Tests: `apps/maestro/test/core/epic-boundary-cli.test.ts` runs the installed CLI against temp projects
with real git: arguments; nothing configured; start due once, on resume, with no tasks, with workers,
with a live or stale claim, and with a done task; end due only after done, merged and acknowledged, and
not held by a review request; `--force` on an unclaimed and a claimed start; the scope rules including
nested and symlinked projects, a linked worktree and a non-git project; the empty-start base; concurrent
claims; one line per outcome; and that the command, manager skill and core module name no skill.

## Review ids and the end check (`173`)

- **Review ids are allocated like report ids.** `writeReviewRequest` takes the next `mNNN` from the log
  **and** the inbox files, then claims it by creating `inbox/mNNN-<task>.md` exclusively. A log that lost
  an entry (an older `state.json` put back by git) never reissues an id. The inbox file is a pointer
  only; the brief stays next to the task file.
- **The end check counts orphaned inbox files.** `unacknowledgedHandles` lists unacknowledged reports and
  notes by handle (`r009-167`, the form `ack` takes), including inbox files the log no longer lists. Two
  entries that share an id are both named. Review requests still do not hold the epic back.

## Tests

`apps/maestro/test/core/epics-cli.test.ts` spawns the installed commands against temp projects:
create/link/unlink/show, linking a nonexistent task (exit 1, nothing written), sequential writers
keeping every entry and `epic`, claim with and without a name, report write/ack/list including no
manager, no-epic report, and `maestro-write-tasks.cjs --epic`. `085`'s `cross-epic notes` block:
`list` text and `--json`; a note written and logged before return; refused routes and empty bodies
writing nothing; held-open stdin exiting promptly on a refused route; a note to a manager-less epic
acked once after resume; cross-epic `blockedBy` edges in both directions; separate, never-reused
`n`/`r` counters; the sender unable to ack; concurrent note and report writers keeping every entry.
`125`'s `ready` block: the three buckets, dead claims, stale `ready`, cross-epic blockers, the cap
and its clamp, unnumbered worker names, the main checkout from a worktree, bad `--cap`/unknown epic.
`128` adds: apostrophe filenames (numbered and unnumbered), whose printed command is run through a
real `sh -c` with a stub `claude` first on `PATH` recording argv (`shellArgv`); and claim liveness
judged by the session log's mtime (`fs.utimesSync`), not `claimed_at` — an old claim with a fresh log
stays `running`, a log idle past the cap comes back `ready` (reaped on read) or `pending` with a
recorded worker.
