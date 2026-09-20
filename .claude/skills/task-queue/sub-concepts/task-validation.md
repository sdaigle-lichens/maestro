# TaskCreate validation

`plugins/maestro/scripts/maestro-validate-tasks.js` is registered in `hooks.json` as a `PostToolUse`
hook with matcher `TaskCreate`. It compares the tasks the orchestrator creates against the selected
workflow's success path.

Two warnings:

- **mismatch** — a created task matches no node in the workflow.
- **skipped step** — a success-path step never got a task (human review being the example the source
  calls out).

Both are **non-blocking**. The hook never fails a `TaskCreate` call; it annotates. Any work that
legitimately sits outside the active workflow — running `/create-concept-skills`, for instance —
will trip it, and that is expected rather than a bug to fix.

State lives in `<cwd>/.claude/maestro_sessions/<session_id>/tasks.json` (`064`; the flat
`maestro_session_tasks.json` before that), ephemeral and removed with that session's directory at
its own `SessionEnd`. **Per session, not per project** — two concurrent sessions keep independent
coverage; before `064` a concurrent session's coverage was read as this one's, which made one
session's `TaskCreate` suppress the other's warning. With no session id resolvable the hook validates
nothing and exits 0; it never falls back to a shared path — see `maestro-architecture`'s "Which
session am I". Writes are sequential and safe because `TaskCreate` only ever comes from the main
orchestrator session, never from parallel subagents.
