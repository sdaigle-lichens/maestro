# Configurable start and end skills for /maestro and /to-maestro-tasks

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Replace the two Step 1 gate checkboxes (confidence check, design check) with user-chosen, ordered skill lists, so Maestro stops naming specific skills at the start of a run and a project can pick any installed skill (project or plugin, namespaced like `concept-skills:use-code-architecture-design-check`).

The config shape in `maestro.json` replaces `gates`:

```json
"start_skills": { "maestro": ["confidence-check"], "to_maestro_tasks": ["confidence-check", "use-code-architecture-design-check"] },
"end_skills": { "maestro": [] }
```

- **/maestro Step 1** still comes from the single injected line printed by the Step 1 script; it now names the `start_skills.maestro` list in order, to be run with the Skill tool. Low-score / stop handling no longer lives in the script's text: the script says only that if a start skill says to stop or asks the user, do that before Step 2. Each bundled gate skill must already state its own stop rule in its output (check confidence-check does).
- **/maestro end skills** run once the success path is complete, independent of `active_task` (Step 4 only runs when a task file is active). Use the same one-line injected-script mechanism and contract as the Step 1 / Step 4 scripts (exit 0 always, no stderr, one line, policy-disabled fallback sentence kept in the template). Decide and document which owns committing when an end skill commits and the task ran in a worktree (Step 4 already commits there).
- **/to-maestro-tasks** replaces its hard-coded confidence-check and design-check steps with "run the project's `to_maestro_tasks` start skills", injected the same way, but through the plugin's own copy of the script (`${CLAUDE_PLUGIN_ROOT}`), not the project's `.claude/scripts/` copy, so a project without the runtime installed does not abort the skill.
- **Backward compatibility, no silent loss:** when `start_skills` is absent, the resolver reads the old `gates` booleans as the equivalent list (confidence_check → `confidence-check`, use_code_architecture_design_check → `use-code-architecture-design-check`) for both `/maestro` and `/to-maestro-tasks` (the latter defaults to the old behaviour of running both). A save from the app writes the new shape. Every degenerate input still resolves to the continue line.
- **App:** the `/maestro` page's gate checkboxes become three ordered skill pickers (Maestro start, To-maestro-tasks start, Maestro end) fed from the discovered skills, saving through the existing config-slice path.
- Everything else that reads `gates` or names the two gate skills follows: team-meeting's config summary, session usage, the seed (seeded defaults should reproduce today's behaviour for a fresh project), the maestro-update / install docs, and the developer skills describing Step 1 (`maestro-architecture`'s step-gates sub-concept, `installing-maestro`, `updating-maestro`, and the app's config-model skill).

This is the first half of the `concept-skills-plugin` epic (see its EPIC.md): it must land before the design skills can move to another plugin, because after this nothing in Maestro names them except the seeded defaults.

## Acceptance criteria

- [ ] `maestro.json` supports `start_skills.maestro`, `start_skills.to_maestro_tasks` and `end_skills.maestro` as ordered lists of skill ids, including plugin-namespaced ids; the TS resolver and the runtime script agree (one resolver, bundled into the plugin lib).
- [ ] A project with only the old `gates` field behaves exactly as before for both `/maestro` and `/to-maestro-tasks`; a test covers every gates combination and the absent/corrupt cases.
- [ ] The Step 1 line names exactly the configured start skills in order; the end line names exactly the configured end skills; both keep the one-line / exit-0 / no-stderr contract, pinned by tests on properties, not wording.
- [ ] `/to-maestro-tasks` names no gate skill in its own prose and runs whatever its list holds, via the plugin's copy of the script.
- [ ] The app's `/maestro` page edits all three lists (add, remove, reorder) and a save round-trips through `maestro.json`; verified in a running window.
- [ ] The worktree-commit vs end-skill ownership rule is decided and written in the orchestrator template.
- [ ] Generated plugin libs rebuilt, `.claude/scripts/` mirrors refreshed, parity test passes, `maestro` plugin version patch-bumped (minor if a new hook event or script surface is added), and `pnpm verify` passes.

## Blocked by

None — can start immediately
