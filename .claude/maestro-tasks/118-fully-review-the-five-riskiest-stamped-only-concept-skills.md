# Fully review the five riskiest stamped-only concept skills

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 116 (report r010, .claude/epics/code-graph-cutover/inbox/) brought every concept skill up to date, but 13 were only re-stamped, and that decision was made from commit lists, diffs and keyword coverage, not a full read. A stamp can't tell a skimmed concept from a reviewed one. Re-check the five with the most code change since their previous stamp (the 116 baseline):
- plugin-libs-parity (14 commits);
- electron-shell-invariants (13);
- workflow-view (9);
- log-view (7);
- rule-view (7).

For each, read the whole SKILL.md (and its sub-concept/reference files) against the current code of every file it names or maps in scribe.config.json. Use the git range from the concept's pre-116 stamp to HEAD to find what changed, but judge every claim against today's code, not just the diff. Fix anything wrong, missing or stale: file names, line counts, function names, behaviour, invariants. Keep each skill's existing structure and density. Docs-only: no application code, nothing under plugins/.

Work through the Documentation workflow (code-graph:update-single-concept-skill per concept). After editing, stamp it and run extract + apply. Under the sandbox, `skills stamp` can't write .claude/skills/**. If it fails there, set the frontmatter to exactly what the tool computed (code-graph 0.3.21+ prints it with exit 9), never hand-computed values. These five live under apps/maestro/.claude/skills/; say if any stamp still fails. Enrichment stays lazy: only re-enrich vertices that become stale.

## Acceptance criteria

- [ ] Each of the five concepts was read in full against the current code of its mapped files; the report lists, per concept, the claims corrected (or 'no inaccuracies found' with what was checked).
- [ ] `code-graph skills status` shows 0 commits since stamp and `graph: 0 changed, 0 stale, unextracted 0` for all five.
- [ ] No application code and nothing under plugins/ changed.
- [ ] Any stamp that couldn't be written by the tool is named in the report with how it was applied.

## Blocked by

None — can start immediately
