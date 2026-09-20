# Resuming an agent, and the thinner injection that follows (`039`, `040`)

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
per-route protocols, and the report. Channel delivery and the `⚠️` unresolvable-workflow warning are
unconditional either way: they are the parts of the injection that are genuinely new each call. A
missing/unreadable log degrades to "not a resume" (full injection), the same safe direction as
`resumeTarget`.
