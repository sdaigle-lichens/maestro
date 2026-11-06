# Report r020: 155-live-check-the-two-resumed-run-payload-warnings-left-unrun-by-task-154.md

- Task: 155-live-check-the-two-resumed-run-payload-warnings-left-unrun-by-task-154.md
- Written: 2026-11-06T16:55:51.720Z
- From session: manager-review-155

## Outcome

Task 155 ran both resumed-run payload checks for real (Tests workflow: one @test agent dispatched once and resumed twice by agent_id). Docs only: the Live check section of `.claude/skills/maestro-architecture/SKILL.md` now has a "Task 155 run" subsection. No plugin, lib or version change; the throwaway `probe-155.txt` was deleted and never committed.

- **Case 1 (resumed agent writes next-numbered `test.2.md`): observed, no warning.** Log: dispatch 16:50:17.978Z, `Write(.../channels/task-155/reviewer/test.2.md)` 16:50:23, handoff success 16:50:26; `handoff-issues` printed "no problems recorded".
- **Case 2 (resumed agent edits a file and skips its payload is still warned): FAILED live. No warning fired.** Log: dispatch 16:51:07.632Z, `Edit(.../probe-155.txt)` 16:51:09, no Write under `.claude/channels/`, handoff success 16:51:11 ("Deliberately wrote no channel payload"); `handoff-issues` at 16:51:35 still printed "no problems recorded".

## Verification state

No commit was made and the full test suite was NOT run: this is a verification-plus-docs task, nothing was committed, and a green suite on a commit cannot be claimed. The reviewer confirmed the evidence from the log and `git status` (no plugin/lib/version change, no probe file).

## Findings (none fixed)

1. Case 2 is a silent miss. Cause unproven; ranked hypotheses: (a) `handoffIssuesCommand` / `dropResolvedMissingPayloads` drops the recorded `missing_payload` because `pendingResumeDeliveries` matches on the session `run_id`, so run 1's `test.1.md` makes the missing file look present (and dropping deletes `handoff_issues`, erasing the trace); (b) `scanRun`/`startsRun` in `handoff-label.ts` resets `wroteFiles` on a run-boundary misdetection, so the stop hook skips the check as "re-verify only"; (c) unlikely: `payloadWrittenSince` counted an earlier file.
2. Decisive probe to separate them: rerun case 2 with a debug line recording `reverifyOnly` and `checkPayload`'s result, or check whether session.json `handoff_issues` is populated before `handoff-issues` runs.
3. The `maestro-architecture` skill stamp was not run (3 changed files since stamp `beb395d4`); needs a reviewed `skills stamp`.
4. `scribe-output/maestro-architecture.ast.json` was modified and `scribe-output/.refresh-skills.lock` created by the scribe's extract/apply; incidental.

## Suggested ticket changes

Open a fix ticket for case 2 (start with the probe in finding 2, then fix; add a regression test for a resumed run that edits files and skips its payload with an earlier-numbered payload from the same session already in the lane).
