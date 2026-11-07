## Goal

Keep formatters off Maestro-managed files: `maestro-install.js` appends the eight managed `.claude/` paths to an existing `.prettierignore`, `.eslintignore` or `.biomeignore` (never creating one). `maestro-update` reports the step, warns in one line when the ignore file can't be edited, and hints at formatting when `staleCustomized` is non-empty.

## Deviations

- The JSON summary has four fields instead of one: `formatterIgnore`, `formatterIgnoreFailed`, `formatterDetected`, `formatterIgnorePaths`. `maestro-update` needs the extra three to tell "no formatter" from "formatter, can't edit".
- `pnpm refresh:runtime` failed in the sandbox (`unable to open database file`). The tracked mirrors still need `! pnpm refresh:runtime` from the user.

## Decisions

- `--ignore-mode ignored` still edits the formatter ignore file, since `.git/info/exclude` hides `.claude/` from git but not from a formatter.
- A tracked ignore file is edited and the change is reported.
- Coverage match: exact line (with or without a leading `/` or trailing `/`) or a parent directory entry. Globs are not evaluated.
- An ignore file that can't be edited goes into `formatterIgnoreFailed` and does not fail the install.

## Touches

- `plugins/maestro/scripts/maestro-install.js` (new `ensureFormatterIgnore`)
- `plugins/maestro/skills/maestro-update/SKILL.md` (new step 7)
- `plugins/maestro/skills/maestro-install/SKILL.md` and `references/formatter-ignore.md`
- `plugins/maestro/.claude-plugin/plugin.json` (0.13.27 → 0.13.28)
- `apps/maestro/test/core/install-formatter-ignore.test.ts` (new)

## Sibling impact

Task 162 (drift report in `maestro-update`) edits the same `maestro-update` SKILL.md and may collide on step numbering. The old step 7 is now step 8.

## Questions

None.
