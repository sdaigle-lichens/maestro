---
name: maestro-update
description: "Refreshes the Maestro runtime scripts from the plugin, re-renders the Maestro orchestrator skill (.claude/skills/maestro/SKILL.md) from .claude/maestro.json, and reviews any agent this project forked from a global template that has since fallen behind it. Use after hand-editing maestro.json, when the orchestrator's handoff table looks out of date, to pull script updates from a newer plugin version, or to see which forked agents differ from their template. To edit the config visually, open the project in the Maestro desktop app (apps/maestro) instead — a save there renders the orchestrator itself."
---

# Maestro Update

The Step 0 readiness hook sends the orchestrator here when it reports `"action":"update"` (a
version mismatch, or a handoff table out of step with `maestro.json`), so this file is the single
place the refresh procedure is written down.

## Workflow

1. **Refresh the runtime scripts and the orchestrator skill body** by re-running the installer
   (idempotent — skips settings and gitignore if already present):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-install.js" "${CLAUDE_PROJECT_DIR:-.}"
   ```

   This overwrites the project-copied scripts in `.claude/scripts/` with the plugin's, and stamps
   the plugin's `plugin.json` version into `maestro.json`'s `runtimeVersion` — the field the Step 0
   check compares against.

   It also rewrites the plugin-owned regions of `.claude/skills/maestro/SKILL.md` (the list is
   `MANAGED_REGIONS` in `lib/maestro-skill-regions.cjs`) from `templates/maestro/SKILL.md`. Content
   **outside** those markers is the user's and is never touched; the rendered
   `<!-- Maestro:HANDOFFS -->` table is carried across.

   Report `orchestratorSkill.action` from the JSON summary:
   - `synced` — regions refreshed (`.regions` lists which). Mention if the steps changed.
   - `unchanged` — the body was already current.
   - `installed` — no skill was there; the template was written fresh.
   - `migrated` — the install predates the markers. The old file is at `.backup`
     (`.claude/skills/maestro/SKILL.md.bak`) and the template replaced it. **Say so explicitly** and
     offer to re-apply any custom prose from the `.bak` outside the managed regions before deleting it.

2. **Run the renderer**, after step 1 — a `migrated` sync leaves the handoff table at its
   placeholder, and this restores it from each workflow's derived success path:

   ```bash
   node .claude/scripts/maestro-render-orchestrator.cjs
   ```

   If it reports `maestro/SKILL.md not found`, the orchestrator was never installed. Stop and ask
   the user to run `/maestro-install` — it is user-only, so you can't invoke it yourself.

3. **List forked agents that have fallen behind their template.** `list` writes nothing; it reports
   one line per forked agent and names the ones that differ:

   ```bash
   node .claude/scripts/maestro-agent-forks.cjs list
   ```

   If it names any, see `references/forked-agents.md` for showing the diff and applying the user's
   `update` / `keep` / `detach` decision.

4. **Report**: scripts refreshed, what happened to the skill body (`orchestratorSkill.action`), the
   workflow → success-path rows now in the table, and the decision for each forked agent (or that
   none had diverged).

## Notes

- Run each command exactly as written, one per call: sandbox exclude rules match the command text.
- An `EPERM` on `.claude/skills/maestro/SKILL.md` is the sandbox. Don't retry; give the user the
  exclude rules `node *maestro-install.js*` and `node *maestro-render-orchestrator.cjs*` (or a `!`
  run of the failed command). Never edit sandbox settings yourself.
- `maestro.json` is the source of truth. The `SubagentStart` hook reads it at runtime, so subagent
  skill injection is current even between updates — only the handoff table needs re-rendering.
- If `/maestro` fails to start on a long-installed project, the cause is usually stale
  orchestrator frontmatter, which an update never rewrites — see `references/frontmatter-trap.md`.
