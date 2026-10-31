## Changed

- Everything from round 1 (see `142-...review.md`), plus the two corrections below.
- `apps/maestro/src/core/skill-availability.ts`: `CLAUDE_CODE_BUNDLED_SKILLS` replaced with the documented bundled skills; a real project, user or plugin skill with a built-in's name is checked first and never flagged `bundled-skills-disabled`; a plugin-qualified id is never flagged.
- `apps/maestro/src/core/claude-preview.ts`: `projectSkillsForTagging` now filters through `isSkillListed(readDisableRules(projectRoot), name)`.
- `apps/maestro/test/core/skill-disable.test.ts`: new "built-in id collisions" block and an `update-skill-tags` preview block.
- `plugins/maestro/scripts/lib/maestro-skill-availability.cjs` rebuilt; `plugins/maestro/.claude-plugin/plugin.json` 0.13.9 -> 0.13.10; mirrors refreshed; parity passes (44/44).

## Did

- @backend: verified the built-in id list against the official commands reference (via claude-code-guide), corrected it, added collision protection and tests, routed the tagging list through the shared decision, rebuilt the lib and bumped the version.
- @frontend (cold re-run): confirmed no renderer change is needed and no list bypasses `isSkillListed`; re-ran check, lint, typecheck and 141 renderer and skill-disable tests; re-ran the real-window probe on a rebuilt app.

## Deviations from the ticket

- **Built-in skills (criterion 2), accepted in round 1:** the app lists no built-ins, so `disableBundledSkills` only affects the dangling report.
- **Built-in id list is documented-only:** no official page states the exact set `disableBundledSkills` hides. The list is the skills the commands reference marks as bundled: artifact-capabilities, artifact-diagramming, batch, claude-api, code-review, dataviz, debug, fewer-permission-prompts, loop, run, run-skill-generator, simplify, update-config, verify. Left out on purpose: `doctor` and the availability-dependent ones (design, design-sync, slides, claude-in-chrome, workflow-authoring), `/deep-research` (a workflow) and `/plugin-authoring` (a built-in plugin's skill). Consequence: a built-in missing from this list is not flagged when the setting is on, and nothing real is wrongly flagged.
- **`projectSkillsForTagging` reads user-level settings from the real `os.homedir()`:** the preview passes no home directory, so the test covers project settings only.
- **Accepted in round 1:** settings edits refresh on next navigation, not live.

## Corrections since the last round

- Built-in id list: "a wrong id could flag a real skill or miss a built-in" -> list rebuilt from documentation, collisions protected, test added for both a built-in id and a colliding real skill.
- `projectSkillsForTagging` listed disabled skills -> now filtered through the shared decision, with a test.

## Probe (real packaged window, rebuilt app, fixture `maestro-142-probe`)

- /skills: enabled 2/2, disabled 0/2. Instance picker payload (55 skills): enabled 2/2, disabled 0/2. Canvas pane list: enabled 2/2, disabled 0/2 (the two disabled names appear only as flagged references for `backend-1`). `code-graph:*` 0 everywhere.
- Dangling report: `probe-off-one` and `probe-off-two` flagged `skill-disabled`. 0 console errors.
