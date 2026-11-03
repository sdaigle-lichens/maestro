# Fully review the remaining eight stamped-only concept skills

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 116 (report r010) only re-stamped 13 concepts, deciding from commit lists, diffs and keyword coverage rather than a full read. Task 118 (report r012) fully reviewed the five riskiest and found real inaccuracies in all five: wrong locations, renamed functions, removed UI, and a false claim about this repo's maestro.json. So the other eight are suspect too:
- task-queue (.claude/skills);
- installing-maestro (.claude/skills);
- updating-maestro (.claude/skills);
- agent-fork-sync;
- create-skills-architecture;
- docs-view;
- global-stores;
- maestro-config-model.
The last five live under apps/maestro/.claude/skills.

For each, read the whole SKILL.md and all its sub-concept/reference files against the current code of every file it names or maps in scribe.config.json. Judge every claim against today's code, not just the diff since the stamp. Fix anything wrong, missing or stale: file names, line counts, function names, behaviour, invariants, counts. Keep each skill's existing structure and density. Docs-only: no application code, nothing under plugins/.

Work through the Documentation workflow (code-graph:update-single-concept-skill per concept). After editing, stamp each concept and run extract + apply. A concept with no inaccuracies still gets a stamp, and the report says what was checked.

Under the sandbox, `skills stamp` can't write .claude/skills/**, which is where the first three concepts live. If a stamp fails there, set the frontmatter to exactly what the tool computed (code-graph 0.3.21+ prints it with exit 9; with an older version, report it rather than computing the values by hand). Enrichment stays lazy: only re-enrich vertices that become stale.

## Acceptance criteria

- [ ] Each of the eight concepts was read in full against the current code of its mapped files; the report lists, per concept, the claims corrected (or 'no inaccuracies found' with what was checked).
- [ ] `code-graph skills status` shows 0 commits since stamp and `graph: 0 changed, 0 stale, unextracted 0` for all eight.
- [ ] No application code and nothing under plugins/ changed.
- [ ] Any stamp the tool couldn't write is named in the report, with how it was applied.

## Blocked by

None — can start immediately
