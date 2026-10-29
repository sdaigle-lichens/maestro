# Agent channels (`036`)

The fifth piece of session state, and the one that carries a route's payload. Not a single file — a
directory of per-receiver lanes:

```
<project>/.claude/channels/
  <receiver>/<sender>.1.md      <- the payload the sender wrote
  scribe/<sender>.<n>.md        <- a stamped skill-gap report, kept until acknowledged (`112`)
  .consumed/<receiver>/...      <- retired after delivery (or, for a gap report, acknowledgement)
```

A sender writes its `handoff_details` payload straight to the receiver's lane instead of putting it
in its final message; the orchestrator never sees it (see `handoff-contract.md`).

## Delivery

`maestro-inject-agent-context.js`'s **fourth, independent block** delivers whatever is waiting for
the starting agent's BARE type in `.claude/channels/<bareAgentType>/`:

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

## Scribe-lane gap reports (`112`)

The one exception to deliver-once. A **gap report** (`isGapReport`) is a scribe-lane file whose
fenced `json` block's top-level object has a **non-empty** `skill_gaps` (or legacy
`concept_skill_gaps`) array. An empty array — the seeded reviewer/refactor → scribe payload with
nothing to report — is an ordinary payload and keeps deliver-once.

| Step | What happens to a gap report |
| --- | --- |
| Sender's `SubagentStop` (`writeStamp`) | Stamped, then renamed off the `<sender>.1.md` write slot to the next free `<sender>.<n>.md` (`n >= 2`), so the sender's next gap can't clobber an unhandled one. |
| Any scribe's cold `SubagentStart` | Inlined **whatever run stamped it** (logged as an ordinary `channel_delivery`, once per scribe start) and **never retired**. The injected block tells the scribe to end with `SKILL_GAPS_HANDLED: <file>, <file>`. An unstamped one is only mentioned, like any unattributable file. |
| Resumed scribe | A current-run gap goes as a `deliver:` line like any file, but `retireResumeDeliveries` skips it. |
| Scribe's `SubagentStop` | `parseGapsHandled` reads every `SKILL_GAPS_HANDLED:` line; `acknowledgeGaps` retires exactly those files (gap reports only; a path-shaped or unknown name is ignored), each logged as `channel_delivery` with `via:"ack"`. Skipped for a meeting participant or owner run. |
| `SessionEnd`'s `sweep()` | Ages an unacknowledged one out at `CHANNEL_AGE_CAP_MS` like any lane file. |

"Handled" is whatever the scribe names: an enrich-only run (no SKILL.md edit, no stamp), a "left to
enrich" remainder and a concept with no graph all count. Maestro never parses a gap's `missing`
text, and never infers "handled" from a skill re-stamp. `payloadWrittenSince` (the `087` missing-
payload check) also accepts the sender's renamed gap reports in the receiver's lane, under the same
mtime rule. Test: `test/core/scribe-gap-retention.test.ts`.

## Stamping and lifecycle

`SubagentStop` mints/reads the session's `run_id` (`ensureSessionRunId`, stored in that session's
`session.json` — per session since `064`, so two concurrent runs can no longer mint each other's
stamp) and calls `writeStamp(cwd, bareAgentName(agentType), runId, { skip })`. The stamping rules,
all in `handoff-channels.ts`:

| Rule | Why |
| --- | --- |
| Only the **sender's own** `SubagentStop` stamps, and only files whose filename sender segment is its bare type, in any receiver's lane. | A parallel subagent of another type can't stamp someone else's write. |
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
out by `sweep()` like any other file. `unstampedFilesOf(projectDir, sender)` is the snapshot
`closeMeeting` takes to build `meeting_leftovers`.

`SessionEnd`'s `sweep()` retires `.consumed/` outright and ages out anything left in a live lane past
`CHANNEL_AGE_CAP_MS` (14 days). Unlike the per-session files, a lane is **not** deleted at
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
  before the receiver has actually seen the file is the 085 bug. `retire()` moves a delivered file to `.claude/channels/.consumed/<receiver>/`; it is
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
  the same stamp described above. `/agents`' Interactions pane (`agents-view`) labels each route's
  lane path but edits only the resolved `handoff_details` template, never the channel file itself.
