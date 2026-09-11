// Bundle entry for plugins/maestro/scripts/lib/maestro-workflow-spec.cjs.
//
// Backs the `maestro-workflow-spec.cjs` CLI the `create-workflow` and `update-workflow` skills
// invoke — the only part of that mechanism that touches the filesystem. `workflow-spec.ts` is pure
// (no fs, no node:sqlite, no node built-in of any kind), which is what makes it bundleable for a
// script that runs under bare `node` in a project with no node_modules.

export { applyWorkflowSpec, workflowToSpec } from "../workflow-spec.js";
