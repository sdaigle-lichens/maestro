# `/maestro` fails to start on a long-installed project

The orchestrator skill's **frontmatter is outside the managed regions, and an update never rewrites
it.** The whole file is copied from the template only when `.claude/skills/maestro/SKILL.md` is
absent; after that only the managed regions are re-synced. So a project installed before the plugin
added a frontmatter field keeps the old frontmatter forever.

That matters as of `0.4.1`, whose Step 1 needs an `allowed-tools:` grant for
`maestro-step1-gates.cjs` — without it the injected command's permission check aborts the
invocation before the model sees the skill.

Diagnose by comparing the project's frontmatter against the plugin's `templates/maestro/SKILL.md`.
The fix is to delete `.claude/skills/maestro/SKILL.md` and re-run step 1 of this skill, which
re-copies it from the template. Alternatively the user can run `/maestro-uninstall --purge` then
`/maestro-install` — both are user-only commands, so ask the user to type them.
