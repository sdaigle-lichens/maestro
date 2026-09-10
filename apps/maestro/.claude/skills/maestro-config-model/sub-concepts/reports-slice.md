# Reports slice

`MaestroReportsSlice` is `Record<string, MaestroReportEntry>` — a per-agent report opinion for this
project. It is optional, and its absence is meaningful: no entry for an agent means the project has
no opinion, and resolution falls back to the global default tier and then to no report at all.

`MaestroReportEntry.syncedFrom` distinguishes the two ways an entry got there. Absent = a
hand-authored override (someone edited and saved from `/agents`). Present = materialized from a
global default, and the install/update staleness check reads it to decide materialize / refresh /
skip-as-customized.

**Since `059`, "no entry" and "a file with no entry" are no longer treated the same.** A file
under `.claude/reports/` with nothing pointing at it used to sync as `unchanged` forever — the state
a `--purge` uninstall leaves behind, since purge deletes `maestro.json` (and every entry with it) but
never that directory. If the file's content matches the current global default or one of its
recorded prior versions, `decideSync` now answers `adopt` instead: the file is (re)materialized and
tracked again, on the theory that an untracked file matching a known template body is almost
certainly the project's own old copy, not a hand-authored one. See `agent-fork-sync`'s
shared-decision sub-concept.

Files: `src/core/types.ts`, `src/core/reports.ts`, `src/core/report-resolution.ts`,
`src/core/report-sync.ts`.
