# Review 178 — manager review (direction), round 1

## Goal
A No to the herdr sandbox opt-in in `/maestro-update` sticks per project; the skip when the sandbox is disabled is verified and fixed.

## Deviations
- The decline record is a fingerprint file, not a `maestro.json` key (see Decisions).
- Could not reproduce the exact original "asked while sandbox disabled" case: the main repo's `settings.local.json` now has `enabled: true`. Two real gaps were found and fixed instead: an unset/unreadable `sandbox.enabled` (`null`) did not skip, and step 6's herdr line had no skip.
- Not covered: managed settings are not read, so a sandbox enabled only there reports `null` and the question is not asked (the user can still opt in with the printed `--herdr` command).

## Decisions
- Record lives in `.claude/maestro-sandbox/herdr-decline.json`, in a directory with a `*` `.gitignore` (same pattern as `maestro-tasks/claims/`). The opt-in is personal and per machine, so it does not travel through a committed `maestro.json`; a fresh clone asks once; install and purge-and-reinstall never touch it.
- The record holds a 16-hex sha256 fingerprint of the herdr entries the opt-in would add, so a changed entry set re-asks.
- New flags: `--decline-herdr` (writes only the record), `--ask-herdr` (ignore a decline for one run). `--apply --herdr` adds the same entries as before and deletes the record. Default answer stays No.
- The dry-run `herdr` object gains `ask`, `declined`, `declineStale`, `declineRecorded`, `fingerprint`, `declineCommand`. `herdr.ask` is true only when `sandboxEnabled === true` (unset counts as off).
- The base, non-herdr sandbox step still skips only on `sandboxEnabled === false`.

## Touches
- `plugins/maestro/scripts/maestro-sandbox-allow.cjs`
- `plugins/maestro/skills/maestro-update/SKILL.md` (step 1 and step 6)
- `apps/maestro/test/core/sandbox-allow-script.test.ts` (five new tests, one `toEqual` updated)
- `plugins/maestro/.claude-plugin/plugin.json` (0.15.14 to 0.15.15)
- `.claude/scripts/maestro-sandbox-allow.cjs` mirror is stale until `! pnpm refresh:runtime`.

## Sibling impact
Task 177 also bumps `plugin.json`: expect a version conflict at merge; take the higher patch and bump once more.

## Questions
None open. The decline directory's `.gitignore` is the one new file kind in the project's `.claude/`; say so if you would rather it be a `maestro.json` key.

## Verified
Not committed yet. Backend reported on the uncommitted worktree: `sandbox-allow-script.test.ts` and `parity.test.ts` 76 passed, `pnpm check` and `pnpm lint` pass, full non-browser vitest 3505 passed and 1 failed (`epics-cli.test.ts` "watch (176)", a 5 s timeout that passes alone). The browser project could not run (no chromium). So the full suite is **not** shown green, and @test confirms it after the commit.
