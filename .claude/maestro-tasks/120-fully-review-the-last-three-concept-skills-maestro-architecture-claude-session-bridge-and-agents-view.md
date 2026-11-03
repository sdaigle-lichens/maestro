# Fully review the last three concept skills: maestro-architecture, claude-session-bridge and agents-view

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Precondition (manual, cross-repo): needs code-graph 0.3.23 or later (task 029, commit bc86d8c). With 029, `skills status <skill>` lists the mapped files changed since the stamp, and `skills stamp` warns on a stamp-only over changed files. Check the installed version with `code-graph --version`, and confirm `skills status <skill>` prints that file list. If it doesn't, stop and report.

Tasks 118 and 119 (reports r012 and r013) fully reviewed 13 concepts and found real inaccuracies in every one, so task 116's stamp-only judgement was wrong 13 times out of 13. These three were never fully read:
- maestro-architecture (.claude/skills): 116 only added the `seedSkillsFor` / `DESIGN_CHECK_CANDIDATES` line;
- claude-session-bridge (apps/maestro/.claude/skills): 116 only fixed its module list and two line counts;
- agents-view (apps/maestro/.claude/skills): had 0 commits since its stamp, so it was only extracted and applied, though its stamp predates much of the code.

For each, read the whole SKILL.md and every sub-concept/reference file against the current code of every file it names or maps in scribe.config.json. Start from 029's changed-files list, but judge every claim against today's code, not just the diff. Fix anything wrong, missing or stale: file names, line counts, function names, behaviour, invariants, counts. Keep each skill's existing structure and density. Docs-only: no application code, nothing under plugins/.

Work through the Documentation workflow (code-graph:update-single-concept-skill per concept), then stamp each with an explicit `--bump`, then extract + apply. A concept with no inaccuracies is stamped with `--reviewed`, and the report says what was checked. maestro-architecture lives under .claude/skills, which the sandbox won't let `skills stamp` write: on exit 9, apply the printed lines verbatim with Edit. Never compute them by hand.

Finally, re-stamp the repo-level list with `code-graph skills stamp --bump minor`. Always pass `--bump`: before 0.3.22, a plain stamp reset the version to 1.0. Enrichment stays lazy: only re-enrich vertices that become stale.

## Acceptance criteria

- [ ] The installed code-graph includes task 029 (its version is named in the report).
- [ ] Each of the three concepts was read in full against the current code of its mapped files; the report lists, per concept, the claims corrected (or 'no inaccuracies found' with what was checked).
- [ ] `code-graph skills status` shows 0 commits since stamp and `graph: 0 changed, 0 stale, unextracted 0` for all three, and 0 commits for the repo-level list.
- [ ] No `skills stamp` warning was left unaddressed: each was resolved by an edit or by `--reviewed` with a reason in the report.
- [ ] No application code and nothing under plugins/ changed.

## Blocked by

None — can start immediately
