# Hide project-disabled skills from the Maestro app's skill lists

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The Maestro desktop app lists every skill the machine and project know about, including ones the project has switched off. Make every skill list in the app (the /skills page, the instance skill picker, the workflow canvas skills pane, and any other place that offers skills to pick) leave out a skill the project has disabled. A skill counts as disabled when any of these says so: a skillOverrides entry set to "off" (project settings.json, project settings.local.json or the user's settings.json, a later file overriding an earlier one); disableBundledSkills set to true, which hides Claude Code's built-in skills; or its plugin set to false in enabledPlugins. Put the decision in the one shared place that already answers which skills a project can invoke (the skill availability module), so every list and the dangling-reference check agree, rather than filtering separately per screen. This is source code and tests, not docs only: include the new tests, the rebuild of the generated plugin libraries and the plugin version bump and mirror refresh the repo requires if the shared module is bundled for the plugin, and a check in the real app window against a fixture project that has some skills switched off. A skill that is already referenced in maestro.json but is disabled should still show up as a flagged reference (not silently vanish from the config), so the user can see and fix it.

## Acceptance criteria

- [ ] With a skill set to "off" in skillOverrides in the project's settings, it no longer appears on the /skills page, in the instance skill picker or in the workflow canvas skills pane.
- [ ] With disableBundledSkills true, Claude Code's built-in skills are not listed; with it unset or false they are.
- [ ] Skills from a plugin set to false in enabledPlugins are not listed; a project-level false overrides a user-level true, and the reverse.
- [ ] The same skill set is used by every list and by the dangling-reference check, from one shared function, covered by unit tests for each of the three disable mechanisms and for settings-file precedence.
- [ ] A disabled skill already named in maestro.json is reported as unavailable with a clear reason instead of being dropped from the config.
- [ ] Unreadable or malformed settings files never throw and fall back to listing the skill.
- [ ] pnpm verify passes, the parity test for the plugin libraries passes, and the maestro plugin version is bumped if anything under plugins/maestro changed.
- [ ] A probe against a fixture project with skills switched off, run in the real packaged app window, shows the disabled skills absent and the enabled ones present, reported with counts.

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** The real-window probe could not run from inside the sandbox: `withApp` launches Electron from Node, which aborts there, and the test-maestro skill still described only that and an AppArmor setup. The probe waited several turns for the user until another session added the launch-then-attach pattern to the skill.
  **Fix:** none
- **Problem:** @frontend's probe fixture had a malformed `maestro.json` (`workflow_instances` as an object, missing top-level keys), which crashed the app ("cfg.workflow_instances.map is not a function", then "reading 'includes'"). The fixture was never validated against a real config before the probe.
  **Fix:** none
- **Problem:** The fixture's settings files were blocked by the settings-file guardrail and @frontend asked without being able to get an answer, so the user saw an unexplained prompt and refused.
  **Fix:** none
- **Problem:** The plugin version was bumped once per round (0.13.8 -> 0.13.9 -> 0.13.10) instead of once per change; @reviewer failed it and a loop-back was needed to restore 0.13.9.
  **Fix:** none
- **Problem:** `CLAUDE_CODE_BUNDLED_SKILLS` was first written from memory as a guess and only corrected after the human review flagged it; the list is still documented-only because no page states the exact set.
  **Fix:** none
- **Problem:** Agents ended without writing their handoff payload (@backend twice), and a stale handoff-issues entry from an earlier FAIL reappeared after the reviewer passed.
  **Fix:** none
- **Problem:** @scribe ended `HANDOFF: partial` with no route because `code-graph extract` needs ts-morph (not installed, and its cache folder is unreadable in the sandbox); the user ran the install and the six extract/apply commands.
  **Fix:** none
