# Report r007: 095-mark-collapsed-plugin-groups-that-hide-a-dangling-skill-reference.md

- Task: 095-mark-collapsed-plugin-groups-that-hide-a-dangling-skill-reference.md
- Written: 2026-10-13T16:17:46.901Z
- From session: maestro-85

Outcome: task 095 done in worktree task-095 (uncommitted, unmerged). Collapsed Skills groups show a dangling indicator; Recheck control and notice share one checking state and recheck action. pnpm verify green (12/12 tasks, 1857 tests); checked in a running window.
Findings: one loop-back, a prettier error in group-dangling.ts caught by @test, fixed by @frontend. No plugins/ changes, so no version bump.
Suggested ticket changes: none.
