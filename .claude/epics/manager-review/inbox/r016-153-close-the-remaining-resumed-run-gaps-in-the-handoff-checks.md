# Report r016: 153-close-the-remaining-resumed-run-gaps-in-the-handoff-checks.md

- Task: 153-close-the-remaining-resumed-run-gaps-in-the-handoff-checks.md
- Written: 2026-11-06T15:47:56.823Z
- From session: manager-review-153

# Task 153 report

## Outcome
Both gaps closed. Plugin 0.13.22 (patch), libs rebuilt, `pnpm refresh:runtime` run by the user, parity test passes (44). Nothing committed.

## Verified
HEAD d11166dca05895ad19991d12f0b8211c4a912589 with a dirty tree (this task's uncommitted changes). Full suite green on it: `pnpm --filter maestro test` 2660 passed, 0 failed (135 files). Lint, typecheck and prettier clean; parity 44 passed.

## Findings (what the manager asked to be stated)
1. **Real transcript shape (criterion 1).** Checked against a real resumed agent's `agent-*.jsonl` (produced by resuming the finished @backend as a dummy). The resume prompt is a `type:"user"` entry, `isMeta:true`, `origin.kind:"coordinator"`, string content, with a NEW `promptId`. It is written before the SubagentStart hook attachment and before any reply of the run. Every later `tool_result` of that run carries the new `promptId`. A string `isMeta` entry (`[handback-send-enforce]`) can follow a hand-back before the real `SubagentHandback` call; task 151's boundary treated it as a new run and discarded the hand-back (that was the second Gap 1 bug, confirmed).
2. **Why the transcript alone cannot close the race (criterion 2).** The transcript is append-only, so if the new run's reply is present its prompt is too. The race is only the hook reading before the new reply exists: the transcript then holds only the earlier run, with nothing to tell its hand-back from a new one. The user was asked (task 151 chose the transcript over a SubagentStart baseline) and chose: `promptId` boundary plus the Maestro log's last `dispatch` timestamp (1 s slack, kept when unknown). A hand-back or file write older than the dispatch is ignored. No SubagentStart baseline was added. Documented limit: with no dispatch entry or no entry timestamps an unflushed resume prompt is not detected.
3. **Resumed run that skips a required payload (criterion 5).** The payload check is skipped only when the run is `resumed` (an earlier hand-back precedes the run) AND it called none of Write, Edit, MultiEdit, NotebookEdit. A resumed run that edited files and wrote no payload is still flagged, including the unflushed shape (file writes older than the dispatch do not count). Documented limit: a resumed run that changes files only through Bash is treated as re-verify-only and is not flagged; the reviewer accepted this as not a merge blocker, since the old behaviour flagged every resumed re-verify.

## Gap 2 other fix
`payloadWrittenSince` also counts the sender's `<sender>.<n>.md` files in the receiver's lane, so a resumed agent writing `test.2.md` is not warned about `test.1.md`.

## Post-mortem notes
- @backend could not read `~/.claude/projects`, so it could not check a real transcript itself; the orchestrator produced one by resuming @backend as a dummy and reading its own transcript with the Read tool. Worth giving workers a way to do this.
- The first @backend pass let an earlier run's writes count in `wroteFiles` when the resume prompt had not flushed; @test caught it and it looped back.
- `pnpm refresh:runtime` had to be run twice by the user, and @test found a prettier failure.

## Suggested ticket changes
- Reviewer warnings, not done: a small helper for the duplicated "older than dispatch less slack" check in `scanRun`, and `scanHandbacks` is now a thin wrapper over `scanRun`.
- Shared fixture timestamps moved to 2099 so they stay after a live dispatch; one test uses 2001 for the stale path.
- Untested and uncovered: a resumed run that writes only through Bash; no live end-to-end resume was produced, only fixtures modelled on real log lines.
