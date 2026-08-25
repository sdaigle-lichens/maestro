# Auto-update the runtime bundle

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A project's installed runtime — the hook scripts under `.claude/scripts/`, their registration in
`.claude/settings.json`, and the orchestrator skill's managed regions — is a copy, made at
install/update time, of whatever `plugins/ai-tools-manager` currently ships. That's deliberate:
project-local copies mean a runtime update is a visible, per-project, mergeable file change rather
than every installed project silently changing the moment the plugin's version bumps. The trade-off
is that today nothing refreshes that copy except a user remembering to run `/maestro-update` or
click update in the app — so a project can sit on a stale runtime indefinitely with nothing
surfacing that.

Close that gap without giving up the pinning: stamp a `runtimeVersion` field into
`.claude/maestro.json` at install/update time, holding whatever `plugin.json`'s version was when the
runtime was last refreshed. Then check it at the two points a project is already "touched":

- **The app, on project selection.** Compare the stored `runtimeVersion` against the currently
  installed plugin's version; if they differ, re-run the existing install pipeline
  (`apps/maestro/src/core/install.ts`) in refresh mode — same idempotent operation `/maestro-update`
  already performs, just triggered automatically instead of by a click.
- **The orchestrator skill, at Step 0** (`plugins/ai-tools-manager/templates/maestro/SKILL.md`,
  `<!-- Maestro:STEPS:START -->` region — the plugin's template, not a project's customised copy).
  Before doing anything else, shell out to a small version-check script; on a mismatch, run the same
  refresh before continuing. This is the terminal-only path's equivalent of the app's project-select
  check, so a bare `claude` session picks up runtime fixes too.

Scope this to the runtime bundle only. `.claude/maestro.json`'s authored content (the workflow
graph itself) stays exactly as untouchable as it is today — "an existing config is the user's
authored graph and is never touched" — the new `runtimeVersion` field is the one machine-owned
exception to that rule, not a precedent for touching the rest of the file.

Report what happened rather than mutating silently: reuse the existing reporting shape
(`InstallReport`'s `migratedOrchestratorSkill` etc.) so the app can show a notice ("Maestro runtime
updated: hooks, orchestrator skill") and Step 0 can print an equivalent line in the terminal case.

## Acceptance criteria

- [ ] `.claude/maestro.json` gains a `runtimeVersion` field, set on every install/update to the
      plugin's current `plugin.json` version
- [ ] Selecting a project in the app compares `runtimeVersion` against the installed plugin version
      and silently no-ops when they match (no redundant file-copy work on every selection)
- [ ] Selecting a project with a stale `runtimeVersion` triggers the same refresh
      `install.ts`/`/maestro-update` already perform, and updates the stored `runtimeVersion`
      afterward
- [ ] The orchestrator skill's Step 0 performs the equivalent check before Step 1, using a script
      that degrades to a no-op if it can't run (matches the "no-op when maestro.json is absent"
      pattern the existing hook scripts already follow)
- [ ] A refresh is reported to the user (app notice; a printed line in the terminal case) rather than
      happening invisibly
- [ ] `.claude/maestro.json`'s workflow graph content is provably unchanged by a refresh — only
      `runtimeVersion` and the runtime files under `.claude/scripts/`/`.claude/settings.json`/the
      orchestrator skill's managed regions differ
- [ ] A project already on the current version sees zero file writes from either trigger point

## Blocked by

- `004-install-and-update-the-runtime-from-the-app.md`
