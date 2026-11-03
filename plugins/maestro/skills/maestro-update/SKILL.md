---
name: maestro-update
description: "Refreshes the Maestro runtime scripts from the plugin, re-renders the Maestro orchestrator skill (.claude/skills/maestro/SKILL.md) from .claude/maestro.json, and reviews any agent this project forked from a global template that has since fallen behind it. Use after hand-editing maestro.json, when the orchestrator's handoff table looks out of date, to pull script updates from a newer plugin version, or to see which forked agents differ from their template. To edit the config visually, open the project in the Maestro desktop app (apps/maestro) instead — a save there renders the orchestrator itself."
---

# Maestro Update

The Step 0 readiness hook sends the orchestrator here when it reports `"action":"update"` (a
version mismatch, or a handoff table out of step with `maestro.json`), so this file is the single
place the refresh procedure is written down.

## Workflow

1. **Check the sandbox allow-list first**, which writes nothing. It comes before the installer
   because the installer's `excludedCommands` entry carries the plugin's versioned path: right
   after a plugin update the old entry is stale and the installer can fail on a sandbox write
   before the user is ever offered the fix.

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/maestro-sandbox-allow.cjs .
   ```

   It prints JSON with `sandboxEnabled`, `upToDate`, `entries` (each `kind`, `value`, `why`),
   `broadEntries`, `herdr.present`, `herdr.inUse` (with the evidence behind it: `herdr.herdrEnv`,
   `herdr.socketExists`, `herdr.settingsEntries`, and `herdr.binary`), `applyCommand` and
   `removeCommand`. Its installer entry carries the plugin's versioned path, so after every plugin
   update it is no longer up to date.

   The Bash sandbox hides the herdr binary unless `allowRead` lists it, so `command -v herdr`
   failing never means herdr is not installed. Read `herdr.inUse` (true when `HERDR_ENV=1`, the
   herdr socket exists, or a herdr entry is already in the project's sandbox settings) instead of
   re-deriving it.

   - **`sandboxEnabled` is `false`:** skip this step silently, the herdr opt-in included.
   - **herdr opt-in, whenever `herdr.inUse` is `true` or `herdr.binary` is non-null** and the
     session is interactive. `herdr.present` is `true` when every herdr entry is already in place
     (a hand-written `~` form counts): then don't ask, whatever `upToDate` says. Otherwise ask
     **one `AskUserQuestion`**:
     *"Also let /maestro-manager start worker sessions in herdr by itself? This is a sandbox
     escape: any sandboxed command can then run anything unsandboxed through `herdr pane run`.
     Without it the manager prints the `claude -n ...` commands for you to run."* Options:
     `No (Recommended)`, `Yes, add the herdr entries`. No answer, or no herdr evidence at all,
     means No. On Yes, run the dry run again with `--herdr` appended and use its output below: its
     `applyCommand` adds the herdr entries along with the rest.
   - **Not `upToDate` (in the run you are using):** show the user each entry of `entries` as
     `value` with its `why`, point to
     [`../maestro-install/references/sandbox.md`](../maestro-install/references/sandbox.md), and
     ask them to run `! <applyCommand>` themselves, the printed command verbatim. **Never run
     `--apply` yourself**: a sandboxed command can never write a settings file, and what runs
     outside the sandbox is the user's choice. If `broadEntries` is non-empty, say those wide
     patterns can be deleted by hand once the narrow entries are in. Continue with step 2 whether
     or not they run it.
   - **`herdr.unparseableSettings` is non-empty:** tell the user which settings files do not parse
     and that `allowAllUnixSockets` was read as unset from them.
   - **`upToDate` and no herdr opt-in chosen:** say nothing about it.

2. **Refresh the runtime scripts and the orchestrator skill body** by re-running the installer
   (idempotent — skips settings and gitignore if already present):

   ```bash
   node ${CLAUDE_PLUGIN_ROOT}/scripts/maestro-install.js .
   ```

   Run it in exactly this form, unquoted: the sandbox allow-list's `excludedCommands` entry
   (step 1) matches this literal command text. This overwrites the project-copied scripts in `.claude/scripts/` with the plugin's, and stamps
   the plugin's `plugin.json` version into `maestro.json`'s `runtimeVersion` — the field the Step 0
   check compares against. It also adds the `Write(/.claude/channels/**)` allow rule to
   `.claude/settings.json` when missing (`permissionsAdded` in its JSON summary), so subagents'
   channel writes are not judged by the auto-mode classifier; a second run leaves settings unchanged.

   **It refuses a downgrade.** When `maestro.json`'s `runtimeVersion` is newer than this plugin's
   version, the installer writes nothing, exits 1 and prints
   `{"ok":false,"refused":"downgrade","projectRuntimeVersion":…,"pluginVersion":…,"reason":…}`.
   Stop there and tell the user why, quoting both versions: the installed maestro plugin is older
   than this project's runtime, so the fix is to update the plugin, not this project. Re-run with
   `--allow-downgrade` appended **only if the user explicitly asks** to roll the project back to the
   plugin's version.

   It also rewrites the plugin-owned regions of `.claude/skills/maestro/SKILL.md` (the list is
   `MANAGED_REGIONS` in `lib/maestro-skill-regions.cjs`) from `templates/maestro/SKILL.md`. Content
   **outside** those markers is the user's and is never touched; the rendered
   `<!-- Maestro:HANDOFFS -->` table is carried across.

   If the JSON summary's `skillListsSeeded` is not `null`, the project's `maestro.json` predated the
   start/end skill lists and this run filled in the missing ones with the fresh-seed defaults (and
   removed a leftover `gates` key). Tell the user which (`start_skills`, `end_skills`, `gates`) and that
   they can change them on the Maestro desktop app's `/maestro` page. Lists already present are never touched.

   Report `orchestratorSkill.action` from the JSON summary:
   - `synced` — regions refreshed (`.regions` lists which). Mention if the steps changed.
   - `unchanged` — the body was already current.
   - `installed` — no skill was there; the template was written fresh.
   - `migrated` — the install predates the markers. The old file is at `.backup`
     (`.claude/skills/maestro/SKILL.md.bak`) and the template replaced it. **Say so explicitly** and
     offer to re-apply any custom prose from the `.bak` outside the managed regions before deleting it.

3. **Run the renderer**, after step 2 — a `migrated` sync leaves the handoff table at its
   placeholder, and this restores it from each workflow's derived success path:

   ```bash
   node .claude/scripts/maestro-render-orchestrator.cjs
   ```

   If it reports `maestro/SKILL.md not found`, the orchestrator was never installed. Stop and ask
   the user to run `/maestro-install` — it is user-only, so you can't invoke it yourself.

4. **List forked agents that have fallen behind their template.** `list` writes nothing; it reports
   one line per forked agent and names the ones that differ:

   ```bash
   node .claude/scripts/maestro-agent-forks.cjs list
   ```

   If it names any, see `references/forked-agents.md` for showing the diff and applying the user's
   `update` / `keep` / `detach` decision.

5. **Check for skill references that no longer resolve.** `maestro.json` names skills by id, and an id
   can dangle when the plugin that supplied it is uninstalled or not enabled for this project, or
   when the skill was deleted. This writes nothing and always exits 0:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-stale-refs.cjs" .
   ```

   It prints `{"checked", "dangling": [{"id","reason","where"}], "suggestions": [...]}`. When
   `dangling` or `suggestions` is non-empty, show each suggestion to the user as it is written. Do
   not edit `maestro.json` to remove a reference yourself: the references are the user's graph, and
   removing one is a decision for the Maestro app's workflow view. A suggestion saying `maestro.json`
   has no `start_skills` means the project was upgraded by copying files alone: tell the user to run
   `/maestro-install` (it is user-only) so the defaults are written. When both are empty, say nothing
   about it beyond "no dangling skill references".

6. **Check for herdr**, which writes nothing. Use step 1's `herdr` object (rerun the dry run if
   step 1 was skipped); a failed `command -v herdr` alone never means "not installed", because the
   sandbox hides the binary. Add at most one line to the report, never a question, and never more
   than once per run:
   - **`herdr.binary` is non-null:** say nothing about it.
   - **`herdr.binary` is null but `herdr.inUse` is `true`:** *"herdr is running, but this project's
     sandbox can't see it. To let it, run `! <applyCommand with --herdr>`"* (step 1's
     `applyCommand` with ` --herdr` appended when it lacks it). Say nothing when `herdr.present` is
     `true` (the entries are in, and the binary is simply outside this sandbox's reach).
   - **No evidence at all** (`herdr.inUse` is `false` and `herdr.binary` is null): *"herdr is not
     installed (optional: it lets /maestro-manager start epic worker sessions); see
     [`../maestro-install/references/herdr.md`](../maestro-install/references/herdr.md), whose
     commands you run yourself with `!`."*

7. **Report**: scripts refreshed, what happened to the skill body (`orchestratorSkill.action`), the
   workflow → success-path rows now in the table, and the decision for each forked agent (or that
   none had diverged), any dangling skill references step 5 found, step 6's herdr line if any, and
   step 1's `! <applyCommand>` if one is still to run.

## Notes

- Run each command exactly as written, one per call: sandbox exclude rules match the command text.
- An `EPERM` on `.claude/skills/maestro/SKILL.md` or `.claude/settings.json` is the sandbox. Don't
  retry; give the user a `!` run of the failed command, and point to
  [`../maestro-install/references/sandbox.md`](../maestro-install/references/sandbox.md) for the
  allow-list step 1 offers. Never edit sandbox settings yourself.
- `maestro.json` is the source of truth. The `SubagentStart` hook reads it at runtime, so subagent
  skill injection is current even between updates — only the handoff table needs re-rendering.
- If `/maestro` fails to start on a long-installed project, the cause is usually stale
  orchestrator frontmatter, which an update never rewrites — see `references/frontmatter-trap.md`.
