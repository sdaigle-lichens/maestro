# Direction brief: task 160

## Goal
Stop the SubagentStop hand-off check from flagging an agent's interim stops, and measure the payload check across the whole agent run, not the latest resume.

## Deviations
- The signal for "interim" was not probed on a live Claude Code run. The SubagentStop input has no interim field (from the repo's documented input shape), so the signal is derived: the current run made no `SubagentHandback`/`SendMessage` call after the existing 3 s transcript wait.
- Consequence (accepted, fails toward no flag): a run that ends in plain text with no hand-back call, or a flush slower than 3 s, reads as interim and is not flagged. An interim stop is not remembered, so an agent stopped once and never resumed is never flagged.
- Interim stops also skip channel stamping, so a stale file's mtime is not refreshed before the final stop.
- Three existing tests that pinned "missing when the hand-back never lands" (124, 151, 153) now expect an interim stop.

## Decisions
- `isInterimStop` in `handoff-label.ts`, using the 151/153 run-boundary rules.
- New `agentRunStartedAt` (first dispatch of the agent id) feeds `payloadWrittenSince`; the transcript boundary still uses the last dispatch. A file older than the first dispatch still does not count.
- Log entry for an interim stop gets `interim: true`, no `handoff_issue`, no `session.json` entry, no `systemMessage`.
- Plugin version 0.13.32 → 0.13.33 (patch).

## Touches
`handoff-label.ts`, `handoff-payload.ts`, `plugin-entries/maestro-session.ts`, `maestro-subagent-log.js`, generated `lib/maestro-session.cjs`, `.claude/scripts` mirrors, `plugin.json`, `handoff-contract.md`, new `interim-stop-160.test.ts`, `runtime-version-and-payload.test.ts`.

## Sibling impact
Task 165 (post-mortem digest) must respect `interim: true` log entries. Tasks 163, 164, 166 touch other surfaces; whichever lands later rebases and rebuilds the generated files.

## Questions
- Is a signal that fails toward "no flag" (no live probe, no background-task detection) acceptable for this ticket, or should a live probe be a follow-up?
