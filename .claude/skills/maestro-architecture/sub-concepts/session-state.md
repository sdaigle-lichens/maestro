# Config and session state on disk

`maestro.json` is one file per project. **Everything ephemeral is one directory per Claude Code
session**, since `064`:

```
<project>/.claude/maestro_sessions/
  .gitignore              <- contains "*", written by ensureSessionsRoot() on first create
  <session_id>/
    log.jsonl             <- was maestro_session.log.jsonl
    session.json          <- was maestro_session.json  { workflow, generated_instances, run_id }
    tasks.json            <- was maestro_session_tasks.json
```

Before this, all three were one fixed file per project, and two sessions against the same project
corrupted each other **silently**: interleaved logs with either `SessionEnd` deleting the other's,
an active workflow overwritten so the next `SubagentStart` injected the *wrong* workflow's skills,
one `run_id` shared by two runs, and `resumeTarget` able to resume a foreign session's `agent_id`.
A directory rather than `<session_id>.jsonl` because all three files move together — splitting the
log alone would have left the other two defects standing.

The three flat names survive in code **only** as `LEGACY_SESSION_FILES`, deleted by `SessionEnd`
and by uninstall so a project that ran a pre-`064` runtime doesn't keep them forever.

The `.gitignore` containing `*` **is the mechanism, not belt-and-braces** — see
`installing-maestro`'s manifest sub-concept for why the `GITIGNORE_ENTRIES` manifest entry alone
would not have covered a single pre-`064` project.

## Which session am I

`apps/maestro/src/core/session-paths.ts` owns the whole question — resolution, validation, directory
creation and every path shape — which is why the five log writers gained per-session routing with
**no diff at any call site**: `appendSessionLog(claudeDir, entry, payload?)` keeps its exact 3-arg
signature, because the payload it already took for `ctx_pct` also carries the `session_id`. Do not
"simplify" that payload away.

| Source | When |
| --- | --- |
| `payload.session_id` | the caller is a hook with a stdin payload |
| `CLAUDE_CODE_SESSION_ID` | the caller has no stdin at all — the two `!`-injected gate scripts, and the CLIs the orchestrator invokes by path |
| `null` | neither; every caller degrades on its own tabulated terms and still exits 0 |

An id that fails validation from **either** source is `null` rather than falling through to the
other — a caller handed a malformed payload id must not silently write wherever the environment
happens to point.

**A subagent's hook payload carries the MAIN session's `session_id`.** Verified empirically, not
assumed: `PreToolUse` (main), `SubagentStart`, the subagent's own `PreToolUse` and `SubagentStop`
all reported the same id. So **one workflow run is one directory**, and a subagent's own tool calls
land in the orchestrating session's log — which is what `/session-log` already assumes.
`CLAUDE_CODE_SESSION_ID` was set at all four of those probe points and equal to the payload's id
every time, so the fallback agrees with the authoritative source rather than merely existing.

**Do not key anything on `CLAUDE_CODE_CHILD_SESSION`.** It is set in the main session too, so it
separates nothing.

**An id is VALIDATED, never sanitised:** `^[A-Za-z0-9_-]{1,128}$`, and anything else is "no
session". Sanitising a bad id into a legal one could collide with a *real* session's directory,
which is worse than not writing — and the pattern excludes `.`, `/` and `\`, so `..`, a path
separator, an absolute path and the empty string are all rejected before any path is built. Nothing
is created on disk for a rejected id, which is what makes rejecting cost nothing.

## The files

| File | Path | Role | Written by | Lifecycle |
| --- | --- | --- | --- | --- |
| `maestro.json` | `<project>/.claude/maestro.json` | **Source of truth** (`version: 3`). Every hook + the renderer read this. `success_path` is **not** stored here. | App + skill (byte-identical) | Committed; edited via canvas or by hand (+ `/maestro-update`) |
| `session.json` | `<project>/.claude/maestro_sessions/<id>/session.json` | Ephemeral session state: `{ workflow, generated_instances, run_id }` — `run_id` is per **session** since `064`, not per project. Tells `maestro-inject-agent-context.js` which workflow is active. | `maestro-set-session-workflow.cjs`, `maestro-inject-agent-context.js` | Ephemeral; **gitignored**; this session's directory deleted at its own `SessionEnd` |
| `log.jsonl` | `<project>/.claude/maestro_sessions/<id>/log.jsonl` | Ephemeral **append-only** log — see entry kinds below. | `maestro-session-log.js` (PreToolUse) + `maestro-subagent-log.js` (SubagentStart/Stop) + `maestro-inject-agent-context.js` (SubagentStart) | Ephemeral; **gitignored**; this session's directory deleted at its own `SessionEnd` |
| `tasks.json` | `<project>/.claude/maestro_sessions/<id>/tasks.json` | Ephemeral task-coverage tracker: `{ steps: ["@backend", "human review", ...] }`. Records which success-path steps already have a `TaskCreate` in this session. Read-modify-write is safe (only the main orchestrator calls `TaskCreate`, no parallel race). | `maestro-validate-tasks.js` (PostToolUse) | Ephemeral; **gitignored**; this session's directory deleted at its own `SessionEnd` |

`success_path` is derived by `successPathSteps` in `lib/maestro-session.cjs` — never persisted in
`maestro.json`, only rendered into the orchestrator's `Maestro:HANDOFFS` table (`→` separator,
`human review` label).

### `log.jsonl` entry kinds

| Kind | Shape | Written at |
| --- | --- | --- |
| plain tool call | `{ts, origin, log}` | PreToolUse |
| `kind:"dispatch"` | `{ts, origin:"main_session", agent, agent_id, input, offered_skills?, log}` | SubagentStart |
| `kind:"handoff"` | `{ts, origin, agent_id, status, label, output, log}` | SubagentStop **with** an `agent_type` |
| `kind:"transition"` | `{ts, origin:"transition", output, log}` | SubagentStop with **no** `agent_type` — a boundary that isn't a workflow handoff at all, kept neutral instead of masquerading as an `unknown` handoff |
| `kind:"channel_delivery"` (`036`) | `{ts, origin:"main_session", agent_id, sender, receiver, content, log}` | SubagentStart, by `maestro-inject-agent-context.js` itself the same moment it inlines a channel payload, so the log has a durable record of the delivery |
| `kind:"phase"` (`064`) | phase marker from the two `!`-injected gate scripts | Step 1 / Step 4 gate resolution |

On a `channel_delivery`, `origin` is `"main_session"` too, not the receiver — the desktop app's
`/session-log` (`037`) correlates it back to the receiving instance by `agent_id`, the same key a
`dispatch` entry's `input` uses.

The desktop app **live-tails** `log.jsonl` from its main process and pushes lines to the renderer
over `window.maestro.log` — the hooks stay append-only and network-free, and the tail is read-only
and entirely separate from the write path.

A fifth piece of session state since `036` is `.claude/channels/` — see `channels.md`.

## Things that bite

- **Session logs are append-only by design.** Don't switch a session's `log.jsonl` back to a
  read-modify-write JSON array — parallel subagents would lose entries.
- **"No session id resolves" is silent everywhere, by design (`064`).** A hook that cannot say which
  session it is writes nothing and exits 0 rather than falling back to a shared path — so a missing
  `session_id` in a payload, or a script run outside a Claude Code session with no
  `CLAUDE_CODE_SESSION_ID`, looks exactly like "Maestro isn't installed": an empty log, no task
  validation, no phase marker. Check `ls .claude/maestro_sessions/` before assuming a hook is
  unregistered.
- **Deleting `maestro-session-cleanup` deletes nothing loudly.** It is the only thing that removes a
  session's directory, and nothing in it is load-bearing for the _next_ session — which now gets its
  own directory anyway, so the leak is unbounded accumulation rather than wrong state. Nothing
  errors. If session state starts looking impossibly old, check that this hook is registered and
  that its `cwd` is arriving.
