# Mark collapsed plugin groups that hide a dangling skill reference

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 091 added dangling skill reference marks in the Maestro app: each unavailable skill shows a mark with its reason where it is edited, a notice lists the project-level suggestions, and a "Recheck skills" control refreshes the report on demand. Two gaps were left. First, skills are grouped by plugin, and when a plugin group is collapsed a dangling skill inside it has no indicator on the group header, so the problem is invisible until the user expands the right group. Second, the checking state and the click handler behind the recheck action are duplicated between the always-visible recheck control and the notice, so the two can drift (one shows checking while the other doesn't).

Show an indicator on a collapsed group's header whenever any skill inside it is dangling — the count, and the reason when they share one — that disappears once the group's references resolve or the group is expanded to show the per-skill marks. Make the recheck control and the notice share a single source for the checking state and the recheck action, so triggering it from either place is reflected in both.

## Acceptance criteria

- [ ] A collapsed plugin group containing a dangling skill reference shows an indicator on its header with the count (and the reason when all share one)
- [ ] The indicator clears after a recheck once the references resolve, and expanded groups keep showing the per-skill marks
- [ ] The recheck control and the notice share one checking state and one recheck action; triggering either updates both
- [ ] Covered by tests, and checked in a running window
- [ ] pnpm verify passes

## Blocked by

None — can start immediately
