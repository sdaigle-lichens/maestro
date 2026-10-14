# Prettier-check the plugins' hand-written code in pnpm verify

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`pnpm verify` never checks the formatting of anything under `plugins/`. Two things combine: the root `.prettierignore` excludes the whole root-anchored `/plugins/` tree (its comment gives the reason as prose: SKILL.md bodies and docs that are hand-formatted), and `check` only runs per workspace package through turbo, while `plugins/` belongs to no package. So hand-written plugin code (the hook and CLI scripts under `plugins/*/scripts/`, plugin JSON manifests, hooks config) can ship unformatted; in task 096 the reviewer had to loop back on a Prettier failure in the maestro plugin's install script that verify never flagged.

Bring the plugins' hand-written code into the enforced set while keeping prose and generated code out: markdown under `plugins/` (skills, references, templates, READMEs) stays excluded for the reasons the ignore file already documents, and the generated `plugins/*/scripts/lib/` bundles stay excluded. Make the root `check` (and so `pnpm verify`) run that Prettier check over `plugins/`, and the root `format` able to fix it, without making `plugins/` a workspace package. Reformat whatever the newly checked files need in the same change; any change under a plugin bumps that plugin's version (patch), and rebuilt or reformatted scripts that are mirrored under `.claude/scripts/` stay in parity. Update the `.prettierignore` comment so the reason for excluding plugin markdown, not the whole tree, stays explicit.

## Acceptance criteria

- [ ] pnpm verify fails when a hand-written script, JSON manifest or hooks config under plugins/ is not Prettier-formatted
- [ ] Markdown under plugins/ and the generated plugins/*/scripts/lib/ bundles are still not checked
- [ ] The root format command fixes the same set it checks
- [ ] Existing plugin code is reformatted as needed, each touched plugin's version is bumped (patch), and the .claude/scripts mirrors pass the parity test
- [ ] The .prettierignore comments explain the narrower exclusion
- [ ] pnpm verify passes

## Blocked by

None — can start immediately
