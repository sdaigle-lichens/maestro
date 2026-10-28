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
  (~15 lines, ending with the review file path) goes in the `Approve` option's `preview`; the full
  summary is printed above the question too (herdr scrollback works while the dialog is open).
- **Placement:** `manager_review` is recommended right after implementation (`default`) or after the
  test plan (`tdd`), before `@reviewer` and `human_review`.
