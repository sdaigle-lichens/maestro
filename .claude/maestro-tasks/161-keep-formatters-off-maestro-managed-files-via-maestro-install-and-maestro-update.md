# Keep formatters off Maestro-managed files via maestro-install and maestro-update

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A project's formatter (prettier, run by a save hook, lint-staged or CI) rewrites the Maestro-managed files under `.claude/`, and Maestro then reports them as customized when nothing was customized. `maestro-install` and `maestro-update` should keep those files out of the formatter's reach, and `maestro-update` should say so when they cannot.

### The symptom (seen in acces-portail-email, Maestro 0.13.27)

After `/maestro-update`, `maestro-install.js` reported 13 files as stale-customized: the `frontend` and `scribe` reports and 11 handoffs (`backend/frontend`, `reviewer/{scribe,refactor,test,backend,frontend}`, `refactor/{scribe,backend,frontend,reviewer,test}`). Diffing each against the built-in seed showed no wording difference. The only differences were what prettier does to Markdown:

- long single-line JSON arrays and objects inside the fenced blocks were rewrapped onto several lines (for example `"skillsTriage": { "loaded": [...], "skipped": [...] }` and `"violations": ["..."]`);
- a trailing newline was added, where the seed has none.

Cause: `syncProjectReports` and `syncProjectHandoffs` in `plugins/maestro/scripts/maestro-install.js` compare `sha256(file on disk)` with `entry.syncedFrom.hash` and with the hashes of the current template and every prior seed. Any byte-level change from a formatter makes the hash match nothing, so `decideSync` returns `stale-customized` and the file is never refreshed, now or in later updates. The user sees no error, and only learns of it when a template update silently skips their files.

The same risk applies to the other managed regions: `.claude/skills/maestro/SKILL.md` (the `MANAGED_REGIONS` in `lib/maestro-skill-regions.cjs`), and `.claude/maestro.json`, which the installer writes with `JSON.stringify(..., null, 2)`.

In that project it was fixed by hand: `.claude/reports/` and `.claude/handoffs/` were added to `.prettierignore`, the 13 files were overwritten with the seed text, and a second installer run reported nothing stale.

### What to change

1. `maestro-install` adds the managed paths to the project's formatter ignore file when that file already exists. Start with `.prettierignore`. Add `.eslintignore` and `.biomeignore` only if one is already present, and do nothing for a formatter the project does not use. Never create a formatter ignore file.
2. The paths, each written once and only if no existing line already covers it (exact line, or a parent directory entry):
   - `.claude/reports/`
   - `.claude/handoffs/`
   - `.claude/maestro.json`
   - `.claude/maestro_sessions/`
   - `.claude/channels/`
   - `.claude/maestro-tasks/`
   - `.claude/maestro-metrics/`
   - `.claude/skills/maestro/`
3. The edit is an append: existing content and ordering are preserved, a trailing newline is added if missing, and a second run changes nothing.
4. `--ignore-mode ignored` behavior is respected. If the installer already treats the project as ignoring Maestro files (marker in `.git/info/exclude`), it still updates the formatter ignore file when one exists, since that file is not a Maestro file. Decide and document whether the file is edited when it is tracked; the default is to edit it and report it.
5. The JSON summary gets a field such as `formatterIgnore` listing, per file, the lines added (empty when nothing changed), in the same spirit as `wroteGitExclude`.
6. `maestro-update` reports the result of that step. When a formatter config exists but its ignore file could not be edited (read-only, or a formatter other than the ones above, such as a `format` script or a lint-staged glob), it prints one line naming the paths to exclude and the stale-hash symptom, never a question.
7. When the sync reports `staleCustomized`, `maestro-update` should add one hint to its report: if the project has a formatter, the files may only differ by formatting, and the ignore step above plus re-running the installer after restoring the seed text clears it.

## Acceptance criteria

- [ ] On a project with a `.prettierignore` that lacks the paths, `maestro-install.js` appends exactly the missing ones and lists them in the JSON summary.
- [ ] Re-running it changes nothing and reports an empty list.
- [ ] A project with no `.prettierignore` (and no `.eslintignore` or `.biomeignore`) gets no new file.
- [ ] A path already covered by an existing line or a parent directory entry is not duplicated.
- [ ] A test reproduces the symptom: a managed report and handoff reformatted by prettier are reported `staleCustomized`, and after restoring the seed text and running the installer again they are not.
- [ ] `maestro-update` reports the formatter-ignore step and prints the single-line warning when the ignore file could not be edited.
- [ ] `maestro-update` adds the formatting hint when `staleCustomized` is non-empty and a formatter is present.
- [ ] The decision on `--ignore-mode ignored` and a tracked ignore file is documented in the install reference.
- [ ] The plugin version gets a bump, and the parity test and full verify pass.

## Touched surfaces

- plugins/maestro/scripts/maestro-install.js
- plugins/maestro/skills/maestro-update/SKILL.md
- plugins/maestro/skills/maestro-install/ (reference for the new step and the `--ignore-mode` decision)
- plugins/maestro/.claude-plugin/plugin.json (version)
- the installer's tests

## Notes

- Do not rely on the global template store (`~/.claude/maestro-*-defaults.sqlite`) in the new test: use the built-in seeds, as the sync already does when the store is empty.
- Keep the edit to the formatter ignore file out of any path the sandbox protects; it is an ordinary project file.
