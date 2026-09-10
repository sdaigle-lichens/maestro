---
name: maestro-uninstall
description: "Uninstalls the Maestro orchestrator for this project — removes every Maestro hook registered against .claude/scripts/ from .claude/settings.json and deletes the ephemeral session files (maestro_session.json, maestro_session.log.jsonl, maestro_session_tasks.json). By default keeps maestro.json and the orchestrator skill. Pass --purge to also remove the installed orchestrator skill, runtime scripts, and the maestro.json config — everything the install pipeline produced; purge additionally reports any Maestro tasks (in Claude Code's task list and in the file-based queue at .claude/maestro-tasks/), any materialized report overrides (.claude/reports/), and any materialized handoff protocols (.claude/handoffs/), and, only with explicit user permission asked separately for each, deletes them. Use when the user wants to turn off Maestro, undo /maestro-install, or uninstall the subagents workflow."
---

# Maestro Uninstall

Remove the Maestro orchestrator that `/maestro-install` installed. This is the inverse of the installer. By default it is conservative: it removes the Maestro hooks and clears ephemeral session state — your config (`maestro.json`) and the orchestrator skill are kept.

There are **three** directories that survive a purge as the user's own content, and the uninstaller treats all three the same way — opt-in, purge-only, permission-gated deletions, never automatic, and never bundled into one all-or-nothing question:

- **The file-based task queue** at `.claude/maestro-tasks/` (`NNN-*.md` prompt files + `status.json`), written by `/to-maestro-tasks`.
- **Materialized report overrides** at `.claude/reports/` — the project's tracked copies of each agent's output-format protocol.
- **Materialized handoff protocols** at `.claude/handoffs/` — the project's tracked copies of each route's `handoff_details` protocol.

There is also a separate, fourth thing that can be deleted in purge mode: **Claude Code's own task list** (`TaskList`/`TaskGet`/`TaskUpdate`, tagged with `metadata.maestro_step`) — a different system entirely, with no script flag behind it (see step 3).

The ephemeral `maestro_session_tasks.json` the script always deletes is none of these — it's only a per-session ledger of step labels. Deleting any of the three directories is a separate, opt-in step handled in purge mode (step 3 below), asked about **one directory at a time** — wanting to drop stale materialized handoffs while keeping a large task queue is the normal case, not an edge one. The script itself never deletes any of the three unless you explicitly pass the matching `--delete-*` flag on a follow-up run.

## Workflow

1. **Decide the scope.** Ask the user (or infer from their request):
   - default — remove the Maestro hooks from settings (session files cleared); `maestro.json` and the orchestrator skill are kept
   - `--purge` — also delete `.claude/skills/maestro/SKILL.md`, the copied runtime scripts (the `maestro-*.cjs` hook and helper scripts, `bash-validation.sh`, `lib/*.cjs`, and any `templates/handoffs/` protocols an install before 0.4.2 left behind — never `.claude/handoffs/`, which is the project's own), **and** the user-authored config (`.claude/maestro.json`) — everything the install pipeline produced. Use this only when the user wants Maestro fully gone. If `maestro.json` is tracked in git, the deletion will show up as a working-tree change to commit. Purge mode also makes the script *report* on the task queue and on what's materialized under `.claude/reports/` and `.claude/handoffs/` (see step 3) — it never deletes any of the three without a separate, explicitly-confirmed follow-up run.

2. **Run the uninstaller** from the project root:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-uninstall.js" "${CLAUDE_PROJECT_DIR:-.}"
   ```

   Add `--purge` as a trailing argument if the user asked to fully remove it:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-uninstall.js" "${CLAUDE_PROJECT_DIR:-.}" --purge
   ```

   It prints a JSON summary: `removedAgentSetting`, `removedHooks`, `removedSession`, `purged`, `maestroTasks`, `materializedReports`, `materializedHandoffs`, `keptConfig`. In `--purge` mode:
   - `maestroTasks` reports on the file-based queue — `{ dir, fileCount, files, hasStatusJson, deleted: false }`;
   - `materializedReports` and `materializedHandoffs` report on `.claude/reports/` and `.claude/handoffs/` — `{ dir, fileCount, files, deleted: false }` each.

   None of the three delete anything on this first pass. In default mode all three are `null`.

3. **In `--purge` mode only — ask permission for EACH of the three directories separately, then delete only the ones the user accepts.** The script never deletes any of them on the first pass; deletion is always a separate step, one question per directory, gated on the user's explicit yes. Skip a directory entirely if its `fileCount` (and, for the task queue, `hasStatusJson`) came back empty — an empty or absent directory isn't a question worth asking. Handle the ones that do have something:

   - **File-based task queue (`.claude/maestro-tasks/`).** Read `maestroTasks` from the JSON the script already printed in step 2. If nonempty, show the user `maestroTasks.files` and ask whether to delete the whole directory.
   - **Materialized report overrides (`.claude/reports/`).** Read `materializedReports`. If nonempty, show the user `materializedReports.files` and ask whether to delete the whole directory.
   - **Materialized handoff protocols (`.claude/handoffs/`).** Read `materializedHandoffs`. If nonempty, show the user `materializedHandoffs.files` and ask whether to delete the whole directory.

   Collect the answers, then re-run the script **once** with `--purge` plus one `--delete-*` flag per directory the user agreed to:

   ```bash
   node "${CLAUDE_SKILL_DIR}/../../scripts/maestro-uninstall.js" "${CLAUDE_PROJECT_DIR:-.}" --purge \
     --delete-maestro-tasks --delete-materialized-reports --delete-materialized-handoffs
   ```

   (Include only the flags the user actually agreed to — a directory left out of the follow-up run is left alone.) Each flag's directory reports `deleted: true` and appears in `purged` once removed. Do not delete these directories yourself with `Bash`/`rm` — always go through the script so the deletion stays atomic and consistent with the rest of purge.

   Separately, **Claude Code's own task list** is a different system the script cannot see or touch. Ask the user whether they also want to delete the Maestro tasks tracked there. If they decline, skip. If they agree:
     - Call `TaskList` to enumerate the tasks.
     - Identify the Maestro-created ones. Use `TaskGet` to inspect candidates: a Maestro task carries `metadata.maestro_step`. If metadata is missing (older tasks, heuristic creation), fall back to matching tasks whose subject/description names a workflow agent instance or step, and confirm the specific list with the user before deleting.
     - Delete each confirmed task with `TaskUpdate` using `status: "deleted"`.
     - Do **not** delete tasks you're unsure about — when in doubt, show the user the list and let them choose. Never delete non-Maestro tasks.

   In default (non-purge) mode, skip this entire step — deletion of any of the four (three directories plus the task list) is purge-only.

4. **Report** to the user: confirm whether the Maestro hooks were removed from `settings.json`, whether session files were cleared, and (if `--purge`) which files were deleted, and — for each of the task queue, materialized reports and materialized handoffs — whether it was deleted, kept because the user declined, or never asked about because it was empty. Also report how many tasks (if any) were removed from Claude Code's task list. Without `--purge`, note that `maestro.json` and the orchestrator skill were kept, so they can re-enable Maestro any time by re-running `/maestro-install` (or `/maestro-update` if the skill is still present). With `--purge`, note that the config is gone too — re-enabling means re-authoring it via `/maestro-install`.

## Notes

- **The desktop app does this without a session.** `apps/maestro`'s `/maestro` route (formerly `/install`) has both
  levels: **Uninstall** (hooks + session files, keeps `maestro.json`) and **Delete everything**,
  which names every file in a confirmation before deleting it. That path is `uninstallRuntime()`
  in `apps/maestro/src/core`, and it is the one to prefer — it removes files the manifest knows about
  *plus* anything an older release left in `.claude/scripts/`, and it refuses to run at all on a
  `settings.json` that doesn't parse instead of silently skipping the hook removal (which this
  script still does). This script now shares the app's reasoning for what to remove, though, not
  just its outcome: `HOOK_SCRIPT_NAMES` and the purge target list are both derived from
  `maestro-install.js`'s own manifest (required, not re-typed), the same way `uninstall.ts` derives
  them from `install.ts` — so an asset or hook added to the installer is never missed here (`060`).
  Of step 3's four things, only Claude Code's task list still needs a session to delete — the three
  directories are deleted by the script itself, the same way the desktop app would.
- Two sources register Maestro's hooks. A project installed from the **desktop app** has them in its own `.claude/settings.json`, pointing at `$CLAUDE_PROJECT_DIR/.claude/scripts/` — those are what this script removes. The **plugin's** own `hooks.json` (`SubagentStart`, `PreToolUse`, `SessionEnd`, …) lives in the plugin and fires in every project; uninstall does not (and cannot) edit it, and it already no-ops when `maestro.json` is absent.
