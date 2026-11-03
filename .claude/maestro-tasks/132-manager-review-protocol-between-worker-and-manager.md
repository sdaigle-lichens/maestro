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
- [ ] The human-review gate hook from task 130 also gates a `manager review` stop: the worker cannot send the review request (or ask the user on escalation/fallback) before that round's review file exists
- [ ] The orchestrator no longer treats `manager review` as a human review (task 131's interim behaviour) except on escalation or fallback
- [ ] The repo's own `maestro-architecture` developer skill describes the manager review step alongside human review
- [ ] Tests cover review-request and the round cap; the plugin version is bumped and pnpm verify passes

## Blocked by

- `130-human-review-always-shows-its-summary.md`
- `131-add-the-manager-review-workflow-node.md`

## Post-Mortem

- **Problem:** Agents could not refresh the tracked mirrors (`.claude/scripts/`), re-render the orchestrator (`.claude/skills/maestro/SKILL.md`) or update the `.claude/settings.json` matcher from the sandbox, so `pnpm verify` stayed red through @test and @reviewer, and the user had to run the steps by hand.
  **Fix:** none
- **Problem:** @backend handed the user `maestro-render-orchestrator.cjs` as the re-render step. It only rewrites the HANDOFFS table, not the STEPS region, so the template's changed text never reached the rendered orchestrator. It took a second user round-trip (`maestro-install.js .`) to fix.
  **Fix:** none
- **Problem:** @reviewer failed round 1 on a missing space in the `ack` refusal hint. @backend's first assertion on that text would not have caught the bug; @test tightened it in round 2.
  **Fix:** none
