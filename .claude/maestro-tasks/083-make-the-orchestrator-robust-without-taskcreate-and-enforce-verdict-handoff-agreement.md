# Make the orchestrator robust without TaskCreate and enforce verdict/HANDOFF agreement

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Two problems in the orchestrator and subagent contract came up in every recent run.

1. No task graph. TaskCreate has repeatedly been unavailable in orchestrator sessions. The orchestrator's Step 3 and the mark-task-done node both assume it, so the orchestrator ended up tracking the success path from memory. Give the orchestrator template a defined fallback when TaskCreate isn't available. For example, keep the planned success path, the human-review stops, loop-backs and the mark-task-done step in the session's state, through a small runtime command the orchestrator updates as it goes. Then Step 4's done marking still runs only after every prior step, including human review.

2. Verdict and HANDOFF disagreement. Subagents have ended with a FAIL verdict in their report but 'HANDOFF: success' on the last line, or with no HANDOFF line at all (for example 'scribe done'). The orchestrator then had to guess. Make the contract explicit:
- a real defect must end with the matching condition-edge label when the workflow has one;
- a verdict of FAIL with HANDOFF: success is invalid.
Have the stop hook detect a missing HANDOFF line, or a report verdict that contradicts it, log it, and surface it to the orchestrator, so the orchestrator routes deliberately instead of defaulting to success.

## Acceptance criteria

- [ ] With TaskCreate unavailable, the orchestrator follows a documented fallback that records the planned path and its progress in session state, and mark-task-done still only runs after every prior step, including human review.
- [ ] The subagent contract (injected handoff instructions and report formats) says that a FAIL verdict must use the matching condition-edge label, and that HANDOFF: success with a FAIL verdict is invalid.
- [ ] The stop hook detects a missing HANDOFF line, or a verdict that contradicts it, logs it, and the orchestrator sees it. Tests spawn the real hooks to cover both cases.
- [ ] Generated plugin libs are rebuilt and the .claude/scripts mirrors refreshed, parity passes, the plugin version is bumped, and the maestro-architecture docs are updated.

## Blocked by

None — can start immediately
