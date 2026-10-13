# Move the concept skills into an opt-in concept-skills plugin

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Create a second marketplace plugin, `concept-skills`, and move every concept-skill piece out of `maestro`, so Maestro names no concept-skill skill, script or field and a project opts in or out per project through Claude Code's `enabledPlugins`. The settled design is in the `concept-skills-plugin` epic's EPIC.md; read it first.

**Start with a spike** and record the result in the epic: does a plugin-namespaced id such as `concept-skills:scribe` in an instance's `loaded_skills` resolve through the SubagentStart context-injection hook's skill-id resolution (written for project skills), and does a `concept-skills` plugin skill load in a subagent? If it does not resolve, fix the resolution as part of this task.

**Moves to `concept-skills`:** `create-concept-skills`, `update-concept-skills`, `update-single-concept-skill`, the `scribe` placement-rule skill (absorbing the scribe agent's former Trigger 5 instructions: which flow to pick, the proposal step that ends a subagent turn, never hand-editing version metadata), `load-concept-skills`, `explore-concept-skills`, `use-code-architecture-design-check`, `code-architecture-design` (their `list` injection now runs their own plugin's CLI), and the concept-skills CLI with its generated lib. The concept-skill TypeScript (parsing, discovery, stamping, state) and its tests move to a new `packages/concept-skills` workspace package that builds the plugin's CJS lib, mirroring how the maestro app builds its plugin libs.

**New lifecycle skills in `concept-skills`:** `concept-skills-install` (enables the plugin for the project, seeds `concept-skills.json`, offers to run `create-concept-skills`; if `.claude/maestro.json` exists, asks whether to add `concept-skills:scribe` to the scribe agent and, on yes, tells the user where to add it in the app's workflow view — it never edits `maestro.json`), `concept-skills-update`, `concept-skills-uninstall` (disables the plugin, optionally removes `concept-skills.json`, leaves the concept skill files, which are ordinary skills).

**Agents list (R1):** the CLI's `agents` command reads an `agents` list in `.claude/concept-skills.json` instead of `maestro.json`; install seeds it from whatever the project has, and `/update-concept-skills` re-checks it against the project's agents and proposes additions. `readAgentsAvailable` (still used by the app's Handoffs tab) moves into Maestro's own config code.

**Decoupling Maestro:**
- The scribe agent loses Trigger 5; its Bash boundary becomes generic (commands a loaded skill grants, plus read-only git).
- The seed no longer adds `scribe` to the scribe instance's `loaded_skills`, and seeds the Refactor workflow's design-check node and the default start-skill lists only with skills that are actually available.
- The orchestrator template drops the "invoke `explore-concept-skills` before a `/<skill>` step" line; `create-workflow` / `update-workflow` drop their explore step (record in the epic whether a hook for them is still worth adding — default no).
- Gaps (G2): the report-default note and the scribe-bound handoff seeds carry a generic `skill_gaps` (`{ "skill": "<skill-id>", "missing": "..." }`) for any loaded skill, still on the scribe's channel; `conceptSkillsUpdated` is dropped from the scribe report. Add new prior versions in the report/handoff defaults so stored defaults upgrade.
- `maestro-help`, `cleanup-skill`, `maestro-install` prose and the plugin's description/keywords stop naming concept skills.
- `maestro-update` flags stale references in an existing project: a `loaded_skills` / workflow node / start-skill entry naming a skill that no longer exists, and a non-empty concept list with the `concept-skills` plugin not enabled (suggest installing it).

**Publishing:** add the plugin to the marketplace manifest with its own `plugin.json`; patch-bump `maestro`. Update the developer docs that describe this machinery (`concept-skills-system`, `installing-maestro`, `updating-maestro`, `maestro-architecture`, `docs/features/concept-skill.md`, root `CLAUDE.md` / `README.md`).

## Acceptance criteria

- [ ] Spike result recorded in the epic; a `concept-skills:…` id in `loaded_skills` provably loads in a subagent (test or recorded session).
- [ ] `grep` finds no concept-skill skill, script, CLI or `concept_skill_gaps` / `conceptSkillsUpdated` reference left under `plugins/maestro/` or in the app's runtime-facing seeds and defaults.
- [ ] With `concept-skills` disabled, `/maestro`, `/to-maestro-tasks` and the scribe run with no error and no concept-skill instructions in their context.
- [ ] With it enabled and `concept-skills:scribe` on the scribe, the scribe can run create / update / update-single, and the design skills load the concept list from their own plugin.
- [ ] The CLI's `agents` reads `concept-skills.json`; install seeds it; the app's Handoffs tab still lists agents from `maestro.json`.
- [ ] Report and handoff defaults carry generic `skill_gaps` with new prior versions; existing stored defaults upgrade.
- [ ] `maestro-update` reports a dangling skill reference and suggests installing `concept-skills` when a concept list exists.
- [ ] Marketplace lists both plugins; both `plugin.json` versions set per the publishing rules; libs rebuilt, mirrors refreshed, parity test and `pnpm verify` pass.

## Blocked by

- `089-configurable-start-and-end-skills-for-maestro-and-to-maestro-tasks.md`
