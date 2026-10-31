# Parity tests

`test/core/parity.test.ts` is **differential** for its first blocks: the ported TypeScript must
behave identically to the hand-written CJS it replaced. (`avatar-parity.test.ts` is unrelated to the
plugin libs: it checks avatar part ids in `contracts.ts` against the renderer's asset manifest.)

The baseline is a **snapshot** under `test/core/fixtures/legacy/`, not the live
`plugins/maestro/scripts/lib/` files. That distinction is the point: `build-plugin-libs.mjs`
overwrites the plugin's copies with bundles generated from `src/core`, so comparing against the live
files would become tautological the moment the build runs. The snapshots are the last hand-written
versions and are the actual parity baseline.

They cover the `success-path` surface (`successPathSteps`, `nodeLabel`, `workflowNodeLabels`,
`collectAgentSkills`, `resolveSearchList`, `resolveWorkflowName`, `bareAgentName`) and the session
helpers.

## The snapshots freeze user-visible STRINGS, byte for byte

"Behaves identically" includes every message the covered functions return, not just their control
flow — and that is not obvious until it bites. `064` rewrote the warning inside `resolveSearchList`
from `(from maestro_session.json)` to name the new per-session path instead. Pure prose, no
behaviour change, **four failing parity tests**.

The correct response is to **revert the wording**, not to edit the frozen fixture. A snapshot you
update to match the code you just changed has stopped being a baseline.

The practical consequence: `success-path.ts`'s warning strings are effectively un-editable, and
`success-path.ts:49` therefore still names `maestro_session.json` — a path that has not existed
since `064`. **That is a documented wart, not something to fix in passing.** Changing it means
deciding to re-baseline the fixture deliberately, as its own piece of work.

## The blocks that are NOT differential

The same file also holds guards that compare against the *live* tree on purpose:

- **STATIC_ASSETS manifest parity** — `install.ts` and `plugins/maestro/scripts/maestro-install.js`
  must list exactly the same `src` files.
- **Generated bundle freshness (`066`)** — `buildPluginLibs(tmpDir)` output must equal every committed
  `plugins/maestro/scripts/lib/*.cjs`; a second test fails any bundle whose `// <path>` comments
  escape the checkout (`082`).
- **Mirror parity (`066`, `087`)** — `.claude/scripts/**` copies equal their plugin sources, driven by
  `runtimeAssets()` through `test/helpers/mirror-parity.ts`.

These catch a stale bundle or mirror, but only when the suite runs; they cannot see a build that is
consistently wrong (e.g. non-strict output), so the `git diff` habit in the parent skill still stands.
