# Team-meeting mode

`/maestro-team-meeting` (plugin skill, `plugins/maestro/skills/maestro-team-meeting/`) has the main
session moderate the project's **real** configured agents (spawned, or resumed by `agent_id` in
post-mortem mode) so they *propose* changes to the Maestro setup. Without a flag those runs would
look like workflow steps to every hook. The flag is one key in **this session's** `session.json`.

| File | Role |
| --- | --- |
| `apps/maestro/src/core/meeting-mode.ts` | The flag: `readMeeting`/`meetingFor`, `startMeeting`/`endMeeting`/`closeMeeting`, `meetingLeftovers`, `meetingNotice`. Re-exported from `maestro-session` (`fs`/`path` only). |
| `apps/maestro/src/core/team-meeting.ts` | Pure meeting logic: briefs, proposal schema, conflicts, tally. Bundled as `maestro-team-meeting`. |
| `plugins/maestro/scripts/maestro-team-meeting.cjs` | CLI: `start`/`end`/`brief`/`conflicts`/`tally`. Runs from the plugin only, never copied into a project. |

## The flag

`session.json` `meeting: {id, mode: "review"|"post-mortem", dir, participants, started_at}`.
`participants` are **bare** agent names and only they are treated differently; every other subagent
in the session, and the main session (no `agent_type`), behaves normally. A malformed value reads as
"no meeting", the fail-safe direction. `dir` is informational: the guard recomputes it.

## What a participant gets, and what is withheld

| Hook | For a participant |
| --- | --- |
| `SubagentStart` inject | `meetingNotice` replaces the resume line, `HANDOFF:` routing, per-route protocols and the report, on a first run **and** a resume, because a resumed workflow agent still has its first run's routing in its history. The skills blocks stay on a first run, since they are what it reviews. **Channel delivery is skipped**: nothing is inlined and nothing is retired, so a payload waiting for its next workflow step is still there. |
| `SubagentStart`/`SubagentStop` log | `dispatch` and `handoff` entries carry `meeting: true` (`log` reads `(meeting)` / `meeting turn`). |
| `SubagentStop` | Skips the `078` transcript hand-back recovery and `writeStamp` entirely. |
| Write guard | Any agent type is confined to `<session dir>/meeting/`, its own channel lane included. |

## Resume targets

`agentRunsFromLog` drops **every** run of an `agent_id` that ever had a `meeting: true` handoff, not
just the meeting entry: that id's latest context is a notice telling it to ignore routing, so a later
condition-edge loop-back must not resume it. `hasCompletedRun` still counts meeting runs, because its
question ("is this SubagentStart a resume?") is answered by them. `maestro-post-mortem.js` likewise
keeps meeting turns out of its timeline and counts them separately.

## The write guard's meeting dir

`checkChannelWrite({..., meetingDir})` is passed `meetingDir` only for a participant, computed from
the caller's own session paths, never from tool input. The real path must equal the **real** session
directory plus `meeting`, with the `<id>` segment unchanged. A `meeting` entry that is a symlink, or a
session directory symlinked to another session's, is refused rather than followed. The guard fails
closed for a participant, like it does for reviewer/refactor.

## Evidence includes cross-session metrics (`080`)

`maestro-team-meeting.cjs brief` adds the durable run-metrics file (`.claude/maestro-metrics/`, see
`session-state.md`) to the evidence beside the session digest: recent full runs as detail, folded
totals per workflow and agent as trends, so a proposal can cite numbers across sessions. A session
that held a meeting is itself recorded with `team_meeting: true`.

## Ending a meeting

Two paths, both through `closeMeeting`:

- `maestro-team-meeting.cjs end` → `endMeeting`;
- `maestro-set-session-workflow.cjs`: **starting a workflow ends any meeting**, since a workflow step
  must never get meeting treatment. It is the one `session.json` writer that deletes a key; every
  other writer spreads the existing object, so `meeting` survives them.

`closeMeeting` removes `meeting` and records every participant's **unstamped** lane files as
`meeting_leftovers: [{path, mtimeMs, size}]`, merged with any earlier ones. The `meeting/` directory
(transcript, briefs, rounds, `decision.md`) stays until the session directory is removed at
`SessionEnd`. Why the leftovers exist: see the stamping rules in `channels.md`.

## Things that bite

- **The guard cannot see a Bash write.** A participant told "propose, never apply" can still write a
  lane file with Bash. `meeting_leftovers` is what keeps such a file from being adopted later. Don't
  remove it on the grounds that the guard already confines participants.
- **`start` refuses a stale project-local runtime.** A project that registers its own hook copies runs
  those, and a copy older than meeting mode would treat participants as workflow steps.
