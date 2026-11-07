## Goal

Add a read-only drift report, `maestro-workflow-drift.cjs`, that compares each project workflow with the same-named seed workflow and reports `identical`, `differs`, `missing-in-project` or `project-only`. `maestro-update` runs it and summarises it. It writes nothing and has no apply flag.

## Deviations

- **Installer wiring.** `maestro-stale-refs.cjs` is not copied by the installer (it runs from the plugin root). The task says to copy to `.claude/scripts/`, so the drift script follows `maestro-agent-forks.cjs` instead.
- **Extra libs copied.** The script requires `lib/maestro-seed.cjs` and `lib/maestro-skill-availability.cjs`, so both are added to the install manifests.
- **Referenced skills not compared.** A real install seeds referenced skills from the project's tag and skill maps, so comparing them would report every fresh project as `differs`. Only loaded skills and skill-node ids are compared. This is a partial reading of the criterion "loaded or referenced skills".
- **Sandbox allow-list unchanged.** The script is read-only and is called as `node .claude/scripts/maestro-workflow-drift.cjs .`, the same form as step 4's `list`.

## Decisions

- The seed is built with `defaultV3Config` and the project's own non-core agent nodes (from `default`, `tdd` or `Tests`, falling back to `backend`), so node ids line up.
- Workflows match by name, case-insensitively. Position and `label_offset` are ignored.
- Output is one JSON line plus a summary and always exits 0. A missing, corrupt or non-v3 config gives `checked:false`.
- `maestro-update/SKILL.md` gets a new step 7, and the old Report step becomes step 8. There is also a `references/workflow-drift.md`.
- `plugin.json` bumped by one patch. 161 lands first with 0.13.28 and a step 7, so this is to be rebased to step 8 and 0.13.29 after 161 merges.

## Touches

- `plugins/maestro/scripts/maestro-workflow-drift.cjs` (new)
- `plugins/maestro/scripts/maestro-install.js` and `apps/maestro/src/core/install.ts` (manifests)
- `plugins/maestro/skills/maestro-update/SKILL.md` and `references/workflow-drift.md`
- `plugins/maestro/.claude-plugin/plugin.json`
- `apps/maestro/test/core/workflow-drift-script.test.ts` (new, 10 tests)

## Sibling impact

- Task 161 also edits `maestro-update/SKILL.md` (new step 7) and `plugin.json` (0.13.28), and merges first. Expect a renumber to step 8 and a bump to 0.13.29 on rebase.
- The install manifests are shared with any task that adds a runtime asset.

## Questions

- Is leaving referenced skills out of the comparison acceptable, or should the criterion be met in full?
- Is wiring the script through the installer (unlike `stale-refs`) the intended direction? Manager: yes.

## Manager note (escalation)

Direction is on course, but dropping referenced skills from criterion 3 is a scope change the manager will not decide. Options: (a) accept the partial criterion and document the omission in `references/workflow-drift.md`; (b) require referenced skills to be compared in a way that does not report a fresh install as drift. On rebase: the drift step becomes step 8, Report becomes step 9, version 0.13.29.

## Changed

Files and areas as listed under Touches.

## Did

- @backend: built the script, manifests, skill step and reference doc, 10 tests, version bump.

## Verified

Not yet verified. The full suite is not green: `pnpm --filter maestro test` failed and the parity test fails until `! pnpm refresh:runtime` is run. This review decides direction only, so this is not an approval of the work. @test and @reviewer still run after it.
