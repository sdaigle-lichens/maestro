# Switch this repo to code-graph and dogfood the scribe

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Move the maestro repo itself from concept-skills to code-graph, then prove it works in a real run before anything is removed. The concept SKILL.md files stay where they are; only the plugin that owns them changes.

- `.claude/settings.json`: enable code-graph (from its own marketplace), disable `concept-skills@maestro`.
- Run `/code-graph-install` to migrate `.claude/concept-skills.json` into `scribe.config.json`; confirm code-graph's `skills list` returns the same ids and versions as concept-skills' `list`.
- `.claude/maestro.json`: every `concept-skills:` id becomes its `code-graph:` equivalent — skills_available, the scribe instance's loaded_skills, start_skills for maestro and to_maestro_tasks, and the Refactor workflow's skill node. Re-render the orchestrator skill with `/maestro-update` rather than hand-editing it.
- README: replace the `concept-skills@maestro` install line and section with adding the code-graph marketplace and installing code-graph from it; describe it as opt-in.

Then dogfood: run one default-workflow task end to end and watch the scribe step.

## Acceptance criteria

- [ ] code-graph `skills list` matches concept-skills `list` id for id and version for version on this repo
- [ ] No `concept-skills:` id remains in .claude/maestro.json, and the rendered orchestrator skill names the code-graph design check
- [ ] A scribe run loads `code-graph:scribe` and revises one stamped concept skill (minor bump, last-update set). Amended by the epic manager: this repo has no graph `concepts` configured yet, so extract + apply are expected to be skipped (the scribe skill's no-concepts rule); their failure is a code-graph finding, already filed
- [ ] A synthetic skill gap written to .claude/channels/scribe/ reaches the scribe on its next run and is acted on (amended: no workflow step writes one naturally)
- [ ] Any parity gap found is reported (and filed against code-graph), not patched around in maestro

## Blocked by

- `105-accept-code-graph-s-design-check-alongside-concept-skills.md`
