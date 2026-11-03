# Remove the concept-skills plugin and package

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

With the repo running on code-graph, delete the concept-skills machinery from maestro and every mention that would now mislead.

- Delete `plugins/concept-skills/` and `packages/concept-skills/`, its marketplace entry and lockfile entries.
- Drop the `concept-skills:` design-check candidate and the legacy-plugin wording from the suggestion (keep the migrate hint for a project that still has `.claude/concept-skills.json`). Rebuild libs, refresh mirrors, prove parity, bump the maestro plugin version (patch).
- Rename/rewrite the concept-skills plugin test around code-graph ids and drop its assertions about the sibling concept-skills plugin; update the other tests that name concept-skills.
- Docs: root CLAUDE.md (package list and plugin paragraph), `docs/features/concept-skill.md` (point to code-graph), `.claude/skills/concept-skills-system/` (replace with a short note that concept skills live in code-graph, or delete and remove it from referenced_skills/skills_available), and the dev skills that mention it — maestro-architecture step-gates (also fix its existing wrong claim that the design skill ships in the maestro plugin), task-queue, installing-maestro skill-discovery, updating-maestro version-bump examples, the app's maestro-config-model and global-stores handoff-defaults. Comments in core that name concept-skills as the example plugin get the code-graph name.
- Clear the two concept-skills lines from BACKLOG.md.
- README still mentions concept-skills (around line 21, the list of published plugins); fix it. Delete the synthetic gap file `.claude/channels/scribe/reviewer.1.md` left by 106's test.
- Re-stamp `maestro-architecture` with code-graph: its SKILL.md was edited in 62480e7 without a version bump. Any doc touched here must not point at the commands code-graph 0.3.1 drops (`/scribe-enrich`, `/code-graph-init`, the `/add-concept` command).

Historical task files and epics under .claude/ stay untouched.

## Acceptance criteria

- [ ] plugins/concept-skills and packages/concept-skills are gone; marketplace.json lists only maestro's own plugins
- [ ] `maestro-stale-refs.cjs` reports no `concept-skills:` ids
- [ ] grep for `concept-skills` outside .claude/maestro-tasks, .claude/epics and the legacy-state migrate hint returns nothing stale
- [ ] plugin libs rebuilt, mirrors refreshed, parity test green, maestro plugin.json version bumped
- [ ] `pnpm verify` green

## Blocked by

- `106-switch-this-repo-to-code-graph-and-dogfood-the-scribe.md`
