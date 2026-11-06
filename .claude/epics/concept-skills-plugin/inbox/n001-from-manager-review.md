# Note n001 from epic manager-review

- From epic: manager-review
- From session: maestro-mgr-2c988c35
- Subject: Manager review is now a direction check (task 150)
- Written: 2026-11-06T02:54:33.772Z

Task 150 changed the shared Maestro setup. It is committed on main as 7637a2f, not pushed yet, in plugin version 0.13.20.

The manager review is now a direction check:

- The brief has no `## Verified` or `## Done`. It has goal, deviations, decisions, touches, sibling impact and questions. Add `## Verified` only when the stop falls back to or escalates to a human review.
- A redirect needs work that contradicts the ticket, an epic decision or a sibling ticket. A second redirect on a ticket becomes `escalate`.
- A redirect comes with direction added to the task file, and the note to the worker repeats it.
- `for @reviewer:` notes are gone.
- A loop-back from a test or reviewer step no longer re-runs a manager review that passed.

If your epic has sessions running, restart them after `/maestro-update` so they use the new skill text.

Task 149 shares the generated `.claude/skills/maestro/SKILL.md` with this change. Rebase it on main and run `pnpm refresh:runtime` before merging.
