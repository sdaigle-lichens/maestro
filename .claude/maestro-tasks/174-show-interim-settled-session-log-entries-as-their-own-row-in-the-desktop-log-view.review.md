# Task 174 — review round 1 (manager review run as human review: task has no epic)

## Goal
Give `interim_settled` session-log entries a dedicated row in the desktop log view, styled like the
hand-off rows, every value read from the entry itself.

## Changed
- added `apps/maestro/src/renderer/src/components/interim-settled-row.tsx` (the row)
- `apps/maestro/src/renderer/src/utils/session-log.ts`: `interimSettledRow`, `logRows`, a `humanizeLog` text line for the kind
- `session-log-view.tsx` (center pane) and `session-log-detail.tsx` (detail Process section) render through `logRows`
- `apps/maestro/src/core/contracts.ts`: types the kind and its fields (`stop_ts`, `settled_as`, `handoff_issue`) + new `SessionLogHandoffIssue` (type-only; no plugin lib rebuild needed)
- `shared/ipc.ts`, `renderer/src/utils/maestro-session-log.ts`: re-export that type

## Did
- @frontend: the row: `@agent`, `run <agent_id>`, "stopped" `stop_ts` / "settled" `ts` (local clock time, ISO in `dateTime`/`title`), `missing` → red "missing hand-off", `late_handback` → green "late hand-back · HANDOFF: <label>" ("none" if null); `handoff_issue` (kind, verdict, label, message, files) in red and turns the row red. Unknown `settled_as` falls back to a plain line from `log`.

## Deviations from the ticket
- No tests yet: @frontend's boundary forbids writing tests; @test (next step) writes them (both shapes, with/without issue, unchanged-log case).
- The settle entry renders in the Main Session section, not attached to that agent's own card (out of the ticket's scope, which forbids computing from other entries).

## Decisions
- Shared `logRows` used by both the center pane and the detail panel, so both show the same row.

## Sibling impact
- Other entry kinds still go through the same `humanizeLog` line and markup.

## Questions
- none

## Verified
- Working tree on HEAD `0a01dc1` (uncommitted): `vitest run --project unit` (the app's `test` script) is green, 170 files / 3282 tests passed. Lint and typecheck green per @frontend. The Storybook browser project can't launch here (Playwright browser not installed); that's an environment problem, not caused by this change.
