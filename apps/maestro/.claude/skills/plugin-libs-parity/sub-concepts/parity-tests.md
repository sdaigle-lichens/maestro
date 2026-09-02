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

Note what these tests do **not** cover: whether the committed `.cjs` files are up to date with
`src/core`. Nothing enforces that — it is the `git diff` habit described in the parent skill.
