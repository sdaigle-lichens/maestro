## Changed

- `apps/maestro/src/core/skill-availability.ts`: the one shared disable decision. Settings merge user < project `settings.json` < project `settings.local.json`; `skillDisabledReason`, `isSkillListed`, `readDisableRules`. Malformed or unreadable files are skipped and the skill stays listed.
- `apps/maestro/src/core/discovery.ts`: `discoverSkills` (the single source behind /skills, the instance picker, the canvas pane, /tools, the start/end-skill picker and the /agents picker) filters through `isSkillListed`.
- `apps/maestro/src/core/skill-ref-report.ts` / `findStaleSkillRefs`, `contracts.ts`, `index.ts`: dangling-reference check flags a disabled-but-referenced skill with the new reasons `skill-disabled` and `bundled-skills-disabled`, plus a suggestion sentence.
- `apps/maestro/src/renderer/src/components/skill-ref-mark.tsx`: labels for the two new reasons.
- Tests: new `apps/maestro/test/core/skill-disable.test.ts`; `test/renderer/skill-ref-mark.test.ts` updated.
- Plugin: `plugins/maestro/scripts/lib/maestro-skill-availability.cjs` rebuilt; `plugins/maestro/.claude-plugin/plugin.json` 0.13.8 -> 0.13.9. `pnpm refresh:runtime` run by the user; parity test passes (44/44).

## Did

- @backend: shared decision, wiring of discovery and the dangling check, unit tests for the three mechanisms and precedence, lib rebuild, version bump.
- @frontend: confirmed every list reads from `discoverSkills` (no per-screen filtering, no renderer change needed), confirmed the new reasons render, ran the real-window probe.
- Orchestrator: fixed the probe fixture's `maestro.json` shape, wrote its two settings files (user-approved), ran the probe attached to a separately launched app.

## Deviations from the ticket

- **Built-in skills (criterion 2):** the app lists skills from only the project `.claude/skills`, `~/.claude/skills` and installed plugins; it has no source of Claude Code built-ins, so no list shows them. `disableBundledSkills: true` only affects a `maestro.json` reference to a built-in id (reason `bundled-skills-disabled`). The built-in id list (`CLAUDE_CODE_BUNDLED_SKILLS`) is a best guess and needs checking.
- **Flagged references, user decision:** a disabled skill named in `maestro.json` is flagged only in the dangling-reference report, not in pickers. On the canvas it also appears as a flagged `skill-undiscovered` checkbox in the referencing instance's own list. Decision requested.
- **`projectSkillsForTagging`** (`src/core/claude-preview.ts`, the update-skill-tags table) still lists disabled project skills: it must stay free of `node:child_process`, and it is a tagging job, not a picker.
- **No live refresh:** a settings-file edit does not refresh the lists until the next navigation; the dangling report refreshes via "Recheck skills".
- Version bump is a patch, per the repo rule.

## Probe (real packaged window, fixture project `maestro-142-probe`)

- /skills: enabled 2/2, disabled 0/2, `code-graph:*` 0.
- Instance picker payload (55 skills): enabled 2/2, disabled 0/2, `code-graph:*` 0.
- Canvas skills pane: enabled 2/2, disabled 0 in the list (2 flagged reference entries for `backend-1`), `code-graph:*` 0.
- Dangling report: `probe-off-one` and `probe-off-two` both `skill-disabled`. 0 console errors.
- Checks: typecheck, lint, check clean; 129 files / 2441 unit tests and parity test pass.
