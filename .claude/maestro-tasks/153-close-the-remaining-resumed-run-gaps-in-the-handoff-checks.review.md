# Task 153 direction brief

## Goal
Make the SubagentStop hook, on a resumed run, record only that run's own hand-back (or none), and warn about a missing payload only when one is really missing. First-run behaviour unchanged.

## Deviations
- **Transcript-shape check done by the orchestrator, not @backend.** @backend could not read `~/.claude/projects`. The orchestrator resumed @backend as a dummy, read its real `agent-*.jsonl` and confirmed: the resume prompt is a string-content `isMeta` user entry with `origin.kind:"coordinator"` and a new `promptId`, written before the SubagentStart hook and any reply of the run; a string `isMeta` entry (`[handback-send-enforce]`) can follow a hand-back.
- **The race is not closable from the transcript alone.** Task 151 chose the transcript boundary over a SubagentStart baseline, so the user was asked. The user chose: transcript `promptId` boundary plus the log's last `dispatch` timestamp (no SubagentStart baseline).
- Shared test fixture timestamps in `runtime-version-and-payload.test.ts` moved from 2026 to 2099 so the live dispatch time does not make first-run fixtures look stale.

## Decisions
- Run boundary is a change of `promptId` (an `isMeta`-only entry never opens a run); entries without `promptId` keep the old rule.
- A hand-back older than this run's last dispatch (1 s slack) is ignored; with no known start or no timestamp it is kept.
- Gap 2: `payloadWrittenSince` also counts the sender's `<sender>.<n>.md` files; new `runProfile` (`resumed`, `wroteFiles`) lets the hook skip the payload check for a resumed run that wrote no file.
- Plugin patch bump to 0.13.22; libs rebuilt; no further bump.

## Touches
`apps/maestro/src/core/handoff-label.ts`, `handoff-payload.ts`, `plugin-entries/maestro-session.ts`, `plugins/maestro/scripts/maestro-subagent-log.js`, generated `scripts/lib/*.cjs`, `plugin.json`, tests `handoff-run-boundary-151.test.ts` and `runtime-version-and-payload.test.ts`, `handoff-contract.md`.

## Sibling impact
Task 152 touches the same script, libs and version file; it runs one at a time and whichever merges second rebases and runs the refresh. `.claude/scripts` mirrors are stale until the user runs `! pnpm refresh:runtime`.

## Questions
None open.
