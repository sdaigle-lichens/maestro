# Epic: manager-review

## Goal

Add a manager_review workflow step so an epic's manager can check a ticket's direction, separate from @reviewer's code review and the human-only human_review; and make human review always show its summary.

## Scope

In:

- A review file per review round and a gate hook so a human review never asks without its summary.
- A new `manager_review` node type in the workflow graph, the canvas and the validation.
- The worker ↔ manager review protocol: request, verdicts, rounds, escalation, fallback.
- Reliable herdr detection under the sandbox in maestro-update, maestro-install and maestro-manager
  (a fix found while running this epic; task 133).
- A maestro.json setting for the model epic worker sessions launch with (task 134).
- Task worktrees starting with dependencies ready (task 135; found in 133 and 134).
- One command to refresh this repo's mirrors and rendered orchestrator (task 136; the sandbox gap
  hit in 130, 131 and 132).
- A live check of the manager review step, now that this repo's workflows use it instead of human
  review (task 137).
- The add-step modal's step kinds become Agent, Skill and Review (Human by default, or Manager), in a
  wider modal (task 138).
- Worktree agents writing their channel files without a classifier denial, via a project allow rule
  (task 139; found again in 137).

Out:

- Any change to what `human_review` means: it stays human-only.
- The manager doing code review: that stays `@reviewer`'s job.

## Decisions

- **Three gates, one question each.** `manager_review`: is the ticket heading where the epic needs it?
  `@reviewer`: is the code correct and complete? `human_review`: does the owner accept it?
- **The manager never sees the diff.** It gets the review file (direction brief) and checks it
  against this file's decisions and the sibling tickets. A code-level concern it notices goes only
  as a "for @reviewer" note passed into the reviewer's input.
- **Verdicts:** on-track (continue the success path), redirect (direction note, follows the
  `manager requested direction change` edge to the producing agent; the loop-back re-runs
  `manager_review`), escalate (the worker runs a human review inline with the manager's note).
- **Fallback:** task not in an epic, or no live manager session → human review.
- **Rounds:** a re-request says round N and quotes the previous redirect note with how each point
  was addressed. After 2 redirects on the same ticket the next one escalates to human review.
- **Approval scope:** a manager's on-track verdict continues the success path only. It is never the
  user's approval for commit, merge, push, or agent/skill/workflow changes.
- **Human review keeps `AskUserQuestion`** (it gives herdr its "input needed" state). The digest
  (~15 lines, the review file path as its FIRST line, task 143) goes in the `Approve` option's `preview`; the full
  summary is printed above the question too (herdr scrollback works while the dialog is open).
- **Review rounds are counted by `plan.loopbacks`** (task 130): `plan-step <label> pending` increments
  it, and each round gets its own file (`<task>.review.md`, `<task>.review-2.md`, ...). The
  orchestrator always records its path with `plan`, because the human-review gate hook reads it.
  `plan.loopbacks` counts every loop-back (a test loop-back too), so it numbers review files but is
  not a count of manager redirects. Task 132's "2 redirects then escalate" cap must count manager
  redirects for the ticket specifically (e.g. recorded by `review-request`), not read `plan.loopbacks`.
- **The human-review gate fails open** when a session has no plan, no active_task or bad state
  (task 130). Whether Claude Code honours a deny on `AskUserQuestion` is not covered by tests; it
  needs one live check.
- **Placement:** `manager_review` is recommended right after implementation (`default`) or after the
  test plan (`tdd`), before `@reviewer` and `human_review`.
