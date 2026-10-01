# SessionEnd reasons and what cleanup keeps (`077`)

`SessionEnd` fires for a stop that will be resumed under the **same session id** and for a final end
alike. Before `077` both deleted the session directory, so a resumed session lost `session.json`
(workflow, `active_task`, `run_id`, generated instances), its `log.jsonl` history, and its task
claim's liveness (`isSessionLive` needs the directory to exist). The payload's `reason` is what
tells them apart.

## The rule — defined once

`endSessionState(claudeDir, sessionId, reason)` in `apps/maestro/src/core/session-paths.ts`, shipped
through `lib/maestro-session.cjs`. Both `maestro-session-cleanup.cjs` and `maestro-session-cleanup.sh`
call it (the .sh passes `reason` through verbatim from python3-parsed JSON), so they cannot disagree.

| `reason` | Treated as | Why |
| --- | --- | --- |
| `prompt_input_exit` | resumable — keep | observed: `/exit` in an interactive session |
| `other` | resumable — keep | observed: `claude -p` finishing; SIGTERM / SIGINT kill |
| `resume` | resumable — keep | documented value (`/resume` switching away); NOT observed |
| `clear` | final — remove | observed: `/clear` ends the old id and starts a new one |
| `logout`, `bypass_permissions_disabled` | final — remove | documented values; not observed |
| anything else, or no `reason` | final — remove | allow-list on purpose: an unknown value must not start leaking directories, and an older Claude Code sends none |

A final end is the pre-`077` behaviour unchanged: only that session's directory plus the legacy flat
files. A resumable end removes nothing at all (the legacy files stay too). Channels are still swept
either way.

## How it was observed (Claude Code 2.1.286)

A throwaway project whose `.claude/settings.json` registered one `SessionEnd` hook that appended its
stdin to a file, driven for real:

- `claude -p "..." --session-id <uuid>`, then `claude -p "..." --resume <uuid>` — both payloads
  carried the same `session_id` and `"reason":"other"`.
- Interactive `claude` under a pty (python `pty.fork`, workspace trust accepted once): typing `/exit`
  gave `prompt_input_exit`; `/clear` gave `clear` and then `prompt_input_exit` for the `/exit` that
  followed; `SIGTERM` and `SIGINT` to the process gave `other`.
- Ctrl+C double-press in a real terminal, then `claude --resume` of that session and exit again: both
  ends gave `prompt_input_exit` with the same `session_id` (observed by hand, same version).
- Not captured: `logout`, and `resume` as an end reason. Those rows come from Claude Code's hook
  docs, not from an observation here.

The consequence of `other` being resumable: a `-p` run or a kill is kept, so a session that never
comes back leaves a directory behind. `sweepSessions` (`068`, 24 h idle cap) reaps those, and a
claim on one ages out through `CLAIM_IDLE_CAP_MS` (15 min) as it does for a crash.

## Gotcha for anyone re-observing

A `claude` launched from inside another Claude session inherits `CLAUDE_CODE_CHILD_SESSION` and says
"Transcript saving is off"; the hooks still fire, but `--resume` of such a session has no transcript
to resume. Unset it when reproducing.
