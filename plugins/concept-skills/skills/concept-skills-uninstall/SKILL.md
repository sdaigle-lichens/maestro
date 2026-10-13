---
name: concept-skills-uninstall
description: "Turns concept skills off for this project: disables the concept-skills plugin in .claude/settings.json and, only if the user agrees, removes .claude/concept-skills.json. The concept skill files themselves are ordinary skills and are left in place. Use when the user runs /concept-skills-uninstall or asks to stop using the concept-skills plugin in a project."
disable-model-invocation: true
---

# Concept Skills Uninstall

Switch concept skills off for one project without deleting any documentation.

## User's intention

$ARGUMENTS

## Workflow

1. **Disable the plugin.** Read `${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json`. If it does not parse, stop and tell the user. Remove the `"concept-skills@maestro"` entry (or `@` whatever marketplace it was installed from) from `enabledPlugins` (or set it to `false` if the user prefers to keep a record), leaving every other key untouched, and drop `enabledPlugins` only if that leaves it empty. If the entry is not there, say the plugin was not enabled for this project.

2. **The state file.** If `${CLAUDE_PROJECT_DIR:-.}/.claude/concept-skills.json` exists, show its contents (`node "${CLAUDE_SKILL_DIR}/../../scripts/concept-skills.cjs" state`, then the same with `agents`) and ask whether to delete it. It holds the list's freshness record and the agents list; deleting it means a future `/create-concept-skills` starts from scratch. Delete it only on an explicit yes.

3. **Leave the concept skills.** Every `.claude/skills/<id>/` that carries `metadata.type: concept-skill` is an ordinary skill and keeps working with the plugin off. Say so, and do not delete them. If the user wants them gone, tell them to delete those directories themselves.

4. **Maestro.** If `.claude/maestro.json` lists `concept-skills:scribe` (or any `concept-skills:` skill) on an agent, tell the user those entries now point at a skill that is no longer available and should be removed in the Maestro app's workflow view. Do not edit `maestro.json`.

5. **Report** what was disabled, what was kept, and what the user still has to do.
