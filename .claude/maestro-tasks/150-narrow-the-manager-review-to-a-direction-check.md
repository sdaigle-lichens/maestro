# Narrow the manager review to a direction check

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A post-mortem run by the user on code-graph epic haiku-subagents-with-graph (tickets 066, 067, 068, 070, on 2026-11-05) found the manager review has taken on the reviewer's role: 12 rounds on 4 tickets, 3 of 4 redirects citing a missing commit or green suite, 4 rounds that were re-requests with no direction change, and only 2 redirect points clearly about direction. Rounds 4 and 5 of ticket 070 came from the manager's own `for @reviewer:` note. Tasks took longer and cost more than with the human review. No per-round cost figures exist.

Target design, approved by the user: the manager manages. It does not read the code or decide the implementation. Direction lives in the ticket: a ticket written in line with the epic should already hint at the right direction, and when it needs more, the manager augments the ticket with that direction (what to aim for, never how to implement it). The manager then does a small check after the first implementation round, comparing the brief with the ticket and the epic, and that is normally the whole review. The round loop stays: after a redirect the worker fixes the work and asks again. That round checks only that the redirect was addressed, raises nothing new, and should normally pass. If the manager is tempted to redirect a second time, it escalates to the user.

This is a code change as well as a skill text change. It covers: the plan-step reset behaviour in the task status script; the redirect cap in the epic core (TypeScript source, then the rebuilt plugin libs); the review-file gate's brief section text; the orchestrator template and the maestro-manager skill; the tests that pin the cap and the protocol; the manager-review EPIC.md decisions; the maestro-architecture and task-queue concept docs that describe the old protocol; a plugin version bump (patch); and the repo's runtime refresh.

Changes:
- Remove commit and green-suite from the manager review: drop `## Verified` from the brief, take manager rounds out of 'Never approve a red suite', and drop the matching sentence in maestro-manager's review section. The test and reviewer steps own that gate. Keep the rule for the human review, the reviewer step, and the worker's final report in the manager's loop.
- Shorten the brief to goal, deviations, decisions, touches, sibling impact and questions, and update the section list the gate's denial message prints (it also lists `## Done`).
- Lower the redirect cap from 2 to 1, in the epic core, the orchestrator's round cap text and maestro-manager.
- Limit a redirect to work that contradicts the ticket, an epic decision or a sibling ticket. State that style, tests, lint, commits and code correctness are never grounds for one.
- The manager never reads code or diffs and never picks an implementation, including when answering a worker's questions: anything that is not a direction question goes to the reviewer or the user.
- Remove `for @reviewer:` notes entirely.
- Direction goes into the ticket: a redirect always comes with a direction added to the task file, and the manager can add one outside a review, for example when the epic changes. The note to the worker repeats the direction, because a worker in a worktree may not see the manager's edit to the task file.
- A loop-back from a test or reviewer step does not reset the manager check. If a fix would change scope or a decision, the worker asks the user or the manager, and any new direction goes into the ticket.

Loop-back design, decided: `plan-step <label> pending` keeps its interface, but its reset never reverts a `manager review` step that is already done and comes after the target step. A step named directly as the target still resets. A redirect leaves the stop unfinished, so it re-runs by itself; on-track marks it done, so later loop-backs skip it. Rejected: instruction text only (plan state and gate still see it as pending), moving the stop after the reviewer (contradicts a check after the first implementation round), and a keep flag on plan-step (every caller must classify the loop-back). If the orchestrator's TaskCreate list is reset by hand on a loop-back, its text must keep the passed manager review completed too.

Fallback and escalation, decided: a human review run at the manager stop still follows the human review's rule, so in those cases only the worker adds `## Verified` (commit and green full suite) to the brief. This keeps today's cost for those paths.

## Acceptance criteria

- [ ] The manager check runs after the first implementation round; only a manager redirect triggers another round, and a loop-back from a test or reviewer step does not
- [ ] A test proves both paths through plan-step: after a redirect the manager review runs again; after on-track and a later loop-back it stays done, and review-file rounds do not collide
- [ ] The manager check can pass on a brief with no commit and no suite result
- [ ] A round after a redirect checks only that the redirect was addressed, and the manager skill says it should normally pass
- [ ] A second redirect on a ticket prints `escalate` and runs a human review
- [ ] A direction change is recorded in the task file, the manager can add one outside a review, and the note to the worker repeats it
- [ ] maestro-manager says the manager never reads code or decides the implementation, and lists direction as the only grounds for a redirect
- [ ] No `for @reviewer:` note remains in the orchestrator template, maestro-manager or the concept docs
- [ ] The rendered orchestrator skill, maestro-manager and the workflow config agree, and the fallback to a human review still works, with `## Verified` added to the brief on the fallback and escalation paths
- [ ] The manager-review EPIC.md decisions match the new cap, the removed reviewer note and the loop-back rule
- [ ] The plugin version is bumped and the parity test passes after the runtime refresh

## Touched surfaces

- plugins/maestro/scripts/maestro-task-status.cjs (planStepCommand) and its .claude/scripts mirror
- apps/maestro/src/core/epics.ts (MANAGER_REDIRECT_CAP)
- apps/maestro/src/core/human-review-gate.ts (BRIEF_SECTIONS)
- plugins/maestro/scripts/lib/*.cjs (generated: rebuild, never hand-edit) and .claude/scripts/lib mirrors
- plugins/maestro/templates/maestro/SKILL.md and the rendered .claude/skills/maestro/SKILL.md
- plugins/maestro/skills/maestro-manager/SKILL.md
- plugins/maestro/.claude-plugin/plugin.json (version)
- apps/maestro/test/core/ manager-review, orchestrator and human-review-gate tests
- .claude/epics/manager-review/EPIC.md
- .claude/skills/maestro-architecture and .claude/skills/task-queue concept docs

## Blocked by

None — can start immediately
