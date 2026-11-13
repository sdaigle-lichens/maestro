# Report r004: 177-the-epic-manager-approves-containerized-workers-stops-on-the-user-s-behalf-escalating-only-what-needs-the-user.md

- Task: 177-the-epic-manager-approves-containerized-workers-stops-on-the-user-s-behalf-escalating-only-what-needs-the-user.md
- Written: 2026-11-13T01:00:28.285Z
- From session: containerized-workers-177

# Report: task 177 (manager_approval)

## Outcome
Done and committed on branch task-177. Commit verified: 5073d44 (on top of 8a8d6b7, the feature commit; 5073d44 only reformats the two new test files).

## Verification
- Full suite: `pnpm verify` run by the user on commit 5073d44, reported as passed (green). The agent's own sandbox cannot run pnpm and has python3, the claude CLI and a matching git identity missing, so its local full run was not green for those environmental reasons; the user's run is the verification of record.
- Task tests: manager-approval-177.test.ts and manager-approval-launch-177.test.ts, 71 passed.
- parity, rendered STEPS and refresh-runtime tests pass after the user ran `pnpm refresh:runtime`.

## What landed
- Opt-in `manager_approval` in maestro.json (off by default; only boolean true enables it; docker workers only, host workers keep asking the user).
- Approval records under ~/.config/maestro/approvals keyed by project, epic, task and stop; mounted read-only into worker containers; MAESTRO_APPROVALS_DIR set only when mounted.
- Epic CLI: approve, approval-escalate, approval-check. approve and approval-escalate refuse inside a container and when the setting is off; approve refuses while an escalation is pending.
- Human-review gate hook denies the worker's AskUserQuestion at a human review when manager approval is active, naming the record status. A match needs the exact task, stop and commit.
- Escalated stops: the user's answer is recorded as source:user by a PostToolUse(AskUserQuestion) hook, only in the epic manager's own session, for a marked escalation question. A manager approve or escalate cannot overwrite a user record for the same commit (found by the test step, fixed, covered by tests).
- Escalation classifier: red or partial suite, scope change or decision conflict, outward-facing or destructive git operation, change to agents/skills/workflows/rules/settings, security finding, second redirect.
- Worker template and maestro-manager skill state plainly when manager approval is allowed and what always escalates. plugin.json 0.15.9 -> 0.15.10 (patch).

## Findings / warnings (non-blocking, from the reviewer)
- Escalation facts (--suite, --paths, --op, --escalation) come from the manager's own CLI call; an unset --suite fails safe by escalating.
- Only the human-review stop has a hard hook gate. Commit and merge stops are enforced by `approval-check` in the template.
- `approval-check --commit <sha>` lets the worker name a commit other than HEAD; the hook gate uses HEAD.

## Not verified: the container run
The manager direction asks this report to state the docker run's results. This session did not run in a freshly built container, so none of these are verified here: no prompts up to the first human review; every host-enabled plugin's agents and skills loaded; no worktree trust prompt; whether the CLI's inbox write prompted; the manager's [manager message] pane replies arriving; the test agent writing its channel payload with no missing_payload. Observed in passing: the manager's m003 on-track verdict did arrive as a [manager message] line, the review-request needed no SendMessage, and the first test agent's FAIL payload was written (unstamped, so handoff-issues flagged it once).

## Post-mortem notes
- The first test run found one real defect (manager approve could overwrite a user record); looped back to backend and fixed.
- The new test files were committed unformatted and failed `pnpm verify`'s prettier check; fixed in 5073d44. Backend and test agents should run prettier on new files.
- Environment: SessionEnd shell scripts depend on python3 (36 failures where it is absent).

## Suggested ticket changes
None.
