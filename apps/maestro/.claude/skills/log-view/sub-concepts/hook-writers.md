# The writers — how the log gets written

The read side renders whatever these hook scripts append. All of them live in
`plugins/maestro/scripts/`, all are registered in `plugins/maestro/hooks/hooks.json`, and all share the
append helper `appendSessionLog` / `readStdin` in `plugins/maestro/scripts/lib/maestro-session.cjs`.

```
Active Maestro session
  PreToolUse hook   → maestro-session-log.js          → tool-call entry       (ts, origin, log)
  SubagentStart     → maestro-subagent-log.js         → dispatch entry        (kind:"dispatch", agent, agent_id, input)
  SubagentStart     → maestro-inject-agent-context.js → channel_delivery entry (kind:"channel_delivery", sender, receiver, agent_id, content) — (`036`/`037`)
  SubagentStop      → maestro-subagent-log.js         → handoff entry         (kind:"handoff", agent_id, status, label, output)
  SessionEnd        → maestro-session-cleanup.sh      → DELETE this session's directory only
```

All four hooks append to the same file — **the same file being "this Claude Code session's
`log.jsonl`" since `064`**, resolved by `resolveSessionId` from the hook payload's own `session_id`. A
subagent's hook payload carries the MAIN session's id, so a whole workflow run (orchestrator plus every
subagent it spawns) lands in one file, which is what makes `buildInstances`' `agent_id` correlation work
at all. All are no-ops when `maestro.json` is absent, and a **silent** no-op when no session id
resolves. The directory is deleted at that session's own SessionEnd, so the empty state is normal.

## `maestro-session-log.js` — tool-call entries (PreToolUse)

- **Hook event:** `PreToolUse`, matcher `.*` — fires on every tool call from any agent.
- **What it writes:** `{ ts, origin, log }`. `origin = p.agent_type || "main_session"`. `log` is a
  compact summary: `Read(/path)`, `Bash(cmd[:60])`, `Write(/path)`, `Skill(name)`, bare tool name for
  unknowns.
- **Gate:** exits immediately if `<cwd>/.claude/maestro.json` doesn't exist (Maestro not configured).
- **Append-only** (`fs.appendFileSync`) — parallel subagents can write concurrently without race
  conditions.

## `maestro-subagent-log.js` — dispatch + handoff entries (SubagentStart/Stop)

- **Hook events:** both `SubagentStart` and `SubagentStop`, matcher `.*` — the same script handles both,
  branching on `hook_event_name`. Same gate and append-only pattern as `maestro-session-log.js`.
- **On SubagentStart** → writes a `kind:"dispatch"` entry:
  ```json
  {
    "ts": "…",
    "origin": "main_session",
    "kind": "dispatch",
    "agent": "<agent_type>",
    "agent_id": "<agent_id>",
    "input": "<last_assistant_message>",
    "log": "→ <agent_type>"
  }
  ```
  `last_assistant_message` on SubagentStart = the main session's message that triggered the subagent
  spawn. This is the **Input** shown in the right detail panel.
- **On SubagentStop with an `agent_type`** → parses `last_assistant_message` for a `HANDOFF:` line (last
  occurrence, tolerant of surrounding backticks/asterisks), writes a `kind:"handoff"` entry:
  ```json
  {
    "ts": "…",
    "origin": "<agent_type>",
    "kind": "handoff",
    "agent_id": "<agent_id>",
    "status": "success|condition|unknown",
    "label": "<label|null>",
    "output": "<last_assistant_message>",
    "log": "HANDOFF: <label>"
  }
  ```
  `last_assistant_message` on SubagentStop = the agent's entire final message, including `HANDOFF:` +
  any `handoff_details` payload. This is the **Output** shown in the right detail panel. `agent_id` is
  shared across both entries for correlation.
- **On SubagentStop with NO `agent_type`** → not a real workflow handoff. Writes a `kind:"transition"`
  entry instead, so it can't masquerade as a failed/unknown agent run:
  ```json
  { "ts": "…", "origin": "transition", "kind": "transition", "output": "<last_assistant_message>", "log": "transition" }
  ```
  `buildInstances` segments this as its own neutral card (`status:"transition"`, displayName
  "Transition" via `titleFromName`); the message is kept as `output` for the detail panel.
- **`parseHandoff`:** takes the last `HANDOFF:` match; `"success"` (case-insensitive) →
  `status:"success"`, any other label → `status:"condition"`, no match → `status:"unknown"`.

## `maestro-inject-agent-context.js` — `channel_delivery` entries

**`channel_delivery` is written by the INJECTOR, not the logger script.** It is the same `SubagentStart`
hook that inlines a channel payload as `additionalContext` (see `maestro-architecture`'s HANDOFF routing
contract) — it appends this log entry itself, at the same moment, so the log has a durable record of
what was inlined without a second hook reading the same channel file. `origin` is hardcoded
`"main_session"` on this entry, same as a `dispatch` entry — it is not written into the receiving
agent's own segment, which is exactly why `buildInstances` correlates it by `agent_id` across the whole
array rather than by which segment it landed in (see `instance-correlation.md`).

## Hook registration (`hooks.json`)

```json
"SubagentStart": [{ "matcher": ".*", "hooks": [
  { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/maestro-inject-agent-context.js"] },
  { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/maestro-subagent-log.js"] }
]}],
"SubagentStop": [{ "matcher": ".*", "hooks": [
  { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/maestro-subagent-log.js"] }
]}],
"PreToolUse":  [{ "matcher": ".*", "hooks": [
  { "command": "node", "args": ["${CLAUDE_PLUGIN_ROOT}/scripts/maestro-session-log.js"] }
]}]
```

`maestro-inject-agent-context.js` and `maestro-subagent-log.js` are both registered under SubagentStart
— order is irrelevant since they write to different logical concerns (additionalContext vs. the log
file).

**These scripts run from the plugin dir, not the project copy.** Unlike
`maestro-set-session-workflow.cjs` and `maestro-render-orchestrator.cjs` (which are copied into
`.claude/scripts/` at install time), the PreToolUse/SubagentStart/SubagentStop scripts run directly from
`${CLAUDE_PLUGIN_ROOT}/scripts/`. Editing `maestro-subagent-log.js` takes effect immediately for all
projects, with no reinstall. Adding or removing the hook *registration* in `hooks.json` requires a new
Claude session to pick up.

## SessionEnd cleanup

`maestro-session-cleanup.sh` (SessionEnd hook) deletes **only the ending session's own**
`.claude/maestro_sessions/<session_id>/` directory — its `log.jsonl`, `session.json` and `tasks.json`
together — plus the three pre-`064` flat files if an older runtime left them. A sibling session's
directory is never touched, so one session ending no longer blanks a concurrent one's view mid-run. The
page's empty state is still the expected condition when no Maestro session is active — it is not an
error.

## Why SUCCESS/FAILURE requires `maestro-subagent-log.js`

The plain tool-call log from `maestro-session-log.js` has **no outcome data** — it records only that a
tool was called. The subagent's `HANDOFF:` line lives in its transcript (the `last_assistant_message` at
SubagentStop time), which is only accessible to a SubagentStop hook. Without `maestro-subagent-log.js`,
all instance `status` fields would be `null` and no icons would render status colors. See
`maestro-architecture` for the full HANDOFF routing contract and how the orchestrator uses the same
label to route the workflow.
