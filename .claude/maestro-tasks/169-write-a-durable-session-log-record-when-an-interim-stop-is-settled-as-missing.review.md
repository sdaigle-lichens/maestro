# Review — task 169 (manager review fallback: no epic → human review)

## Goal
Write a durable session-log record when `handoff-issues` settles an interim stop, and have the post-mortem digest trust that record over the old "interim with no later final stop ⇒ missing" inference (kept for pre-169 logs).

## Changed
- `apps/maestro/src/core/interim-stop.ts` — `settleInterimStops` also returns a `settled` list; new `interimSettleEntry` builds the log line
- `apps/maestro/src/core/plugin-entries/maestro-session.ts` + generated `plugins/maestro/scripts/lib/maestro-session.cjs` — export it
- `plugins/maestro/scripts/maestro-task-status.cjs` — `handoffIssuesCommand` appends one `interim_settled` line per settled marker (existing `appendSessionLog`, after the session.json write)
- `plugins/maestro/scripts/maestro-subagent-log.js` — SubagentStop stamps interim handoff entries `settles_in_log: true`
- `plugins/maestro/scripts/maestro-post-mortem.js` — record → outcome; unsettled stamped stop → "interim stop, not settled yet" (Pending section); legacy log → old inference
- `plugins/maestro/.claude-plugin/plugin.json` 0.15.4 → 0.15.5
- Tests: `post-mortem-dedupe-165.test.ts` updated, `interim-settle-record-169.test.ts` new
- `.claude/scripts` mirrors refreshed by the user's `pnpm refresh:runtime`

## Did
- @backend: implemented all of the above, rebuilt libs.

## Decisions
- Record shape: `{ts, origin:"main_session", kind:"interim_settled", agent, agent_id, stop_ts, settled_as:"missing"|"late_handback", label, handoff_issue?, log}`.
- Late hand-backs (valid or invalid) are recorded too (`settled_as:"late_handback"`), otherwise the digest would show them as unsettled forever.
- A record logged before a later stop of the same agent run is ignored.

## Deviations from the ticket
- Added a per-stop stamp `settles_in_log: true` on interim handoff entries (SubagentStop hook). Without it a mid-session digest taken before *any* settle still couldn't tell a new log from a legacy one and would mis-infer missing. The ticket named only handoff-issues + post-mortem; this touches `maestro-subagent-log.js` too.
- The 165 combined real-hook test now expects m1 as pending rather than missing (the intended behaviour change).

## Touches / Sibling impact
- Desktop log view renders `interim_settled` as a generic entry (unknown kind) — not addressed; @scribe to note it in the log-view hook-writers doc. Possible follow-up task.
- Parallel epic (166/167) shares plugin.json version and generated libs: whichever merges later rebases and rebuilds.

## Questions
- OK with the extra `settles_in_log` stamp in the SubagentStop hook?

## Verified
- Working tree on top of commit `74c944f` (uncommitted changes), after `pnpm refresh:runtime`: `pnpm --filter maestro test` → 169 files / 3266 tests passed, 0 failed (incl. parity). Backend reported `check`, `typecheck`, `lint` passing. Acceptance tests for the three cases are still to be written by @test.
