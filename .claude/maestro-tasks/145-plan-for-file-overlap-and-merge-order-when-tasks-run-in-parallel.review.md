## Goal

Stop parallel tasks in one epic colliding at merge time: plan file overlap and merge order up front, and never approve a red suite.

## Done

- `to-maestro-tasks` skill: pairwise parallel-safety check; version and generated files always count as overlap; one owner per shared new helper; who bumps versions; `touchedSurfaces` required in the skill's JSON.
- `maestro-write-tasks.cjs`: new optional `touchedSurfaces` string array, validated, rendered as `## Touched surfaces` between Acceptance criteria and Blocked by. Omitting it writes the file as before.
- `maestro-manager` skill: merge-plan table in EPIC.md (merge order, base per task, version ownership) before spawning, and spawn per it; the merger re-runs the full suite after each merge before acknowledging; worker reports name the verified commit plus a green full suite; the manager review checks Touches against `.claude/rules/*` and sibling tickets' Touched surfaces.
- Orchestrator template: Verified section in the manager review brief and human review summary; a rule never to approve a red suite, not even pending the test step; the Step 6 report must name the verified commit and a green full suite.
- Plugin version 0.13.12 -> 0.13.13.

## Deviations

- `handoff-seeds.ts` untouched (versioned texts); the rule lives in the template's review steps.
- No concept skill describes these two skills, so none was updated.
- No tests added yet (@test step is next). Only `pnpm --filter maestro check` was run, and it passed.
- Parity test fails (1 of 44): rendered STEPS in `.claude/skills/maestro/SKILL.md` and the `.claude/scripts/maestro-write-tasks.cjs` mirror are stale until `! pnpm refresh:runtime` is run.

## Decisions

- The red-suite rule goes in the orchestrator template (user's choice), so it reaches every project's rendered STEPS.

## Touches

`plugins/maestro/scripts/maestro-write-tasks.cjs`, `plugins/maestro/skills/to-maestro-tasks/SKILL.md`, `plugins/maestro/skills/maestro-manager/SKILL.md`, `plugins/maestro/templates/maestro/SKILL.md`, `plugins/maestro/.claude-plugin/plugin.json`

## Sibling impact

None known; no epic.

## Questions

- Run `! pnpm refresh:runtime` now, so the mirrors and STEPS are correct before @test runs?
