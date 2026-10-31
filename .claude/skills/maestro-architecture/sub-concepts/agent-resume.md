# Resuming an agent, the thinner injection, and resume delivery (`039`, `040`, `088`)

## A condition-edge loop-back can resume instead of spawn (`039`)

Step 3's "`Task()` each agent step" is the forward case only. Routing back on a condition edge, the
orchestrator first runs `node .claude/scripts/maestro-resume-target.cjs "<agent type>"` — a CLI that
reads the already-existing `kind:"handoff"` entries in **its own session's** `log.jsonl` (no new hook
write; `039` adds no log field) and prints the `agent_id` of that bare agent type's most recent
completed run this session, or nothing when there is none yet or the active workflow maps that agent
type to more than one distinct instance (ambiguous — the same guard `SubagentStart`'s injection would
hit).

A printed id resumes the agent via `SendMessage` addressed to that `agent_id` (never by name), so it
keeps its own memory of what it built; empty output, or a `SendMessage` refused (a user-stopped
agent, or a same-agent-name check), falls back to a cold `Task` exactly as before, with no visible
error.

An `agent_id` that ever had a team-meeting turn (`meeting: true` handoff) is never a resume target:
`agentRunsFromLog` drops all of its runs, since its latest context tells it to ignore routing.
`hasCompletedRun` still counts them (see `team-meeting.md`).

The **forward** success path is unchanged — always a fresh `Task`, since a clean context is the
point there, and restricting resume to backward edges is also what bounds context growth over a long
session.

## Resumed injection is deliberately thinner (`040`)

A resumed run still fires `SubagentStart`, and until `040` that meant re-injecting the same ~600
tokens of skills/routing/protocols/report the agent already has verbatim in its own history.
`maestro-inject-agent-context.js` now calls the same `hasCompletedRun(lines, agentId)` predicate
(`apps/maestro/src/core/agent-runs.ts`, beside `resumeTarget`; re-exported from
`lib/maestro-session.cjs`) to ask the identical question `resumeTarget` asks the other way around —
reading `kind:"handoff"` entries in this session's `log.jsonl`, never `kind:"dispatch"`
(order-independent with the sibling `maestro-subagent-log.js` write for the same run) and never this
session's `session.json`.

A resumed run gets one line — "Resumed run — the skills, handoff routes and output format from your
first run still apply." — in place of `loaded_skills`, `referenced_skills`, the `HANDOFF:` routing +
per-route protocols, and the report — **except the REQUIRED-payload instruction (`087`)**, which a
resume still gets (`payloadRequirement(..., { withShapes: false })`: the channel file per route, no
shapes). It governs the hand-back the resumed run is about to make; dropping it with the static
blocks is how task 086's second @reviewer pass ended without a payload. A missing/unreadable log
degrades to "not a resume" (full injection), the same safe direction as `resumeTarget`.

## A resume never receives `additionalContext` (`088`)

**Trap: everything above is what the hook *emits*, not what a resumed agent *sees*.** Claude Code
runs `SubagentStart` for a `SendMessage` resume but drops its `additionalContext` — the resumed
transcript has a `hook_success` attachment and no `hook_additional_context`. So the reminder line,
the REQUIRED-payload block and any inlined channel payload never reach a resumed agent. Before `088`
the hook still inlined the lane and retired it, so task 085's resumed backend found its lane empty.

A resume's payload therefore travels **by path, in the orchestrator's own `SendMessage`**
(`src/core/resume-delivery.ts`, in the `maestro-session` bundle):

| Step | Who | What |
| --- | --- | --- |
| 1 | `maestro-resume-target.cjs` | After the `agent_id`, prints `deliver: .claude/channels/<scope>/<receiver>/<file>` per current-run file in the target's lane **in this session's own scope** (`144`) and records them in `session.json` `resume_deliveries[<agent_id>]` (`{file, sender, run_id}[]`). |
| 2 | Orchestrator | Names every `deliver:` path in the `SendMessage` and tells the agent to Read it. It never reads the payload itself. |
| 3 | `SubagentStart` (resume) | Leaves the lane alone: no inline, no retire, just a path mention. |
| 4 | Resumed run's own `SubagentStop` | `retireResumeDeliveries` retires exactly the recorded files (matched by full scoped path, so a record from another scope retires nothing), logs each as `channel_delivery` with `via:"resume"` **before** the run's handoff entry, and drops the record. A scribe-lane gap report (`112`) is skipped: only the scribe's `SKILL_GAPS_HANDLED:` ack retires it (see `channels.md`). |

The same CLI also checks the loop-back's **expected** payload, resume or cold: if the latest
workflow handoff's route to this target resolves a protocol (`expectedLoopbackPayloads`, via
`payloadRoutes`) and no current-run file from that sender is in the lane, it prints
`missing: <file> (from <sender>)` and appends a `missing_payload` issue to `handoff_issues` (deduped
by kind, agent_id, files), so `handoff-issues` reports it too. The orchestrator then has the sender
write the file and reruns the CLI. A first output line starting `missing:` means no `agent_id`.
