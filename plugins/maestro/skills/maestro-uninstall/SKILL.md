---
name: maestro-uninstall
description: "Uninstalls the Maestro orchestrator for this project — removes every Maestro hook registered against .claude/scripts/ from .claude/settings.json and deletes the ephemeral session files (maestro_session.json, maestro_session.log.jsonl, maestro_session_tasks.json). By default keeps maestro.json and the orchestrator skill. Pass --purge to also remove the installed orchestrator skill, runtime scripts, and the maestro.json config — everything the install pipeline produced; purge additionally reports any Maestro tasks (in Claude Code's task list and in the file-based queue at .claude/maestro-tasks/) and, only with explicit user permission, deletes them. Use when the user wants to turn off Maestro, undo /maestro-install, or uninstall the subagents workflow."
---

# Maestro Uninstall

Remove the Maestro orchestrator that `/maestro-install` installed. This is the inverse of the installer. By default it is conservative: it removes the Maestro hooks and clears ephemeral session state — your config (`maestro.json`) and the orchestrator skill are kept.

There are two distinct places Maestro tasks live, and the uninstaller treats both as opt-in, purge-only, permission-gated deletions — never automatic:

- **Claude Code's task list** (`TaskList`/`TaskGet`/`TaskUpdate`), tagged with `metadata.maestro_step`.
- **The file-based task queue** at `.claude/maestro-tasks/` (`NNN-*.md` prompt files + `status.json`), written by `/to-maestro-tasks`. This is user-authored, often git-tracked content, not an install artifact.

The ephemeral `maestro_session_tasks.json` the script always deletes is neither of these — it's only a per-session ledger of step labels. Deleting the real Maestro tasks (either kind) is a separate, opt-in step handled in purge mode (step 3 below), and the script itself never deletes `.claude/maestro-tasks/` unless you explicitly pass `--delete-maestro-tasks` on a follow-up run.

## Workflow

1. **Decide the scope.** Ask the user (or infer from their request):
   - default — remove the Maestro hooks from settings (session files cleared); `maestro.json` and the orchestrator skill are kept
   - `--purge` — also delete `.claude/skills/maestro/SKILL.md`, the copied runtime scripts (the `maestro-*.cjs` hook and helper scripts, `bash-validation.sh`, `lib/*.cjs`, and the installed `templates/handoffs/` protocols), **and** the user-authored config (`.claude/maestro.json`) — everything the install pipeline produced. Use this only when the user wants Maestro fully gone. If `maestro.json` is tracked in git, the deletion will show up as a working-tree change to commit. Purge mode also makes the script *report* on any Maestro tasks (see step 3) — it never deletes them without a separate, explicitly-confirmed follow-up run.

2. **Run the uninstaller** from the project root:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-uninstall.js" "${CLAUDE_PROJECT_DIR:-.}"
   ```

   Add `--purge` as a trailing argument if the user asked to fully remove it:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-uninstall.js" "${CLAUDE_PROJECT_DIR:-.}" --purge
   ```

   It prints a JSON summary: `removedAgentSetting`, `removedHooks`, `removedSession`, `purged`, `maestroTasks`, `keptConfig`. In `--purge` mode, `maestroTasks` reports on the file-based queue — `{ dir, fileCount, files, hasStatusJson, deleted: false }` — without deleting anything; in default mode it's `null`.

3. **In `--purge` mode only — ask permission, then delete, both Maestro task stores.** The script never deletes tasks on this first pass; deletion is always a separate step gated on the user's explicit yes. There are two independent stores — handle each on its own:

   - **File-based queue (`.claude/maestro-tasks/`).** Read `maestroTasks` from the JSON the script already printed in step 2 — that's the full finding, no need to re-scan the directory yourself. If `fileCount` is 0 and `hasStatusJson` is false, skip; there's nothing here. Otherwise show the user `maestroTasks.files` and ask whether to delete the whole directory. If they decline, leave it. If they agree, re-run the script with `--delete-maestro-tasks` added:

     ```bash
     node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-uninstall.js" "${CLAUDE_PROJECT_DIR:-.}" --purge --delete-maestro-tasks
     ```

     This deletes `.claude/maestro-tasks/` in one pass (`maestroTasks.deleted` will read `true`) and adds it to `purged`. Do not delete these files yourself with `Bash`/`rm` — always go through the script so the deletion stays atomic and consistent with the rest of purge.

   - **Claude Code's task list.** This is a separate system the script cannot see or touch. Ask the user whether they also want to delete the Maestro tasks tracked there. If they decline, skip. If they agree:
     - Call `TaskList` to enumerate the tasks.
     - Identify the Maestro-created ones. Use `TaskGet` to inspect candidates: a Maestro task carries `metadata.maestro_step`. If metadata is missing (older tasks, heuristic creation), fall back to matching tasks whose subject/description names a workflow agent instance or step, and confirm the specific list with the user before deleting.
     - Delete each confirmed task with `TaskUpdate` using `status: "deleted"`.
     - Do **not** delete tasks you're unsure about — when in doubt, show the user the list and let them choose. Never delete non-Maestro tasks.

   In default (non-purge) mode, skip this entire step — task deletion of either kind is purge-only.

4. **Report** to the user: confirm whether the Maestro hooks were removed from `settings.json`, whether session files were cleared, and (if `--purge`) which files were deleted, whether `.claude/maestro-tasks/` was deleted (or kept, and why), and how many tasks (if any) were removed from Claude Code's task list. Without `--purge`, note that `maestro.json` and the orchestrator skill were kept, so they can re-enable Maestro any time by re-running `/maestro-install` (or `/maestro-update` if the skill is still present). With `--purge`, note that the config is gone too — re-enabling means re-authoring it via `/maestro-install`.

## Notes

- **The desktop app does this without a session.** `apps/maestro`'s `/maestro` route (formerly `/install`) has both
  levels: **Uninstall** (hooks + session files, keeps `maestro.json`) and **Delete everything**,
  which names every file in a confirmation before deleting it. That path is `uninstallRuntime()`
  in `apps/maestro/src/core`, and it is the one to prefer — it removes files the manifest knows about
  *plus* anything an older release left in `.claude/scripts/`, and it refuses to run at all on a
  `settings.json` that doesn't parse instead of silently skipping the hook removal (which this
  script does). Of step 3's two task stores, only Claude Code's task list still needs a session
  to delete — the file-based `.claude/maestro-tasks/` queue is deleted by the script itself, the
  same way the desktop app would.
- Two sources register Maestro's hooks. A project installed from the **desktop app** has them in its own `.claude/settings.json`, pointing at `$CLAUDE_PROJECT_DIR/.claude/scripts/` — those are what this script removes. The **plugin's** own `hooks.json` (`SubagentStart`, `PreToolUse`, `SessionEnd`, …) lives in the plugin and fires in every project; uninstall does not (and cannot) edit it, and it already no-ops when `maestro.json` is absent.
