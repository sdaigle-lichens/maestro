# Keeping formatters off Maestro files

A formatter (prettier on save, lint-staged, CI) that rewrites a managed file under `.claude/` changes
its bytes. The installer's sync compares the file's hash with the current template and every prior
seed, so a reformatted file matches nothing and is reported `staleCustomized` forever, with no
wording difference to find. The installer therefore keeps those files out of the formatter's reach.

## What the installer does

For each of `.prettierignore`, `.eslintignore` and `.biomeignore` that **already exists** in the
project root, it appends the managed paths that no existing line covers:

```
.claude/reports/
.claude/handoffs/
.claude/maestro.json
.claude/maestro_sessions/
.claude/channels/
.claude/maestro-tasks/
.claude/maestro-metrics/
.claude/skills/maestro/
```

- It never creates an ignore file, and does nothing for a formatter the project does not use.
- A path counts as covered by an exact line (leading `/` and trailing `/` ignored) or a parent
  directory line such as `.claude` or `.claude/`. Comments and `!` lines are not coverage.
- The edit is an append: existing content and order are kept, a missing trailing newline is added,
  and a second run changes nothing.

## JSON summary fields

| Field | Meaning |
| --- | --- |
| `formatterIgnore` | `{ "<ignore file>": [lines added] }`, one key per existing ignore file; an empty list when nothing changed |
| `formatterIgnoreFailed` | `[{file, reason}]` for an existing ignore file that could not be edited (for example `EACCES`) |
| `formatterDetected` | `true` when any of these holds: one of the three ignore files exists; a config file is found at the project root (`.prettierrc` or `.prettierrc.{json,yml,yaml,js,cjs,mjs,toml}`, `prettier.config.{js,cjs,mjs}`, `biome.json`, `biome.jsonc`, `.lintstagedrc` or `.lintstagedrc.{json,js,cjs,mjs,yaml,yml}`, `lint-staged.config.{js,cjs,mjs}`); `package.json` has a `prettier`, `lint-staged` or `biome` key; or its `scripts` has `format`, `prettier` or `format:check`. A `.ts` config or a formatter wired only through CI is not detected |
| `formatterIgnorePaths` | the list above, for naming in a warning |

## Decisions

- **`--ignore-mode ignored`:** the formatter ignore file is still updated. It is a project file, not
  a Maestro file, and `.git/info/exclude` hides `.claude/` from git, not from a formatter that walks
  the disk.
- **Tracked ignore file:** it is edited anyway and the change is reported in `formatterIgnore`. The
  user sees it in `git status` and commits it. Skipping it would leave the stale-hash trap in place
  for every teammate. In `ignored` mode the edit is still a visible change to a tracked file, so
  report it plainly.
- **No ignore file, but a formatter config or `format` script:** nothing is written. `/maestro-update`
  prints one warning line naming the paths so the user can exclude them in the formatter's own
  config.
