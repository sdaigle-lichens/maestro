# Report r001: 089-configurable-start-and-end-skills-for-maestro-and-to-maestro-tasks.md

- Task: 089-configurable-start-and-end-skills-for-maestro-and-to-maestro-tasks.md
- Written: 2026-10-12T22:21:24.395Z
- From session: maestro-e6

Task 089 done. Start and end skill lists replace the two Step 1 gates.

- One shared resolver, `resolveSkillLists`, bundled as `lib/maestro-skill-lists.cjs`. It falls back to the legacy `gates` booleans when `start_skills` is absent.
- New `maestro-end-skills.cjs`. `/to-maestro-tasks` runs its start list through the plugin's own copy of `maestro-step1-gates.cjs`.
- The app's /maestro page has three ordered pickers. It filters out the `maestro` orchestrator skill and any skill already in the list, in bare or namespaced form.
- Plugin bumped to 0.11.8.
- Findings: `pnpm lint` fails on unrelated `packages/ui` stories and the untracked `apps/maestro/storybook-static`.
- Existing projects need a re-install to get the new `allowed-tools` grant in the orchestrator template.
- The user hand-edited the template: Step 4 does not commit, Step 6 is end skills, Step 7 is the worktree merge.
- Suggested ticket changes: for the concept-skills-plugin epic's second half, the design skills are now named only by the seeded defaults.
