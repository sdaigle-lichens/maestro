# Log entry schema and the derived `Instance`

Two shapes: what a line of `log.jsonl` contains, and what the renderer derives from a run of them.

## `SessionLogEntry` — what the JSONL file contains

Defined in `apps/maestro/src/core/contracts.ts`, re-exported by `src/shared/ipc.ts`. Every line is a
JSON object with at least `{ ts, origin, log }`; the rest is per-`kind`:

```ts
interface SessionLogEntry {
  ts: string; // ISO-8601 UTC timestamp
  origin: string; // "main_session" | agent_type (e.g. "backend", "Explore")
  log: string; // human-readable one-liner: "Read(/path)", "Bash(cmd)", "→ backend", "HANDOFF: success"

  // Present only on dispatch entries (SubagentStart):
  kind?: "dispatch";
  agent?: string; // the subagent's agent_type
  agent_id?: string; // unique identifier — links this dispatch to its matching handoff
  input?: string; // full spawning message (what the main session said to spawn this agent)
  offered_skills?: { loaded: string[]; referenced: string[] }; // skills the SubagentStart hook surfaced to this agent

  // Present only on handoff entries (SubagentStop with an agent_type):
  kind?: "handoff";
  agent_id?: string; // matches the dispatch entry for this run
  status?: "success" | "condition" | "unknown";
  label?: string | null; // raw HANDOFF label; null for "success" outcome
  output?: string; // full final message (agent's last message, incl. HANDOFF: line + payload)

  // Present only on transition entries (SubagentStop with NO agent_type):
  kind?: "transition";
  output?: string; // the final message of the non-workflow turn (e.g. "waiting on the user")

  // Present only on channel_delivery entries (SubagentStart, `036`/`037`) — a payload the injector
  // inlined for the RECEIVING agent's next invocation. origin is always "main_session" here, same
  // as a dispatch entry; agent_id is the receiver's own dispatch/handoff correlation key, NOT a
  // fresh id of its own.
  kind?: "channel_delivery";
  agent_id?: string; // the receiving instance's agent_id — same key input/offeredSkills use
  sender?: string; // bare agent name that wrote the payload
  receiver?: string; // bare agent name it was delivered to
  content?: string; // the payload body, inlined verbatim (no stamp — that's stripped before logging)
}
```

A missing `kind` = a plain tool-call entry from `maestro-session-log.js`. The schema is **backward
compatible**: old logs (tool-call-only) parse and display correctly; `dispatch`/`handoff`/`transition`
fields simply don't appear.

**Transition vs handoff.** A `SubagentStop` only carries an `agent_type` when a real workflow agent is
handing off. When `agent_type` is empty — a subagent stop that is not a workflow boundary at all —
there is no HANDOFF contract to parse, so `maestro-subagent-log.js` writes a `kind:"transition"` entry
with `origin:"transition"` instead of letting it fall back to `origin:"unknown"` + `status:"unknown"`.
This is what keeps non-workflow boundaries from masquerading as failed/unknown agent runs.

## `Instance` — the derived client model

`buildInstances` in `src/renderer/src/utils/session-log.ts` groups entries into segments (see
`instance-correlation.md` for how):

```ts
interface Instance {
  id: number; // position in the ordered list (stable key for all three panes)
  origin: string; // raw origin string
  displayName: string; // "Main Session" | titleFromName(origin)
  startIndex: number; // index of first entry in the flat entries[] array
  entries: SessionLogEntry[];

  status: "success" | "condition" | "unknown" | "transition" | null; // null = main_session; "transition" = non-workflow boundary
  label: string | null; // condition label, e.g. "tests_failed" (null for success)
  input: string | null; // spawning message from the matching dispatch entry
  output: string | null; // final message from this segment's handoff entry
  skillsTriage: SkillsTriage | null; // parsed { loaded[], skipped[{id,reason}] } from the agent's report
  offeredSkills: { loaded: string[]; referenced: string[] } | null; // from the dispatch entry's offered_skills
  delivered: ChannelDelivery[]; // channel_delivery entries logged at THIS instance's own SubagentStart (`037`); [] not omitted
}
```

`ChannelDelivery` is `{ sender, receiver, agent_id, content }` — the shape the detail panel's
"Delivered from @`<sender>`" block renders (`session-log-detail.tsx`). Always an array, even when
empty, so a template never has to special-case "no deliveries" from "not yet computed".

## The skills-triage audit

`skillsTriage` is parsed from `output` by `parseSkillsTriage` (pure, in `session-log.ts`): it grabs the
last fenced ` ```json ` block, `JSON.parse`s it, and reads the `skillsTriage` field every
skill-receiving agent emits in its final report (see `plugins/maestro/agents/*.md`). Any parse/shape
failure yields `null`, so the section is simply omitted — fully backward compatible with older logs and
agents that don't emit it. The triage data is already in `output`; that parse is a pure read-side
interpretation.

`offeredSkills` is the _other_ side of the diff: the skills the `SubagentStart` hook actually surfaced,
written onto the **dispatch** entry by `maestro-subagent-log.js` (correlated to the instance by
`agent_id`, same as `input`). `unaccountedSkills(inst)` is the diff — skills that were offered but
appear in neither `triage.loaded` nor `triage.skipped`, i.e. the agent **silently dropped** them. It
returns `[]` unless both sides are present (a diff is only meaningful when we know what was offered
_and_ what was reported). This is what makes the triage auditable rather than self-reported: a hollow
_reason_ flags a lazy skip, but an unaccounted skill catches a skill the agent omitted from its report
entirely.
