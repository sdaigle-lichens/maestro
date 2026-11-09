# Re-review and stamp the maestro-architecture concept skill after tasks 160 and 163

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

scribe reports the maestro-architecture concept skill as not stamped. Three of its mapped source files changed under tasks 160 (interim stops and run-wide payload measurement) and 163 (absolute channel paths in worktree runs): the hand-off label logic, the hand-off payload check and the session plugin entry. Compare the skill and its sub-concepts with what those files do now, correct every stale or missing statement, and then mark the skill as reviewed with scribe's stamp command (skills stamp --reviewed) so the drift report is clean. This is a documentation change only: no source, no plugin file and no plugin version change. It must land before task 167, which edits the same concept notes.

## Acceptance criteria

- [ ] Every statement in the maestro-architecture skill and its sub-concepts about the hand-off label, the payload check and the session entry matches the current code
- [ ] The skill is stamped as reviewed and scribe no longer reports it as drifted
- [ ] No file under plugins/ or apps/ changes; pnpm verify passes

## Touched surfaces

- .claude/skills/maestro-architecture/SKILL.md and sub-concepts/*.md
- the scribe stamp records for maestro-architecture (scribe-output/ and/or the skill's stamp metadata)
- merge order: before 167 (167 is blocked by this task); parallel OK with 166 (no shared files)

## Blocked by

None — can start immediately
