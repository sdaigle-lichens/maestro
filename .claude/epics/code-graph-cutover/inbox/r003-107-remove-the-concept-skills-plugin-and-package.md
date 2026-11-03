# Report r003: 107-remove-the-concept-skills-plugin-and-package.md

- Task: 107-remove-the-concept-skills-plugin-and-package.md
- Written: 2026-10-15T13:00:31.473Z
- From session: maestro-50

# Report: 107 remove the concept-skills plugin and package

**Outcome:** done, clean session (default workflow; @backend, @frontend, human review approved, @test, @reviewer PASS, @scribe). Nothing committed.

**What landed**
- Deleted `plugins/concept-skills/`, `packages/concept-skills/` and the `concept-skills-system` dev skill (also dropped from `maestro.json` skills lists); marketplace, lockfile and settings entries removed.
- `DESIGN_CHECK_CANDIDATES` is now only the code-graph id; `pluginSuggestions()` keeps one migrate hint for legacy `.claude/concept-skills.json`.
- Lib `maestro-skill-availability.cjs` rebuilt and mirrored; maestro plugin 0.11.24 -> 0.11.25; parity test green (43).
- Test renamed to `code-graph-plugin.test.ts`; seven other tests re-pointed.
- Docs: CLAUDE.md, README, BACKLOG, `docs/features/concept-skill.md` (header plus the wrong state claim on line 29), six dev skills; `maestro-architecture` re-stamped 1.23 and the five other edited dev skills stamped by @scribe.
- `maestro-stale-refs.cjs` clean; `pnpm verify` green (1979 tests, though @test's run was a turbo cache replay).

**Findings**
- `docs/features/concept-skill.md` body is still the original design text; reviewer judged it a historical doc, acceptable. A literal `concept-skills` grep still hits it and README lines 30-32 (code-graph's own command names).
- Untracked `plan.md` and `merge-proposal.md` predate this work and must not be committed with it.

**Post-mortem:** none.

**Suggested ticket changes:** none.
