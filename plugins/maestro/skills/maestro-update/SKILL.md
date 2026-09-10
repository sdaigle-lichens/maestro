---
name: maestro-update
description: "Refreshes the Maestro runtime scripts from the plugin, re-renders the Maestro orchestrator skill (.claude/skills/maestro/SKILL.md) from .claude/maestro.json, and reviews any agent this project forked from a global template that has since fallen behind it. Use after hand-editing maestro.json, when the orchestrator's handoff table looks out of date, to pull script updates from a newer plugin version, or to see which forked agents differ from their template. To edit the config visually, open the project in the Maestro desktop app (apps/maestro) instead — a save there renders the orchestrator itself."
---

# Maestro Update

Refresh the project's Maestro runtime scripts **and the orchestrator skill body** from the plugin, then regenerate the rendered region of the orchestrator from the current `.claude/maestro.json`.

## Workflow

1. **Refresh the runtime scripts and the skill body** by re-running the installer (idempotent — skips settings and gitignore if already present):

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-install.js" "${CLAUDE_PROJECT_DIR:-.}"
   ```

   This overwrites `.claude/scripts/{maestro-set-session-workflow.cjs,maestro-render-orchestrator.cjs,maestro-task-status.cjs,maestro-check-runtime.cjs,maestro-agent-forks.cjs,maestro-step1-gates.cjs,maestro-step0.cjs,bash-validation.sh,lib/maestro-session.cjs,lib/maestro-tasks.cjs,lib/maestro-skill-regions.cjs,lib/maestro-agent-sync.cjs}` with the current plugin versions, so any fixes or new validation steps in a newer plugin release are picked up immediately. It also stamps the plugin's current `plugin.json` version into `.claude/maestro.json`'s `runtimeVersion` field — the same field the Step 0 readiness check reads (via `maestro-check-runtime.cjs`, run by the `maestro-step0` hook) to decide whether this refresh needs to run at all. When that check reports `"action":"update"` — for a version mismatch, or because the handoff table no longer matches `maestro.json` — the hook tells the orchestrator to invoke **this skill** rather than repeating the two commands inline, so this file is the single place the refresh procedure is written down and the `migrated` case below gets handled there too.

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

3. **Review any forked agent that has fallen behind its template.** A fork is a project-local copy
   of a `user`- or plugin-tier agent (`/agents` → "Fork into this project"), and a copy goes stale:
   the plugin ships a better reviewer and every project that forked it keeps running the old one.

   ```bash
   node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-agent-forks.cjs" list
   ```

   `list` **writes nothing**. It reports one line per forked agent and names the ones that differ
   from their template. For each named agent, show the user what is actually at stake and let them
   decide — never decide for them:

   ```bash
   node "${CLAUDE_PROJECT_DIR:-.}/.claude/scripts/maestro-agent-forks.cjs" diff <agent>
   ```

   That prints the fork's own description beside the template's (the two drift, because a fork
   syncs its **body** while its description stays the user's) and then the body diff — exactly what
   taking the update would change. Then apply their answer, one agent at a time:

   - `update <agent>` — take the template's new body, keep this fork's own name and description.
   - `keep <agent>` — change nothing, and don't ask again until the template moves on.
   - `detach <agent>` — drop the provenance record. The file stays exactly where it is; Maestro
     simply stops tracking it, and it is the project's own agent from then on.

   Two things the verdicts mean that are worth repeating back to the user:

   - **"you edited its body"** — the fork is never overwritten automatically. `update` on one of
     these discards those edits, so say what the diff shows before running it.
   - **"in step"** on a plugin agent whose files you know changed — a plugin's files come from a
     per-VERSION marketplace cache that only re-pulls when `plugin.json`'s `version` changes, so a
     plugin edit shipped without a version bump genuinely has not reached this machine. *No update
     available* is the correct answer, not a missed one. (See the `updating-maestro` skill.)

   The desktop app's `/agents` page runs the same code over the same files and reaches the same
   verdict, so nothing here can disagree with what the app shows.

4. **If step 2 reports `maestro/SKILL.md not found`**, the orchestrator hasn't been installed yet. Run `/maestro-install` instead.

5. **Report** the result to the user: confirm the scripts were refreshed, state what happened to the skill body (step 1's `orchestratorSkill.action`), summarise the workflow → success-path rows now in the table, and say what was decided for each forked agent (or that none had diverged).

## Notes

- Hook scripts (`maestro-inject-agent-context.js`, `maestro-subagent-log.js`, `maestro-session-log.js`) run from `${CLAUDE_PLUGIN_ROOT}/scripts/` and are always current — no sync needed for them.
- Project-copied scripts (`maestro-set-session-workflow.cjs`, `maestro-render-orchestrator.cjs`, `maestro-task-status.cjs`, `maestro-check-runtime.cjs`, `maestro-agent-forks.cjs`, `maestro-step1-gates.cjs`, `maestro-step0.cjs`, `bash-validation.sh`, `lib/maestro-session.cjs`, `lib/maestro-tasks.cjs`, `lib/maestro-skill-regions.cjs`, `lib/maestro-agent-sync.cjs`) are what step 1 refreshes.
- The orchestrator's **managed regions** come from the plugin template; the region list lives in `lib/maestro-skill-regions.cjs` (`MANAGED_REGIONS`). To keep customisations across updates, put them outside the markers.
- **Frontmatter is outside the managed regions, and an update never rewrites it.** The skill's whole body is copied from the template only when `.claude/skills/maestro/SKILL.md` is ABSENT; after that only the managed regions are re-synced. So a project installed before the plugin added a frontmatter field keeps the old frontmatter forever. That matters as of `0.4.1`, whose Step 1 needs an `allowed-tools:` grant for `maestro-step1-gates.cjs` — without it the injected command's permission check aborts the invocation before the model sees the skill. If `/maestro` fails to start on a long-installed project, compare its frontmatter against the plugin's `templates/maestro/SKILL.md`; the fix is to delete that one file (or run `/maestro-uninstall --purge`) and re-install, which is also the only thing that re-copies it.
- `maestro.json` is the source of truth. The `SubagentStart` hook reads it directly at runtime, so subagent skill injection is always current even between `/maestro-update` runs — only the orchestrator's handoff table needs the renderer re-run.
