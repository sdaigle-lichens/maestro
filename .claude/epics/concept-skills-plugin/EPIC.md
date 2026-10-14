# Epic: concept-skills-plugin

## Goal

Move the concept-skill machinery out of the `maestro` plugin into a new, opt-in `concept-skills`
plugin, so a project can use Maestro with or without concept skills, and Maestro itself names no
concept-skill code, script or skill.

## Scope

In:

- Configurable start skills (one list for `/maestro`, one for `/to-maestro-tasks`) and end skills
  (for `/maestro`), replacing the two Step 1 gate checkboxes.
- The new `concept-skills` plugin: the concept-skill flows, the `scribe` skill, the load/explore
  helpers, the CLI, and the two design skills (`use-code-architecture-design-check`,
  `code-architecture-design`), plus install / update / uninstall skills.
- Decoupling Maestro: generic `skill_gaps`, Trigger 5 removed from the scribe agent, the
  orchestrator template's explore line removed.

Out:

- Any automatic edit of `maestro.json` by the `concept-skills` plugin.
- Concept context for `create-workflow` / `update-workflow` via a hook (decide during the split; drop
  if not clearly needed).

## Decisions

- Full separation (B′): Maestro asks for nothing; concept-skills is opt-in per project via Claude
  Code's `enabledPlugins`.
- Step 1 `gates` → `start_skills: { maestro: [...], to_maestro_tasks: [...] }` and `end_skills`
  (for `/maestro`), ordered pickers on the app's `/maestro` page; old `gates` values read as the
  equivalent list.
- Orchestrator template line "invoke `explore-concept-skills` before a `/<skill>` step" is dropped.
- Scribe: the user adds `concept-skills:scribe` to a scribe instance in the workflow view;
  `concept-skills-install` only asks (when `.claude/maestro.json` exists) and points to where.
- Gaps (G2): Maestro's `concept_skill_gaps` becomes a generic `skill_gaps` for any loaded skill on
  the scribe channel; `conceptSkillsUpdated` is dropped.
- Agents list (R1): the CLI's `agents` command reads an `agents` list in `concept-skills.json`,
  seeded at install and re-checked by `/update-concept-skills`; `readAgentsAvailable` moves to
  Maestro's config code.
- Concept-skill TypeScript moves to a `packages/concept-skills` workspace package that builds into
  the new plugin.
- Order: start/end skills first, the split second — the split moves skills that Maestro's Step 1
  and `to-maestro-tasks` currently name.

### From 089 (r001)

- Start/end lists are resolved by one shared `resolveSkillLists` (bundled as
  `lib/maestro-skill-lists.cjs`), falling back to legacy `gates` when `start_skills` is absent; end
  skills come from `maestro-end-skills.cjs`; `/to-maestro-tasks` uses the plugin's own copy of
  `maestro-step1-gates.cjs`. The app's pickers filter out the `maestro` skill and duplicates in bare
  or namespaced form. `maestro` plugin is at 0.11.8.
- After 089, the two design skills are named only by the seeded defaults (start-skill lists and the
  Refactor workflow node) — 090 makes those conditional on the skill being available.
- Orchestrator template, as hand-edited by the user: Step 4 no longer commits, Step 6 runs end
  skills, Step 7 is the worktree merge. 090 must not reintroduce a commit in Step 4.
- Existing projects need a re-install to get the new `allowed-tools` grant in the orchestrator
  template; 090's `maestro-update` stale-reference checks should not assume that has happened.
- `pnpm lint` failed on unrelated `packages/ui` stories and the untracked
  `apps/maestro/storybook-static`; fixed outside the epic in `e5a92c3`, so `pnpm lint` is clean
  again and 090's "`pnpm verify` passes" holds as written.

### From 090 (r002)

- Spike: the real SubagentStart hook receives a namespaced skill id (`concept-skills:scribe`)
  unchanged and passes it through to the injected skill list, and the Skill tool resolves it, so
  no hook change was needed. Plugin-qualified ids are valid in `loaded_skills`, `skills_available`
  and skill nodes.
- Plugins: `concept-skills` is 0.1.0; `maestro` is 0.11.9. The marketplace lists both.
- `packages/concept-skills` owns the TypeScript and tests and builds
  `plugins/concept-skills/scripts/lib/concept-skills.cjs` (`pnpm --filter @repo/concept-skills
  build:plugin-lib`). The old `maestro-concept-skills` plugin-entry and lib are gone.
- CLI additions: `agents` reads the `agents` list in `concept-skills.json`; `agents-discover` and
  `agents-set <name>...` seed it. `concept-skills-install` seeds it and `/update-concept-skills`
  re-checks it. `readAgentsAvailable` now lives in `apps/maestro/src/core/config.ts`.
- Availability: `apps/maestro/src/core/skill-availability.ts` (bundled as
  `lib/maestro-skill-availability.cjs`, not a `STATIC_ASSET`) decides whether the design skill
  seeds (`seedSkillsFor`) and finds dangling refs (`findStaleSkillRefs`). A bare id resolves from
  project, user or any installed plugin skills; `plugin:skill` resolves when that plugin is enabled.
  `maestro-stale-refs.cjs` runs it from `/maestro-update` step 4 (always exit 0) and suggests
  `/concept-skills-install` when `concept-skills.json` exists but the plugin is not enabled.
- Seeds: scribe `loaded_skills` is `[]`; `skills_available`, the Refactor design-check node and
  `start_skills.to_maestro_tasks` include the design skill only when it resolves.
- Defaults: generic `skill_gaps` replaces `concept_skill_gaps` / `conceptSkillGaps`; the old report
  and handoff bodies are prior versions so stored defaults upgrade (`conceptSkillsUpdated` dropped).
- Legacy removed (user will reinstall everywhere; supersedes 089's `gates` fallback):
  `resolveSkillLists` no longer reads `gates`; `LEGACY_DESIGN_SKILL`, `LEGACY_CONFIDENCE_SKILL`,
  `MaestroGates` and `mergeSlice`'s `delete next.gates` are gone. With no `start_skills` (or a
  degenerate config) all three lists are empty, including `/to-maestro-tasks`. The seed's bare
  `use-code-architecture-design-check` candidate is gone; only
  `concept-skills:use-code-architecture-design-check` seeds.
- UI work for the frontend step is in `.claude/channels/frontend/backend.1.md`.
- Hook for `create-workflow` / `update-workflow` concept context: not worth adding (default
  held). Those skills dropped their explore step; revisit only if workflow authoring visibly
  suffers without concept context.
- `cleanup-skill`'s concept-skill example was removed at the user's request, and the test
  allow-list that scans `plugins/maestro/` for concept-skill names was updated to match.

### After 090 (reinstall review)

- Re-installing 0.11.9 kept this repo's old `gates` config and seeded no `start_skills`, so Step 1
  was empty. Fixed here by hand (start lists set, `gates` removed, `scribe` and the design check
  switched to `concept-skills:` ids, orchestrator re-rendered); 092 makes install/update seed
  missing lists.
- 091 (stale-refs UI) and 092 are independent.
