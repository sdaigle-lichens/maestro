# Parity tests

`test/core/parity.test.ts` and `test/core/avatar-parity.test.ts` are **differential** tests: the
ported TypeScript must behave identically to the hand-written CJS it replaced.

The baseline is a **snapshot** under `test/fixtures/legacy/`, not the live
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

Note what these tests do **not** cover: whether the committed `.cjs` files are up to date with
`src/core`. Nothing enforces that — it is the `git diff` habit described in the parent skill.
