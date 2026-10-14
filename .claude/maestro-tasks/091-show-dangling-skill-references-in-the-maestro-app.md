# Show dangling skill references in the Maestro app

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Since skills can now come from an opt-in plugin (`concept-skills:*`), a project's Maestro config can name a skill that no longer resolves: the plugin is not installed, installed but not enabled for the project, enabled but missing that skill, or a bare id that nothing installed ships. The core already detects these (`findStaleSkillRefs` in the skill-availability module, which `/maestro-update` runs through `maestro-stale-refs.cjs`), returning each dangling id with its reason and every place it is referenced, plus one-sentence suggestions — including the hint to install the concept-skills plugin when the project keeps a `concept-skills.json` but the plugin is not enabled. The desktop app does not surface any of it yet.

Expose that report to the renderer and show it where each reference is edited, so the user can fix it in place: an instance's loaded or referenced skills and skill nodes in the workflow view, the shared skills list there, and the start/end skill pickers on the `/maestro` page. A dangling reference is visibly marked with its reason; the project-level suggestions (including the concept-skills plugin hint) appear once in a non-blocking notice. The report is advisory — it never blocks a save or removes a reference on its own — and refreshes when the config is saved, when the project switches, and when the user asks for it, so installing or enabling a plugin outside the app clears the marks without restarting.

## Acceptance criteria

- [x] A config naming an unavailable skill shows a mark with its reason (plugin not installed / not enabled / skill not in plugin / not found) at each place that reference is edited: instance skills and skill nodes in the workflow view, the shared skills list, and the start/end pickers on the /maestro page
- [x] The project-level suggestions, including the concept-skills plugin hint when concept-skills.json exists but the plugin is not enabled, appear in one non-blocking notice
- [x] Saving is never blocked and no reference is removed automatically; removing or fixing a reference clears its mark after save
- [x] The report refreshes on save, on project switch and on demand, so enabling a plugin outside the app clears the marks without restarting
- [x] The detection logic stays in core and is reached through a thin IPC adapter; core tests cover the IPC-facing shape, and the behaviour is checked in a running window
- [x] pnpm verify passes

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** The first pass shipped a notice-only Recheck, so once the report was clean there was no way to refresh on demand, and the gap went unnoticed until the running-window probe. Review and unit tests had passed it, because no test could drive a real window until the Electron chrome-sandbox setuid bit was fixed.
  **Fix:** none
- **Problem:** The chrome-sandbox setuid bit is lost again whenever Electron is re-extracted, which blocked the window check on the first attempt.
  **Fix:** none
