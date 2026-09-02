# Metadata markers

The whole contract lives in `apps/maestro/src/core/concept-skills.ts` as exported constants:
`TYPE_KEY` (`type`), `CONCEPT_TYPE` (`concept-skill`), `VERSION_KEY` (`version`), `LAST_UPDATE_KEY`
(`last-update`), `INITIAL_VERSION` (`1.0`), `SUB_CONCEPTS_DIR`, `AGENT_NOTES_DIR`.

`version` is `major.minor`. `bumpMinor` / `bumpMajor` / `parseVersion` / `formatVersion` are the only
sanctioned ways to change it, reached through `stamp`. `last-update` is the commit the skill was last
reconciled against, which is what lets `/update-concept-skills` diff forward instead of re-reading
the repo.

`discoverConceptSkills(root)` walks every `.claude` in the tree — monorepo-aware by design — and
returns only skills carrying `type: concept-skill`. `stampConceptSkill` rewrites the frontmatter in
place, preserving the rest of the file.

Repo-level state is `MaestroConceptSkillsState` (`version`, `last_update`) in
`<root>/.claude/concept-skills.json`, read and written by `readConceptSkillsState` /
`writeConceptSkillsState`.
