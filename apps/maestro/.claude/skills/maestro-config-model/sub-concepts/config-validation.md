# Config validation

`src/core/config-validate.ts` reports problems a saved config can hold; it **never repairs
anything**. `validateConfig` is the aggregate seam for future checks.

## Duplicate agent types are validated, not merely prevented

Two placed instances in one workflow pointing at the same bare agent (`maestro:backend` vs
`backend`) break route dedup, skill injection and channel lanes at runtime — the canvas already
refuses to create this (`placedAgentTypes`), but a hand-edited `maestro.json` can still produce it
(`041`). `duplicateAgentTypes(cfg)` reports it per workflow.

**It cannot be imported by the renderer** — it lives outside `contracts.ts`/`text.ts`, the only two
renderer-safe modules in `src/core` — so despite being pure, it is computed in the MAIN process
(`src/main/ipc.ts`'s `workflowsData` handler, only against an on-disk config) and threaded through as
`configIssues: ConfigIssue[]` on `WorkflowsData`, never imported directly into `workflows.tsx`. The
`config-issue-banner.tsx` component renders them.

The same validator also runs from `install.ts` (reports beside the sync summaries, on
`InstallReport.configIssues`), from `applyWorkflowSpec` in `workflow-spec.ts` (reported on the result,
never refusing the write), and from the plugin's `maestro-render-orchestrator.cjs` (via the
`maestro-session` bundle, which is what `/maestro-update` runs; reports, still renders) — four call
sites sharing one validator, never auto-fixing.

See `workflow-view`'s picker/fork notes and `agents-view`/`agent-fork-sync` for the other half (a
fork is the supported way to dissolve the collision).

Files: `src/core/config-validate.ts`, `src/main/ipc.ts`, `src/core/install.ts`,
`src/core/workflow-spec.ts`, `src/renderer/src/components/config-issue-banner.tsx`.
