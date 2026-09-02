# Report defaults

The global fallback tier for a per-agent "Mandatory Output Format" report, in
`~/.claude/maestro-report-defaults.sqlite`.

**Two tables:** `agent_reports` (agent_name → report_id) and `reports` (report_id → content +
version). The indirection through `report_id`, rather than keying content directly by agent name,
is what would let a future global-editing UI point two agents at one shared report without a schema
change — nothing in this slice creates that sharing itself.

Resolution order at dispatch: the project's `reports` slice → this global tier → no report at all.
Install/update syncs a project's `.claude/reports/*.md` _from_ here, and `MaestroReportEntry.syncedFrom`
is how the staleness check tells a materialized copy from a hand-authored override.

Files: `src/core/report-defaults.ts`, `src/core/report-resolution.ts`, `src/core/report-sync.ts`,
`src/core/reports.ts`.
