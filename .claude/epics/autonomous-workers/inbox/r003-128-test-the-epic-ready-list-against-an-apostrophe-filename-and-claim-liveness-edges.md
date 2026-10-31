# Report r003: 128-test-the-epic-ready-list-against-an-apostrophe-filename-and-claim-liveness-edges.md

- Task: 128-test-the-epic-ready-list-against-an-apostrophe-filename-and-claim-liveness-edges.md
- Written: 2026-10-24T15:33:29.860Z
- From session: autonomous-workers-128

## Outcome

Done. The work was test-only: 4 new tests in apps/maestro/test/core/epics-cli.test.ts, inside the `ready` describe block. The full maestro suite passes (2184), and lint, typecheck and prettier are clean. Nothing under plugins/ changed, so there is no version bump (0.12.8 stands). Not committed yet.

## Findings

- No bug found. Apostrophe filenames (`009-don't-panic.md`, `it's-o'clock.md`, whose worker name also has apostrophes) produce launch commands that, run through a real `sh -c` with a stub `claude`, receive exactly `-n`, `<name>`, `/maestro .claude/maestro-tasks/<file>`. This holds for both the --json output and the plain-text output.
- Claim liveness goes by the session log's mtime, not claimed_at. A 6h-old claim whose log is 14 min old stays running. A log 16 min old (the cap is 15 min) comes back as ready and the claim is reaped; touching the log afterwards does not bring the claim back. With a worker recorded, the task shows as pending under that worker and still takes a slot.
- Docs: added a coverage sentence to .claude/skills/task-queue/sub-concepts/epics.md.

## Post-mortem

None. It was a clean session.

## Suggested ticket changes

Gaps nobody covered, which could become an optional follow-up: the exact 15-minute boundary; other shell metacharacters in filenames ($, backtick, newline, spaces); non-POSIX shells (fish); a session dir that exists but has no log.jsonl; a worker recorded for a blocked task or one in another epic.
