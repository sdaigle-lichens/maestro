# Reports slice

`MaestroReportsSlice` is `Record<string, MaestroReportEntry>` — a per-agent report opinion for this
project. It is optional, and its absence is meaningful: no entry for an agent means the project has
no opinion, and resolution falls back to the global default tier and then to no report at all.

`MaestroReportEntry.syncedFrom` distinguishes the two ways an entry got there. Absent = a
hand-authored override (someone edited and saved from `/agents`). Present = materialized from a
global default, and the install/update staleness check reads it to decide materialize / refresh /
skip-as-customized.

Files: `src/core/types.ts`, `src/core/reports.ts`, `src/core/report-resolution.ts`,
`src/core/report-sync.ts`.
