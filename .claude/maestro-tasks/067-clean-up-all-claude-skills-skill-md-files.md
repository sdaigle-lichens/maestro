# Clean up all .claude/skills SKILL.md files

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Run the cleanup-skill skill against each of the 6 skills under .claude/skills/: concept-skills-system, installing-maestro, maestro, maestro-architecture, task-queue, and updating-maestro. For each one, trim bloat and repetition from its SKILL.md to save context tokens, and split growing content into sub-concepts/ or references/ files where the skill's own criteria call for it. Apply the cleanup skill's judgment consistently across all six rather than a generic trim.

## Acceptance criteria

- [ ] Each of the 6 skills (concept-skills-system, installing-maestro, maestro, maestro-architecture, task-queue, updating-maestro) has been run through the cleanup-skill skill
- [ ] No documented behavior or content was lost from any skill — only bloat, repetition, and verbosity were removed
- [ ] Any skill whose SKILL.md had grown unwieldy now has content split into sub-concepts/ or references/ files per the cleanup-skill's own guidance
- [ ] Each SKILL.md remains internally consistent and correctly cross-references any newly split-out files

## Blocked by

None — can start immediately
