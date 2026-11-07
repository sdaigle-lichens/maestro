# Report r001: 161-keep-formatters-off-maestro-managed-files-via-maestro-install-and-maestro-update.md

- Task: 161-keep-formatters-off-maestro-managed-files-via-maestro-install-and-maestro-update.md
- Written: 2026-11-07T17:11:19.179Z
- From session: install-update-hygiene-161

## Outcome

Task 161 is done and ready for you to commit. `maestro-install.js` now appends the eight managed `.claude/` paths to an existing `.prettierignore`, `.eslintignore` or `.biomeignore`, and never creates one. `maestro-update` reports the step, prints the single warning line when the ignore file can't be edited, and adds the formatting hint when `staleCustomized` is non-empty. The plugin version is 0.13.28.

## Verification

- **Commit:** nothing is committed yet. All verification ran on the uncommitted working tree.
- **Suite:** the full suite was green at the test step: 2759/2759 tests, parity 44/44, and lint, check and typecheck clean.
- **After the test step:** one documentation row changed (the `formatterDetected` row in `references/formatter-ignore.md`). I did not re-run the suite after that edit.
- **Reviewer:** PASS.

## Findings

- The JSON summary has four fields (`formatterIgnore`, `formatterIgnoreFailed`, `formatterDetected`, `formatterIgnorePaths`), where the ticket asked for one.
- The ignore step exists only in the terminal installer. `installRuntime()` in `install.ts` has no equivalent. This is noted in `.claude/skills/installing-maestro/`.
- The `formatterDetected` row does not cover a `.ts` formatter config or a formatter wired only through CI.
- `maestro-update`'s old step 7 is now step 8, so ticket 162 will collide on step numbering. The merge plan is 161 first, then 162 rebases.

## Post-mortem

No problems to report.

## Suggested ticket changes

None.

## Open items for the user

- `pnpm refresh:runtime` was run by the user after the backend step. It was not re-run after the final doc row edit, and that edit is under `plugins/`.
- The scribe's `apply installing-maestro` stopped at a rename prompt. The user ran it afterwards, and I haven't confirmed the result.
- The `SubagentStop` hook reported no payload for the resumed backend run (`test/backend.1.md`). It was a doc-only follow-up, so no new test step was dispatched.
