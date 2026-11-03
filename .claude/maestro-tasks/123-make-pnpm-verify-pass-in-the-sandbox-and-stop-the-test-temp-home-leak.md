# Make pnpm verify pass in the sandbox and stop the test temp-home leak

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Two findings from the second merge review (/tmp/claude-1000/merge-review-delta.md).

1. `pnpm verify` fails in the sandbox at the turbo test step (ENOENT mkdir `/tmp/<rand>/ssr`). code-graph fixed the same failure in its commit 5b19298 by adding `"globalPassThroughEnv": ["TMPDIR"]` to `turbo.json`. Under strict env mode turbo drops TMPDIR, Node falls back to `/tmp`, and the sandbox can't write there. Add the same entry to this repo's root `turbo.json`, keeping any existing passthrough entries, and confirm `pnpm verify` passes in the sandbox without `--env-mode=loose`.

2. `apps/maestro/test/setup-isolation.ts` removes its temp HOME on `process.on("exit")`, which vitest workers don't reliably fire. Every test file leaves a `maestro-test-home-*` dir behind, and there are about 849 in `/tmp/claude-1000`. Move the cleanup to something vitest guarantees: an `afterAll` in the setup file, or a `globalSetup` teardown. Check that running two test files leaves no new `maestro-test-home-*` dirs. Don't delete the existing leaked dirs; report the count, and the user will decide.

3. Leftover from task 122 (report r016). Since 122, the plugin copy of `maestro-channel-write-guard` never stands down. But the comments in `apps/maestro/src/core/hook-arbitration.ts` (header, around line 13) and `apps/maestro/src/core/install.ts` (around lines 16 and 382) still say the plugin copy stands down for every project-registered hook. Add the exception (the channel write guard, `122`, and why) to each. `hook-arbitration.ts` feeds a plugin bundle, so run `pnpm --filter maestro build:plugin-libs` afterwards. If any `plugins/maestro/scripts/lib/*.cjs` changes, refresh its `.claude/scripts/lib/` mirror, run the parity test, and bump the maestro plugin patch (0.12.5 -> 0.12.6). If no bundle changes, say so and don't bump.

## Acceptance criteria

- [ ] turbo.json passes TMPDIR through, and `pnpm verify` passes in the sandbox with no env-mode override.
- [ ] After `pnpm --filter maestro exec vitest run` on two test files, no new maestro-test-home-* dir remains in $TMPDIR.
- [ ] The report gives the leaked-dir count found and does not delete them.
- [ ] The hook-arbitration.ts and install.ts comments name the channel write guard as the stand-down exception. Any bundle change is mirrored and parity-tested, with a patch bump.

## Blocked by

None — can start immediately
