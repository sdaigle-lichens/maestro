---
name: concept-skills-install
description: "Sets up concept skills for this project: enables the concept-skills plugin in .claude/settings.json, seeds .claude/concept-skills.json with the list of agents that get per-agent notes, and offers to run /create-concept-skills. If the project also uses Maestro (.claude/maestro.json exists) it asks whether to add concept-skills:scribe to the scribe agent and tells the user where to do that in the Maestro app; it never edits maestro.json. Use when the user runs /concept-skills-install or asks to turn on / set up concept skills for a project."
disable-model-invocation: true
---

# Concept Skills Install

Turn concept skills on for one project. Everything here is project-local and re-runnable: a second run changes nothing that is already right.

## User's intention

$ARGUMENTS

## Workflow

1. **Enable the plugin for the project.** Read `${CLAUDE_PROJECT_DIR:-.}/.claude/settings.json` (treat a missing file as `{}`; if it exists and does not parse as JSON, stop and tell the user rather than overwriting it). Make sure `enabledPlugins` has `"concept-skills@maestro": true`, keeping every other key exactly as it is. If the marketplace the user installed this plugin from is not named `maestro`, use that name after the `@` instead.

2. **Find the agents.** Run:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/concept-skills.cjs" agents-discover
   ```

   It prints a JSON array: the project's `.claude/agents/*.md` agents plus, when the project uses Maestro, the `agents_available` of `.claude/maestro.json`. Show the user the list and ask which of them should get `agents/<agent>.md` notes inside each concept skill (the default is all of them; an empty list means no agent notes are ever written). If `concept-skills.json` already has an `agents` list (`concept-skills.cjs agents`), show it and keep it unless the user wants changes.

3. **Seed the state file** with the chosen names (none for an empty list):

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/concept-skills.cjs" agents-set <name> <name>
   ```

   This creates `.claude/concept-skills.json` holding only `agents`; it does not claim a concept-skill list exists yet.

4. **Maestro, only if it is there.** If `${CLAUDE_PROJECT_DIR:-.}/.claude/maestro.json` exists, ask whether the scribe agent should load `concept-skills:scribe` so documentation placement follows the concept-skill rules. On yes, tell the user where: in the Maestro desktop app, open the workflow view, select the scribe instance and add `concept-skills:scribe` to its loaded skills. **Do not edit `maestro.json` yourself.** On no, drop the subject.

5. **Offer the list.** Run `concept-skills.cjs state`. If it prints `{"present":false}`, offer to run `/create-concept-skills` now; if the user declines, say it can be run any time. If a list is already recorded, point at `/update-concept-skills` instead.

6. **Report** in a few lines: whether the plugin was newly enabled, the agents recorded, whether the Maestro pointer was given, and the next command to run. Tell the user to restart Claude Code (or run `/reload-plugins`) if the plugin's skills do not show up straight away.
