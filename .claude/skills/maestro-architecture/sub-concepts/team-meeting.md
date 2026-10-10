# Team-meeting mode

`/maestro-team-meeting` (plugin skill, `plugins/maestro/skills/maestro-team-meeting/`) has the main
session moderate the project's **real** configured agents (spawned, or resumed by `agent_id` in
post-mortem mode) so they *propose* changes to the Maestro setup. Without a flag those runs would
look like workflow steps to every hook. The flag is one key in **this session's** `session.json`.

| File | Role |
| --- | --- |
| `apps/maestro/src/core/meeting-mode.ts` | The flag: `readMeeting`/`meetingFor`, `startMeeting`/`endMeeting`/`closeMeeting`, `meetingLeftovers`, `meetingNotice`. Re-exported from `maestro-session` (`fs`/`path` only). |
| `apps/maestro/src/core/team-meeting.ts` | Pure meeting logic: briefs, proposal schema, conflicts, tally. Bundled as `maestro-team-meeting`. |
| `plugins/maestro/scripts/maestro-team-meeting.cjs` | CLI: `start`/`end`/`brief`/`conflicts`/`tally`/`apply-placement`/`owner-runs`. Runs from the plugin only, never copied into a project. |

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

## Apply phase (`079`)

The moderator runs two user checkpoints with `AskUserQuestion`: the **agenda** before round 1, and
a **positions** check after round 1 (continue / redirect / stop). Approval is still one batch at the end.

`tally` writes `meeting/decision.json` (`{meetingId, rows, conflictTargets}`), the machine-readable
twin of `decision.md`, and deletes any stale `applied.json`. Both new commands read it, so they work
**after** `end`. Proposals may carry optional structured fields, kept by `parseProposalFile` and
copied onto `TallyRow`: `to` (`skill.placement`: `loaded`|`referenced`) and `content`
(`handoff.edit`: the full new template). An auto-tier row missing its field is skipped, not guessed.

| Command | Does |
| --- | --- |
| `apply-placement [--skip id,id]` | `applyAutoTier`: moves skills between an instance's `loaded_skills`/`referenced_skills` and writes `.claude/handoffs/<agent>/<name>.md` (must already exist). Re-reads `maestro.json` right before writing and changes only `workflow_instances` skill lists. Skips vetoed ids and conflicted targets. Writes `applied.json` (ids). |
| `owner-runs --approved id,id` | `planOwnerRuns`: groups approved rows, minus `applied.json`, into one run per owning agent (`ownerOf`) plus `main` ids. Refuses while the meeting flag is set, and when a conflicted target has more than one approved row. |

**Main-session-only kinds** (`ownerOf` returns null): `workflow.*`, `rule.to-agent`, `agent.create`,
`agent.delete`, `skill.delete`, `gate.change`, `skill.placement`, and any `blocked` row. Others are
owned by the agent named in the target (`handoff:`, `agent:`, `report:`), else by the sole proposer.

**Owner-run dispatch decision:** after `end`, the moderator launches each owner with the plain Agent
tool. No workflow is started, so the runs are ordinary: normal hooks, **no meeting notice**, no
`meeting: true` log entries. `owner-runs` refusing while the flag is set is what enforces it; a
run under the flag would be treated as a meeting turn.

## Things that bite

- **The guard cannot see a Bash write.** A participant told "propose, never apply" can still write a
  lane file with Bash. `meeting_leftovers` is what keeps such a file from being adopted later. Don't
  remove it on the grounds that the guard already confines participants. The apply phase changed
  neither the write guard nor this gap: owner runs are not participants, so they write normally.
- **`start` refuses a stale project-local runtime.** A project that registers its own hook copies runs
  those, and a copy older than meeting mode would treat participants as workflow steps.
