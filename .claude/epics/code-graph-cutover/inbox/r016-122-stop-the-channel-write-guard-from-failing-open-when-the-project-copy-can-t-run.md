# Report r016: 122-stop-the-channel-write-guard-from-failing-open-when-the-project-copy-can-t-run.md

- Task: 122-stop-the-channel-write-guard-from-failing-open-when-the-project-copy-can-t-run.md
- Written: 2026-10-23T15:51:32.288Z
- From session: maestro-08131b1b

## Outcome
Task 122 done. The plugin copy of maestro-channel-write-guard no longer stands down (projectOwnsHook removed), so it denies a reviewer Write when the project copy's script or lib/ is missing. Header documents the exemption and the Bash gap (reviewer/refactor Bash writes unconfined; post-mortem finding is the trigger for a stronger guard). Mirror refreshed, parity test passes, plugin.json 0.12.5.

## Tests
- channel-guard-install.test.ts: new "exempt from stand-down (122)" block (missing script, missing lib/, intact install, settings.local, broken settings, symlinked cwd).
- New hook-registration-parity.test.ts: hooks.json vs HOOK_REGISTRATIONS in install.ts and maestro-install.js, both directions.
- install.test.ts had a stale 121 assertion; flipped to expect deny.
- Full maestro suite 2144/2144 on second run. Mutation check (restoring the stand-down) failed 6 tests. The parity test was not mutation-checked.

## Docs
hook-arbitration.md, installing-maestro (SKILL.md, manifest.md), updating-maestro, maestro-architecture hooks.md updated; concepts stamped (installing-maestro 2.2, updating-maestro 2.2, maestro-architecture 1.27), extract/apply run, 0 unextracted.

## Findings
- Stamping hit EROFS (exit 9) on all three SKILL.md files; printed lines were applied by hand with Edit.
- Comments in apps/maestro/src/core/hook-arbitration.ts (header ~line 13) and install.ts (lines ~16, ~382) still say the plugin copy stands down for any registered hook; now slightly overbroad (guard is an exception). Left untouched.
- Parity test's "registers nothing hooks.json does not" direction could fail on a legitimate project-only hook.
- claude.test.ts "cancels a running invocation" flaked once under load; passes alone.

## Suggested ticket changes
Small follow-up: add "except the channel write guard" to the hook-arbitration.ts / install.ts comments.
