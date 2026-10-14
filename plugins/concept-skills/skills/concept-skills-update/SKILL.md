---
name: concept-skills-update
description: "Checks that this project's concept-skills setup is current: the concept-skills plugin is enabled, .claude/concept-skills.json is well-formed with an up-to-date agents list, and the concept-skill list itself is not behind HEAD. Repairs the setup and then points at /update-concept-skills for the content. Use when the user runs /concept-skills-update or after updating the concept-skills plugin."
disable-model-invocation: true
---

# Concept Skills Update

Bring the project's concept-skills **setup** up to date. This skill never researches or rewrites concept skills themselves; that is `/update-concept-skills`.

## User's intention

$ARGUMENTS

## Workflow

1. **Plugin enabled?** Read `${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json`. If `enabledPlugins` lacks `"concept-skills@maestro": true` (or the marketplace name the plugin was installed from), say so and offer to add it exactly as `/concept-skills-install` step 1 does.

2. **State file.** Run:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/concept-skills.cjs" state
   ```

   `{"present": false}` means no concept-skill list has been recorded: offer `/create-concept-skills` (or, for a project that already has marked concept skills, run `concept-skills.cjs list` and tell the user `state-set --bump initial` is what `/create-concept-skills` does when it finishes). Do not invent a record.

3. **Agents list.** Compare `concept-skills.cjs agents` with `concept-skills.cjs agents-discover`. Show any agent that exists in the project but is not in the list, and any listed agent that no longer exists. Ask before changing anything; apply the answer with `concept-skills.cjs agents-set <name>...`.

4. **Freshness.** If the state is present, compare its `last_update` to `git rev-parse HEAD`. When they differ, tell the user how many commits the list is behind (`git rev-list --count <last_update>..HEAD`) and offer to run `/update-concept-skills`.

5. **Report** what was checked, what was changed, and what is left for the user to decide.
