# Accept code-graph's design check alongside concept-skills

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Precondition: do not start until the code-graph plugin (from its own marketplace, ~/gits/code-graph) ships `use-code-architecture-design-check`, `scribe` and the concept-skill flows, and is installable. If it is not, stop and say so.

Concept skills are moving from the opt-in concept-skills plugin to the code-graph plugin. The two repos stay autonomous: maestro never depends on code-graph; it only recognises its skill ids when they are installed, exactly as it does for concept-skills today. This task makes maestro accept either plugin, additively, so nothing breaks for a project still on concept-skills.

- The design-check availability candidates become first-available-wins over `code-graph:use-code-architecture-design-check`, then `concept-skills:use-code-architecture-design-check`. Seeding needs no change of its own: it already takes the design check from availability.
- The plugin suggestion recognises a code-graph project (a root `scribe.config.json`) whose plugin is not enabled, and for a project that still keeps the legacy `.claude/concept-skills.json` suggests code-graph with a "migrate via /code-graph-install" hint. Code-graph is installed from its own marketplace; the hint must not claim it is in maestro's.
- The renderer dev stub offers the code-graph ids too.
- Rebuild the plugin libs, refresh the `.claude/scripts/lib/` mirrors, prove parity, and bump the maestro plugin version (patch).

## Acceptance criteria

- [ ] With only code-graph enabled, a fresh seed has the code-graph design-check id in skills_available, start_skills.to_maestro_tasks and the Refactor workflow's skill node
- [ ] With only concept-skills enabled, the seed is unchanged from today; with neither, no design-check node and no error
- [ ] A `code-graph:` id in loaded_skills passes through the real SubagentStart hook unresolved-free, as the concept-skills one does
- [ ] Plugin suggestions cover: scribe.config.json without code-graph enabled, and legacy .claude/concept-skills.json (migrate hint)
- [ ] Nothing under plugins/maestro names code-graph beyond the candidate id (mirrors the existing no-plugin-names test)
- [ ] Existing concept-skills tests still pass; new code-graph cases are added beside them
- [ ] plugin libs rebuilt, mirrors refreshed, parity test green, maestro plugin.json version bumped, `pnpm verify` green

## Blocked by

None — can start immediately
