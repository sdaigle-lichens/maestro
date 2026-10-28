# Report r001: 133-detect-herdr-reliably-under-the-sandbox.md

- Task: 133-detect-herdr-reliably-under-the-sandbox.md
- Written: 2026-10-28T17:02:45.002Z
- From session: manager-review-133

# Task 133 — detect herdr reliably under the sandbox

**Outcome:** done, in worktree `/home/superadmin/gits/maestro-task-133` (branch `task-133`), not yet committed or merged.

## What changed
- `maestro-sandbox-allow.cjs`: the herdr JSON now reports `socketExists`, `herdrEnv`, `settingsEntries` and `inUse`. `binary: null` alone never sets `inUse`.
- `maestro-update`, `maestro-install`, `maestro-manager` and the herdr/sandbox references read that evidence. The opt-in is offered when herdr is in use or its binary is found. "herdr is running, but this project's sandbox can't see it" comes with the `--herdr` apply command. "Not installed" is kept only when there is no evidence at all. The manager points to `/maestro-update` when `HERDR_ENV=1` and the binary is hidden.
- Plugin version 0.12.11 -> 0.12.12. No mirror needed: the script is not in `STATIC_ASSETS` and has no `.claude/scripts` copy.
- installing-maestro concept skill updated to v2.5 (stamp applied by hand).

## Verification
After `pnpm install` in the worktree: sandbox-allow test (27), parity test (43) and `pnpm verify` all pass (114 files, 2201 tests).

## Findings
- No test covers a herdr entry in the shared `settings.json`, or an unparseable settings file (both handled in code).
- The concept-skill stamp and extract/apply could not run from the worktree (the stamp command targets the main checkout and hit a read-only error). The code graph is not refreshed.
- The worktree had no `node_modules`, so @test and @reviewer worked by reading only; verification above came after the user ran the install.

## Suggested ticket changes
None.
