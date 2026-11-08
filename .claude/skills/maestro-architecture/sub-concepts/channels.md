# Agent channels (`036`)

The fifth piece of session state, and the one that carries a route's payload. Not a single file — a
directory of per-scope, per-receiver lanes:

```
<project>/.claude/channels/
  <scope>/                        <- `144`: task-<NNN> | session-<id8> | session-none
    <receiver>/<sender>.1.md      <- the payload the sender wrote
    scribe/<sender>.<n>.md        <- a stamped skill-gap report, kept until acknowledged (`112`)
    .consumed/<receiver>/...      <- retired after delivery (or, for a gap report, acknowledgement)
  <receiver>/, .consumed/         <- LEGACY pre-`144` layout: never delivered, aged out only
```

## Scopes (`144`)

Every lane function (`channelDir`, `laneFor`, `readLane`, `retire`, `writeStamp`, `acknowledgeGaps`,
`unstampedFilesOf`, resume delivery, meeting close) takes a `scope`, and a session only ever touches
its own. Before `144` two concurrent sessions (a worktree shares the main checkout's channels) injected
each other's payloads — 045's `test/backend.1.md` reached 048's `@test`.

| Scope | When |
| --- | --- |
| `task-<NNN>` | `session.json` `active_task` has a filename starting with digits |
| `session-<id8>` | no task; first 8 chars of the session id |
| `session-none` (`NO_SESSION_SCOPE`) | no valid session id (no `run_id` either, so nothing is ever inlined) |

- **Resolved only by hooks/scripts** (`channelScopeOf` / pure `channelScopeFromState` in
  `handoff-channels.ts`, following a worktree pointer), never by an agent. The agent is told the exact
  scoped file by its injected route text (`payloadRoutes`), and `SubagentStart` adds a `Channel scope
  for this session: <scope>` line.
- **A claim sets the scope (`147`).** `maestro-task-status.cjs claim` calls `recordActiveTask`
  (best effort, after the claim succeeds), which writes `active_task` to `session.json` (every other
  key kept) so the session moves to `task-<NNN>`; `maestro-set-session-workflow.cjs --task` does the
  same.
- **A task switch retires the left scope (`147`).** When recording changes the scope,
  `retireScope(projectDir, scope, ownSessionId)` moves every file in the old scope's lanes to
  `.consumed/`. It skips scribe gap reports and does nothing when another session directory still
  resolves to that scope, so it never takes a live session's payloads.
- **The worktree guard confines every agent to its own scope (`147`).** `checkWorktreeWrite` takes
  `channelScope`: in a worktree session, ANY caller (any agent, the main session) may write under
  `.claude/channels/` (main checkout or worktree-local copy) only inside `<scope>/`. Another task's
  lanes and the legacy unscoped layout are denied. `maestro-channel-write-guard` passes the scope.
- **The `/maestro` ChannelsCard** (`components/channel-lanes.tsx`) renders one lane per
  `<scope>/<receiver>` (`legacy` for the root layout) with `data-testid="channel-lane-<scope|legacy>/<receiver>"`,
  unique per scope.
- **Two session ids sharing their first 8 chars share a session scope.**
- **Legacy root lanes** (`<receiver>/`, root `.consumed/`) are never delivered, resumed or
  acknowledged; `pendingLanes` reports them with `scope: null` (all stranded), `sweep` ages them out.
- `isChannelScope` (`task-\d+` | `session-[A-Za-z0-9_-]{1,8}`) is what tells a scope dir from a legacy
  receiver dir. Test: `test/core/channel-scope-collision.test.ts`.

A sender writes its `handoff_details` payload straight to the receiver's lane instead of putting it
in its final message; the orchestrator never sees it (see `handoff-contract.md`).

## Delivery

`maestro-inject-agent-context.js`'s **fourth, independent block** delivers whatever is waiting for
the starting agent's BARE type in its session's own `.claude/channels/<scope>/<bareAgentType>/`:

- same-`run_id` entries are inlined verbatim as `additionalContext` and **retired** (moved to
  `.consumed/`, logged as a `kind:"channel_delivery"` entry);
- anything from a different or absent run is only **mentioned** (sender, age, path), never inlined;
- except a stamped scribe-lane **gap report**, inlined whatever its run and kept (see below).

It is gated on nothing but the lane having files — a filesystem fact, not a workflow-routing one,
which is what lets a gap reach `@scribe` on a run whose workflow never wired a route to it. Two
exceptions: a team-meeting participant gets no delivery at all, so nothing is inlined or retired
(see `team-meeting.md`); and a **resumed** run (`088`) is neither inlined nor retired, because
Claude Code drops a resume's `additionalContext`. Its current-run files are handed over by path —
`maestro-resume-target.cjs` prints them as `deliver:` lines for the orchestrator's `SendMessage` and
records them in `session.json` `resume_deliveries` — and retired at that run's own `SubagentStop`,
logged as `channel_delivery` with `via:"resume"` (see `agent-resume.md`).

## Test hints (`155`)

An implementer (`backend`, `frontend`, `mobile`) whose own success edge does not reach `@test`, but
which has a `test` agent later on its success path, still writes a `test/<sender>.1.md` file:
its test hints. `testHintRoutes()` (`handoff-routes.ts`) finds those senders. It is **never** merged
into `handoffRoutes()`, so the orchestrator can't route by these pairs. Three places consume it:

| Where | What it does |
|---|---|
| `handoff-sync.ts` | materializes the `<sender>/test` handoff files for these pairs too |
| SubagentStart (`maestro-inject-agent-context.js`) | injects `testHintRequirement()` ("write this with `HANDOFF: success`, whatever agent that route goes to") |
| SubagentStop (`maestro-subagent-log.js`) | adds the pairs to `agentPayloadRoutes`, so a missing hints file is a `missing_payload` issue |

Delivery needs nothing new: the file sits in `@test`'s lane with the run's stamp, so the block above
inlines it. The shape is hints-only (`hintsOnly`, `notHandled`, `howToRun`). Two rules hold on both
sides — the instruction and the test report: hints never set @test's scope (it plans from the
acceptance criteria and the code first, reporting `testOrigin` / `acceptanceCoverage` /
`hintsSkipped`), and hints never ask for a test framework, runner or structure the project doesn't
have (`howToRun: none: no tests for this part yet`; @test puts such a hint in `hintsSkipped`).

Unproven in practice (from one project's team meeting). If runs show implementers resumed only to
write a missing hints file, or `@test` adding a token "independent" test to satisfy `@reviewer`,
relax the reviewer's Coverage independence FAIL to a note in `plugins/maestro/agents/reviewer.md`
first. `test_origin` is self-reported; the reviewer's spot-check is the only real verification.

## Known gaps and later steps

`@test` used to end `HANDOFF: fail` on work it did not own, and the run stopped. Two cases came up:
docs that `@scribe` updates later in the same workflow, and a generated-file check that diffs
against HEAD, which nothing commits during a run. Both now go in the test report's `knownGaps`
(`issue`, `owner`, `reason`), never as a FAIL. The test → reviewer handoff carries the same list as
`known_gaps`, so the reviewer still sees them. The pre-`known_gaps` bodies are prior seeds
(`TEST_REPORT_V8`, `TEST_TO_REVIEWER_V3`). The test → reviewer body also requires the project's own
format, lint and type checks and the reported tests to run after the tester's last edit, and
`verified_tree` names the tree they ran on (`164`); its pre-`164` body is `TEST_TO_REVIEWER_V4`. An
unedited project copy upgrades through these prior seeds.

To make "a later step owns it" checkable, SubagentStart appends the steps that still run after the
agent to its handoff-routing block (`Still to run after you on this workflow's success path: @reviewer
→ @scribe`). `laterSuccessSteps()` (`handoff-routes.ts`) computes them: success edges only, the same
rule as `testHintRoutes`, and bounded on a success cycle. The hook guards the call, so a script
running against an older lib skips the line instead of failing.

## Scribe-lane gap reports (`112`)

The one exception to deliver-once. A **gap report** (`isGapReport`) is a scribe-lane file whose
fenced `json` block's top-level object has a **non-empty** `skill_gaps` (or legacy
`concept_skill_gaps`) array. An empty array — the seeded reviewer/refactor → scribe payload with
nothing to report — is an ordinary payload and keeps deliver-once.

| Step | What happens to a gap report |
| --- | --- |
| Sender's `SubagentStop` (`writeStamp`) | Stamped, then renamed off the `<sender>.1.md` write slot to the next free `<sender>.<n>.md` (`n >= 2`), so the sender's next gap can't clobber an unhandled one. |
| Any scribe's cold `SubagentStart` **in the same scope** (`144`) | Inlined **whatever run stamped it** (logged as an ordinary `channel_delivery`, once per scribe start) and **never retired**. The injected block tells the scribe to end with `SKILL_GAPS_HANDLED: <file>, <file>`. An unstamped one is only mentioned, like any unattributable file. |
| Resumed scribe | A current-run gap goes as a `deliver:` line like any file, but `retireResumeDeliveries` skips it. |
| Scribe's `SubagentStop` | `parseGapsHandled` reads every `SKILL_GAPS_HANDLED:` line; `acknowledgeGaps` retires exactly those files (gap reports only; a path-shaped or unknown name is ignored), each logged as `channel_delivery` with `via:"ack"`. Skipped for a meeting participant or owner run. |
| `SessionEnd`'s `sweep()` | Ages an unacknowledged one out at `CHANNEL_AGE_CAP_MS` like any lane file. |

"Handled" is whatever the scribe names: an enrich-only run (no SKILL.md edit, no stamp), a "left to
enrich" remainder and a concept with no graph all count. Maestro never parses a gap's `missing`
text, and never infers "handled" from a skill re-stamp. `payloadWrittenSince` (the `087` missing-
payload check) also accepts the sender's renamed gap reports in the receiver's lane, under the same
mtime rule. Test: `test/core/scribe-gap-retention.test.ts`.

## Restoring deliveries a restart cut off (`159`)

The one exception to deliver-once besides gap reports. A resumable SessionEnd keeps the session's
directory, so the `.consumed/` copies of what it delivered survive a `claude --resume` under the same
id. A run that the restart cut off never finished, so its payload would be lost: a cold inline and a
resume's `deliver:` line both read the live lane only, and the sender would be sent to rewrite a file
it already wrote (`missing:`, task 075).

`restoreInterruptedDeliveries` (`resume-delivery.ts`) moves such a payload back into the receiver's
live lane. It runs before the lane is read, in two places: a cold `SubagentStart`
(`maestro-inject-agent-context.js`, not on a resume) and `maestro-resume-target.cjs`. Once restored, the
normal paths take over: the cold start inlines it, the resume prints it as `deliver:`.

Nothing is restored unless the session's log holds a `kind:"session_end"` line (see
`session-end-reasons.md`). Then a consumed file comes back only when none of these holds:

| Guard | The payload is NOT restored when |
| --- | --- |
| No resumable end | the log has no `session_end` line. Deliver-once is untouched in an uninterrupted session. |
| Run stamp | its `run_id` is not this session's. |
| Gap report | it is a scribe gap report. An acknowledged one stays acknowledged. |
| Other scope | it sits in another scope's `.consumed/`. Only this session's scope is read. |
| Same-name lane file | the live lane already holds a file of that name. That one is the fresher payload. |
| Written after the end | its mtime is later than the `session_end` `ts`. |
| Receiver finished since | the receiver has a labelled `HANDOFF:` run logged after the payload's mtime. An earlier round already acted on it. |
| Re-delivered | a `channel_delivery` from that sender to that receiver is logged after the end. It was already handed to the re-run. |

Known limits:

- The receiver-finished guard counts only labelled handoffs. A run that stopped with no `HANDOFF:` line never blocks a restore.
- The re-delivery guard matches on sender and receiver, not file name.
- `unretire` refuses only a same-name file in the live lane. `retire`'s `renameSync` still overwrites a same-name copy already in `.consumed/`; that predates `159`.
- The timestamp checks compare file mtime with log `ts` (in ms), so a write and an end in the same millisecond cannot be ordered.

## Stamping and lifecycle

`SubagentStop` mints/reads the session's `run_id` (`ensureSessionRunId`, stored in that session's
`session.json` — per session since `064`, so two concurrent runs can no longer mint each other's
stamp) and calls `writeStamp(cwd, scope, bareAgentName(agentType), runId, { skip })`. The stamping rules,
all in `handoff-channels.ts`:

| Rule | Why |
| --- | --- |
| Only the **sender's own** `SubagentStop` stamps, and only files whose filename sender segment is its bare type, in any receiver's lane of its own scope (`144`). | A parallel subagent of another type can't stamp someone else's write. |
| Only **unstamped** files are stamped; an existing stamp is never rewritten. | Idempotent, and a stale stamp stays stale (see below). |
| A file in `skip` (the session's `meeting_leftovers`) that still has the same path, `mtimeMs` and `size` is left unstamped. Once rewritten, it is stamped as usual. | The `run_id` lasts the whole session, so without this the sender's next workflow run would adopt a team-meeting participant's leftover as its payload. A snapshot comparison, so it doesn't depend on clock or mtime granularity. |
| A team-meeting participant's `SubagentStop` doesn't stamp at all. | See `team-meeting.md`. |
| A file written by an agent killed before its `SubagentStop` stays unstamped. | It is then treated like a foreign-run file: mentioned, never inlined. |

**Worktree runs (`104`):** the auto-mode classifier denies an agent's channel write intermittently
(the Maestro guard itself allows `.claude/channels/`). So in a worktree run the orchestrator does not
resume the agent to retry; it writes the missing channel file itself from the payload in the agent's
final message (the `handoff-issues` worktree note) and names the path in the receiver's prompt. A file
written after the sender's `SubagentStop` is unstamped, so the receiver is told the path rather than
having it inlined. The SubagentStart worktree block also tells worktree subagents their shell starts in
the main checkout (use `pnpm --dir`, `git -C`, no `cd`). Test: `test/core/worktree-channel-delivery.test.ts`.

**The allow rule (`139`).** Both installers add `Write(/.claude/channels/**)` to `permissions.allow` in
the project's `.claude/settings.json` (`addChannelAllowRule`, idempotent, other keys and rules kept; a
malformed `permissions` is left alone). Claude Code evaluates allow rules before the auto-mode
classifier; one leading slash anchors the pattern to the settings file's project root, i.e. the main
checkout, so it is portable (`//path` is absolute, a bare path is relative to the session's cwd). The
payload instruction and the worktree block tell agents to create a channel file with `Write` (it makes
the folder), never `mkdir` in Bash, which the rule does not cover. **Evidence is one clean run, not
proof:** the denial was intermittent (tasks 101, 102, 137), so a worktree run with the rule in place
whose channel writes were all allowed (task 139, via an equivalent absolute rule in
`settings.local.json`) is consistent with the fix but cannot show it. The orchestrator-writes-it
fallback above therefore stays, and `handoff-issues` drops a `missing_payload` whose files are in
their lane stamped with this run's id (a resumed agent's earlier file) instead of reporting NO PAYLOAD.

A skipped leftover stays in its lane, is reported as unstamped (mentioned, not inlined) and is aged
out by `sweep()` like any other file. `unstampedFilesOf(projectDir, scope, sender)` is the snapshot
`closeMeeting` takes to build `meeting_leftovers`.

`SessionEnd`'s `sweep({ scope, reason })` retires **only the ending session's own** `<scope>/.consumed/`
outright (`144`) on a final end. On a resumable `reason` (`159`) that `.consumed/` is only aged out
like every other scope's, because the same session id may come back and restore from it. Then, across
every scope and the legacy layout, ages out anything past
`CHANNEL_AGE_CAP_MS` (14 days) — age-out is scope-blind because it depends only on the file's age.
Empty dirs are pruned after a 1-hour grace. Unlike the per-session files, a lane is **not** deleted at
`SessionEnd`: an undelivered, in-cap lane file (e.g. the scribe's, when no scribe ran) survives on
purpose — that is what lets a gap reach `@scribe` on a later run. The `SessionEnd` hook and the
delivery hook re-export the SAME `sweep()` from `lib/maestro-session.cjs`, so they cannot disagree
about "too old".

## Things that bite

- **A channel file's stamp, not its mtime, decides whether it's "this run".** `writeStamp` only
  stamps a file left **unstamped** by `SubagentStop` — a file stamped with a stale `run_id` stays
  stale forever, on purpose: `SessionEnd` deletes the session's directory, so the next run
  necessarily mints a new `run_id`, and a stamp minted in an abandoned run must never be mistaken
  for the current one. If a delivery that should have inlined is only being *mentioned* instead,
  check the `run_id` in the file's first line against the live session's, not when the file was
  written.
- **Retiring a channel file is the hooks' job alone — `SubagentStart` on a cold start, the resumed
  run's `SubagentStop` on a resume (`088`), the scribe's `SubagentStop` ack for a gap report (`112`)
  — never delete one by hand or from a script.** Retiring
  before the receiver has actually seen the file is the 085 bug. `retire()` moves a delivered file to `.claude/channels/<scope>/.consumed/<receiver>/`; it is
  never removed outright until `SessionEnd`'s `sweep()` ages it out (14 days). A delivered-but-then-
  failed agent's payload is recoverable for that window rather than gone the moment it was read.
- **A scribe that omits `SKILL_GAPS_HANDLED:` gets the same gap again on every later run** until
  the 14-day cap — by design, not a retirement bug. The instruction is in the injected delivery
  block, which a resumed scribe never sees (`088`), and since `114` also in the scribe report seed
  (`SCRIBE_ENDING_NOTE`) and the scribe agent file, which a resume keeps.
- **The desktop app surfaces both halves of this mechanism read-only (`037`)**, and neither surface
  writes back into it. `/session-log` renders a delivered payload on the *receiving* instance's Input
  panel from the `channel_delivery` log entry — see `log-view` in `apps/maestro/.claude/skills`.
  `/maestro` lists undrained lanes (files still sitting in `.claude/channels/`, not yet delivered)
  via a read-only `pendingLanes()` in `handoff-channels.ts`, splitting current-run from stranded off
  the same stamp described above; each lane is labelled `<scope>/<receiver>` (`legacy` for
  `scope: null`). `/agents`' Interactions pane (`agents-view`) labels each route's
  lane path but edits only the resolved `handoff_details` template, never the channel file itself.
