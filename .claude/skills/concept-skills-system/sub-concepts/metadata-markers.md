# Metadata markers

The whole contract lives in `packages/concept-skills/src/concept-skills.ts` as exported constants:
`TYPE_KEY` (`type`), `CONCEPT_TYPE` (`concept-skill`), `VERSION_KEY` (`version`), `LAST_UPDATE_KEY`
(`last-update`), `INITIAL_VERSION` (`1.0`), `SUB_CONCEPTS_DIR`, `AGENT_NOTES_DIR`.

`version` is `major.minor`. `bumpMinor` / `bumpMajor` / `parseVersion` / `formatVersion` are the only
sanctioned ways to change it, reached through `stamp`. `last-update` is the commit the skill was last
reconciled against, which is what lets `/update-concept-skills` diff forward instead of re-reading
the repo.

`discoverConceptSkills(root)` walks every `.claude` in the tree — monorepo-aware by design — and
returns only skills carrying `type: concept-skill`. `stampConceptSkill` rewrites the frontmatter in
place, preserving the rest of the file.

**Why `metadata`, not a top-level key.** `metadata` is one of only six frontmatter fields
(`allowed-tools`, `compatibility`, `description`, `license`, `metadata`, `name`) that survive
claude.ai skill uploads, the Skills API and `package_skill.py`, and those paths reject an unknown
top-level key with a hard error. A custom key like `concept-version:` loads fine in Claude Code and
fails only at packaging. A stamp edits an existing `metadata:` map in place and keeps keys that
aren't ours.

**Trap — read it with `parseFrontmatterMetadata`.** `parseFrontmatter` in `packages/claude-fs` has
no notion of depth, so a `metadata:` block doesn't fail: it flattens into top-level keys and yields
the right values by accident. Only `parseFrontmatterMetadata` can tell `metadata.version` from a
top-level `version`.

Repo-level state is `ConceptSkillsState` (`version`, `last_update`) in
`<root>/.claude/concept-skills.json`, read and written by `readConceptSkillsState` /
`writeConceptSkillsState`.
