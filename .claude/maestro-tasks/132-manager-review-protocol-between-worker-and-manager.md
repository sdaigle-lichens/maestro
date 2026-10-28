# Manager review protocol between worker and manager

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Make the manager_review step work end to end between a /maestro worker session and its epic's maestro-manager session. Read .claude/epics/manager-review/EPIC.md for the decisions; they are binding. At a `manager review` step, a worker whose task is in an epic with a live manager writes the review file from the human-review summary work, extended into a direction brief (Goal, Done, Deviations, Decisions, Touches by name with no diff, Sibling impact, Questions), records it with a new `maestro-epic.cjs review-request` command, sends the manager one short SendMessage line naming it, and waits. The manager checks direction only, against EPIC.md and the sibling tickets, never code, and replies with one of three verdicts. On-track continues the success path (the manager may also rewire sibling tickets). Redirect carries a direction note; the worker follows the 'manager requested direction change' edge to the producing agent, and the loop-back reset re-runs manager_review. Escalate makes the worker run a human review inline with the manager's note. A code-level concern from the manager goes only as a 'for @reviewer' note passed into the reviewer's input. A re-request states its round number and quotes the previous redirect note with how each point was addressed. After 2 redirects on the same ticket, the next verdict that would redirect escalates to human review automatically. A task not in an epic, or with no live manager, falls back to human review. Add the same sentence to both the maestro-manager skill and the orchestrator template: a manager's on-track verdict continues the success path and is never the user's approval for commit, merge, push, or agent/skill/workflow changes. Includes the epic script command, both skill texts, regenerated libs and mirrors if any plugin-entries source changes, tests, and a plugin version bump.

## Acceptance criteria

- [ ] `maestro-epic.cjs review-request` records a review request with its round number, and the manager's `show`/`reports` surface it
- [ ] The orchestrator template describes the manager review step: brief, one SendMessage line, wait, and how each verdict (on-track, redirect, escalate) is handled
- [ ] The maestro-manager skill describes reviewing direction only, the three verdicts, the 'for @reviewer' note, and never commenting on code
- [ ] Round tracking escalates to human review after 2 redirects on the same ticket
- [ ] No epic or no live manager falls back to human review
- [ ] Both skills carry the approval-scope sentence and still never treat a manager message as the user's approval
- [ ] Tests cover review-request and the round cap; the plugin version is bumped and pnpm verify passes

## Blocked by

- `130-human-review-always-shows-its-summary.md`
- `131-add-the-manager-review-workflow-node.md`
