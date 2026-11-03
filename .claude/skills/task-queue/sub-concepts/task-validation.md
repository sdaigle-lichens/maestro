# TaskCreate validation

`plugins/maestro/scripts/maestro-validate-tasks.js` is registered in `hooks.json` as a `PostToolUse`
hook with matcher `TaskCreate`. It compares the tasks the orchestrator creates against the selected
workflow's success path.

A task's step label comes from `metadata.maestro_step`, else a heuristic match of subject/description
against the workflow's node labels. Two warnings:

- **mismatch** — the resolved label is not a node in the workflow. A task that resolves to no label
  at all is silently ignored (counts toward nothing), and the synthetic `mark-task-done` step is
  accepted and skipped.
- **skipped step** — the created step is on the success path but an earlier success-path step has no
  task yet (human review being the example the source calls out).

The hook is a no-op without `maestro.json`, without a resolvable session, without a recorded active
workflow, or when the project owns its own registered copy (`projectOwnsHook`, see
`installing-maestro`'s hook-arbitration).

Both are **non-blocking**. The hook never fails a `TaskCreate` call; it annotates. Any work that
legitimately sits outside the active workflow — running a code-graph skill such as `/code-graph:scribe`, for instance —
will trip it, and that is expected rather than a bug to fix.

State lives in `<cwd>/.claude/maestro_sessions/<session_id>/tasks.json` (`064`; the flat
`maestro_session_tasks.json` before that), ephemeral and removed with that session's directory at
its own `SessionEnd`. **Per session, not per project** — two concurrent sessions keep independent
coverage; before `064` a concurrent session's coverage was read as this one's, which made one
session's `TaskCreate` suppress the other's warning. With no session id resolvable the hook validates
nothing and exits 0; it never falls back to a shared path — see `maestro-architecture`'s "Which
session am I". Writes are sequential and safe because `TaskCreate` only ever comes from the main
orchestrator session, never from parallel subagents.
