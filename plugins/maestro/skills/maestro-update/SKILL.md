---
name: maestro-update
description: "Refreshes the Maestro runtime scripts from the plugin and re-renders the Maestro orchestrator skill (.claude/skills/maestro/SKILL.md) from .claude/maestro.json. Use after hand-editing maestro.json, when the orchestrator's handoff table looks out of date, or to pull script updates from a newer plugin version. To edit the config visually, open the project in the Maestro desktop app (apps/maestro) instead — a save there renders the orchestrator itself."
---

# Maestro Update

Refresh the project's Maestro runtime scripts **and the orchestrator skill body** from the plugin, then regenerate the rendered region of the orchestrator from the current `.claude/maestro.json`.

## Workflow

1. **Refresh the runtime scripts and the skill body** by re-running the installer (idempotent — skips settings and gitignore if already present):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-install.js" "${CLAUDE_PROJECT_DIR:-.}"
   ```

   This overwrites `.claude/scripts/{maestro-set-session-workflow.cjs,maestro-render-orchestrator.cjs,maestro-task-status.cjs,bash-validation.sh,lib/maestro-session.cjs,lib/maestro-tasks.cjs,lib/maestro-skill-regions.cjs}` with the current plugin versions, so any fixes or new validation steps in a newer plugin release are picked up immediately.

   It **also syncs the orchestrator skill body**: the plugin-owned regions of `.claude/skills/maestro/SKILL.md` (`<!-- Maestro:STEPS -->`, `<!-- Maestro:PRINCIPLES -->`) are rewritten from `templates/maestro/SKILL.md`, so template improvements reach already-installed projects instead of silently drifting. Content **outside** those markers is your own and is never touched, and the rendered `<!-- Maestro:HANDOFFS -->` table is carried across.

   Read `orchestratorSkill.action` from the JSON summary and report it:
   - `synced` — regions refreshed (`.regions` lists which). Mention if the steps changed.
   - `unchanged` — the body was already current.
   - `installed` — no skill was there; the template was written fresh.
   - `migrated` — the install predates the markers, so it could not be synced in place. The old file is at `.claude/skills/maestro/SKILL.md.bak` (see `.backup`) and the current template replaced it. **Say so explicitly** and offer to re-apply any custom prose from the `.bak` outside the managed regions before deleting it.

2. **Run the renderer** from the project root:

   ```bash
   node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-render-orchestrator.cjs"
   ```

   This rewrites the `<!-- Maestro:HANDOFFS -->` table in `.claude/skills/maestro/SKILL.md` from each workflow's derived success path. Run it **after** step 1 — a `migrated` sync leaves the table at its placeholder, and this restores it.

3. **If step 2 reports `maestro/SKILL.md not found`**, the orchestrator hasn't been installed yet. Run `/maestro-install` instead.

4. **Report** the result to the user: confirm the scripts were refreshed, state what happened to the skill body (step 1's `orchestratorSkill.action`), and summarise the workflow → success-path rows now in the table.

## Notes

- Hook scripts (`maestro-inject-agent-context.js`, `maestro-subagent-log.js`, `maestro-session-log.js`) run from `${CLAUDE_PLUGIN_ROOT}/scripts/` and are always current — no sync needed for them.
- Project-copied scripts (`maestro-set-session-workflow.cjs`, `maestro-render-orchestrator.cjs`, `maestro-task-status.cjs`, `bash-validation.sh`, `lib/maestro-session.cjs`, `lib/maestro-tasks.cjs`, `lib/maestro-skill-regions.cjs`) are what step 1 refreshes.
- The orchestrator's **managed regions** come from the plugin template; the region list lives in `lib/maestro-skill-regions.cjs` (`MANAGED_REGIONS`). To keep customisations across updates, put them outside the markers.
- `maestro.json` is the source of truth. The `SubagentStart` hook reads it directly at runtime, so subagent skill injection is always current even between `/maestro-update` runs — only the orchestrator's handoff table needs the renderer re-run.
