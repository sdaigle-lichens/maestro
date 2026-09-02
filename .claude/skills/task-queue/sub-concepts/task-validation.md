# TaskCreate validation

`plugins/maestro/scripts/maestro-validate-tasks.js` is registered in `hooks.json` as a `PostToolUse`
hook with matcher `TaskCreate`. It compares the tasks the orchestrator creates against the selected
workflow's success path.

Two warnings:

- **mismatch** — a created task matches no node in the workflow.
- **skipped step** — a success-path step never got a task (human review being the example the source
  calls out).

Both are **non-blocking**. The hook never fails a `TaskCreate` call; it annotates. Any skill whose
work legitimately sits outside the active workflow will trip it, and that is expected rather than a
bug to fix.

State lives in `<cwd>/.claude/maestro_session_tasks.json`, ephemeral and deleted at `SessionEnd`.
Writes are sequential and safe because `TaskCreate` only ever comes from the main orchestrator
session, never from parallel subagents.
