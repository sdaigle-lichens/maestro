# Agent channels (`036`)

The fifth piece of session state, and the one that carries a route's payload. Not a single file — a
directory of per-receiver lanes:

```
<project>/.claude/channels/
  <receiver>/<sender>.1.md      <- the payload the sender wrote
  .consumed/<receiver>/...      <- retired after delivery
```

A sender writes its `handoff_details` payload straight to the receiver's lane instead of putting it
in its final message; the orchestrator never sees it (see `handoff-contract.md`).

## Delivery

`maestro-inject-agent-context.js`'s **fourth, independent block** delivers whatever is waiting for
the starting agent's BARE type in `.claude/channels/<bareAgentType>/`:

- same-`run_id` entries are inlined verbatim as `additionalContext` and **retired** (moved to
  `.consumed/`, logged as a `kind:"channel_delivery"` entry);
- anything from a different or absent run is only **mentioned** (sender, age, path), never inlined.

It is gated on nothing but the lane having files — a filesystem fact, not a workflow-routing one,
which is what lets a gap reach `@scribe` on a run whose workflow never wired a route to it. It fires
regardless of first-run/resumed, because a payload may be new since the agent's last run.

## Stamping and lifecycle

`SubagentStop` mints/reads the session's `run_id` (`ensureSessionRunId`, stored in that session's
`session.json` — per session since `064`, so two concurrent runs can no longer mint each other's
stamp) and calls `writeStamp(cwd, bareAgentName(agentType), runId)`, stamping every **unstamped**
channel file whose filename's sender segment matches this agent's own bare type — a parallel
subagent of a different type can't stamp another's write.

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
- **Retiring a channel file is `SubagentStart`'s job alone — never delete one by hand or from a
  script.** `retire()` moves a delivered file to `.claude/channels/.consumed/<receiver>/`; it is
  never removed outright until `SessionEnd`'s `sweep()` ages it out (14 days). A delivered-but-then-
  failed agent's payload is recoverable for that window rather than gone the moment it was read.
- **The desktop app surfaces both halves of this mechanism read-only (`037`)**, and neither surface
  writes back into it. `/session-log` renders a delivered payload on the *receiving* instance's Input
  panel from the `channel_delivery` log entry — see `log-view` in `apps/maestro/.claude/skills`.
  `/maestro` lists undrained lanes (files still sitting in `.claude/channels/`, not yet delivered)
  via a read-only `pendingLanes()` in `handoff-channels.ts`, splitting current-run from stranded off
  the same stamp described above. `/agents`' Interactions pane (`agents-view`) labels each route's
  lane path but edits only the resolved `handoff_details` template, never the channel file itself.
