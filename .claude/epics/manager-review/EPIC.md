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
- Narrow the manager review to a direction check, from the 2026-11-05 post-mortem on code-graph
  epic haiku-subagents-with-graph (task 150). It changes the Verdicts, Rounds and "never sees the
  diff" decisions below; task 150 updates them.
- A resumed agent's handoff reads its current hand-back, not its previous run's (task 151; found in
  the post-mortem of task 150).
- The resumed-run gaps task 151 left in the handoff checks (task 153).
- The four live checks left open by this epic's reports (task 154), and the two resumed-run payload
  cases it could not run (task 155). The user chose not to isolate the portable channel rule.

Out:

- Any change to what `human_review` means: it stays human-only.
- The manager doing code review: that stays `@reviewer`'s job.

## Decisions

- **Three gates, one question each.** `manager_review`: is the ticket heading where the epic needs it?
  `@reviewer`: is the code correct and complete? `human_review`: does the owner accept it?
- **The manager manages (task 150).** It never reads code or diffs and never picks an implementation,
  including when answering a worker's questions: a non-direction question goes to the reviewer or
  the user. It gets the short review file (goal, deviations, decisions, touches, sibling impact,
  questions) and checks it against the ticket, this file's decisions and the sibling tickets. There
  is no `for @reviewer:` note; a code concern is not the manager's.
- **Direction lives in the ticket (task 150).** A ticket in line with the epic should already hint
  at the direction. When it needs more, the manager adds direction to the task file (what to aim
  for, never how), also outside a review when the epic changes. A redirect always comes with one,
  and the note to the worker repeats it (a worktree may not see the edit).
- **The check is a direction check, once (task 150).** It runs after the first implementation round
  and is normally the whole review. It does not ask for a commit or a green suite: the test and
  reviewer steps own that; only a human review (including the fallback and escalation paths, where
  the worker adds `## Verified` to the brief) keeps that rule. A loop-back from a test or reviewer
  step does not reopen it: `plan-step <label> pending` never reverts a done `manager review` after
  the target (a stop named as the target still resets). If a fix would change scope or a decision,
  the worker asks the user or the manager, and new direction goes into the ticket.
- **Verdicts:** on-track (continue the success path), redirect (only for work contradicting the
  ticket, an epic decision or a sibling ticket; never style, tests, lint, commits or correctness;
  follows the `manager requested direction change` edge to the producing agent; the redirect leaves
  `manager_review` unfinished so it re-runs), escalate (the worker runs a human review inline with
  the manager's note).
- **Fallback:** task not in an epic, or no live manager session → human review.
- **Rounds:** a re-request says round N and quotes the redirect note with how each point was
  addressed; that round checks only that the redirect was addressed, raises nothing new and should
  normally pass. After 1 redirect on the same ticket a second one escalates to the user (human
  review).
- **Approval scope:** a manager's on-track verdict continues the success path only. It is never the
  user's approval for commit, merge, push, or agent/skill/workflow changes.
- **Human review keeps `AskUserQuestion`** (it gives herdr its "input needed" state). The digest
  (~15 lines, the review file path as its FIRST line, task 143) goes in the `Approve` option's `preview`; the full
  summary is printed above the question too (herdr scrollback works while the dialog is open).
- **Review rounds are counted by `plan.loopbacks`** (task 130): `plan-step <label> pending` increments
  it, and each round gets its own file (`<task>.review.md`, `<task>.review-2.md`, ...). The
  orchestrator always records its path with `plan`, because the human-review gate hook reads it.
  `plan.loopbacks` counts every loop-back (a test loop-back too), so it numbers review files but is
  not a count of manager redirects. Task 132's redirect cap (1 since task 150) must count manager
  redirects for the ticket specifically (e.g. recorded by `review-request`), not read `plan.loopbacks`.
- **The human-review gate fails open** when a session has no plan, no active_task or bad state
  (task 130). Whether Claude Code honours a deny on `AskUserQuestion` is not covered by tests; it
  needs one live check.
- **Placement:** `manager_review` is recommended right after implementation (`default`) or after the
  test plan (`tdd`), before `@reviewer` and `human_review`.

## Merge plan

Tasks 130 to 139, 150, 151, 153 and 154 are done. Task 155 is open: it has merge order 1, base
`feat/manager-review-direction-check`, no version bump, and shares only the maestro-architecture
skill's Live check section. Tasks 150, 151, 153, 154 and 155 ship together on that branch.

Standalone task 152 shares `maestro-subagent-log.js`, the generated libs and the version file with
this branch: it starts after this epic's PR merges, then rebases and runs `pnpm refresh:runtime`.
