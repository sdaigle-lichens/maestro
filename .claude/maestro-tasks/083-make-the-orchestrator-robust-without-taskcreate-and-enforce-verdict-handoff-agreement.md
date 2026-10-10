# Make the orchestrator robust without TaskCreate and enforce verdict/HANDOFF agreement

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Five problems in the orchestrator and subagent contract came up in recent runs.

1. No task graph. TaskCreate has repeatedly been unavailable in orchestrator sessions. The orchestrator's Step 3 and the mark-task-done node both assume it, so the orchestrator ended up tracking the success path from memory. Give the orchestrator template a defined fallback when TaskCreate isn't available. For example, keep the planned success path, the human-review stops, loop-backs and the mark-task-done step in the session's state, through a small runtime command the orchestrator updates as it goes. Then Step 4's done marking still runs only after every prior step, including human review.

2. Verdict and HANDOFF disagreement. Subagents have ended with a FAIL verdict in their report but 'HANDOFF: success' on the last line, or with no HANDOFF line at all (for example 'scribe done'). The orchestrator then had to guess. Make the contract explicit:
- a real defect must end with the matching condition-edge label when the workflow has one;
- a verdict of FAIL with HANDOFF: success is invalid.
Have the stop hook detect a missing HANDOFF line, or a report verdict that contradicts it, log it, and surface it to the orchestrator, so the orchestrator routes deliberately instead of defaulting to success.

3. Worktree tasks always end uncommitted. When a task runs in its own worktree (for example task 080, branch task-080), no step owns committing: the default workflow ends at @scribe, the orchestrator template forbids merging unasked, and commits only happen when asked. So `maestro-task-status.cjs merge` always refuses the first time with "worktree has uncommitted changes". Fix it in two parts:
- When the task ran in a worktree, Step 4's done step offers to commit there. It suggests a commit message, the user approves or edits it, and only then does it mention merge. Never commit without that approval, and never merge unasked.
- As a fallback, `merge` on a dirty worktree prints the exact commit suggestion (the worktree path and a suggested message) along with its refusal.

4. Commands handed to the user during a worktree run. Once a worktree is active, the orchestrator session's working directory is the worktree. In task 080 the orchestrator gave the user a `!` command with relative paths (rm apps/maestro/...), which ran in the worktree and deleted the committed copies there. The orchestrator template must say that any command handed to the user while a worktree is active uses absolute paths or an explicit cd, and names which checkout it targets.

5. Sandbox-blocked merge. The sandbox denies writes under .claude/skills in the main checkout, so the orchestrator's own `merge` failed with "unable to unlink ... Operation not permitted" and the user had to run it. When a merge touches sandbox-protected paths, or fails that way, the orchestrator should hand the user the exact merge command (absolute paths, `!` prefix) instead of retrying.

## Acceptance criteria

- [ ] With TaskCreate unavailable, the orchestrator follows a documented fallback that records the planned path and its progress in session state, and mark-task-done still only runs after every prior step, including human review.
- [ ] The subagent contract (injected handoff instructions and report formats) says that a FAIL verdict must use the matching condition-edge label, and that HANDOFF: success with a FAIL verdict is invalid.
- [ ] The stop hook detects a missing HANDOFF line, or a verdict that contradicts it, logs it, and the orchestrator sees it. Tests spawn the real hooks to cover both cases.
- [ ] For a task run in a worktree, Step 4's done step offers a commit in that worktree with a suggested message and commits only after the user approves. Merge is mentioned only after that, and never run unasked.
- [ ] `merge` on a dirty worktree still refuses, and also prints the worktree path and a suggested commit command. A test spawns the real CLI against a temp worktree to cover it.
- [ ] The orchestrator template requires absolute paths (or an explicit cd) in every command handed to the user while a worktree is active.
- [ ] When the orchestrator's merge fails on a sandbox write denial, it hands the user the exact merge command instead of retrying. `merge` reports that failure in a recognisable way.
- [ ] Generated plugin libs are rebuilt and the .claude/scripts mirrors refreshed, parity passes, the plugin version is bumped, and the maestro-architecture docs are updated.

## Blocked by

None — can start immediately
