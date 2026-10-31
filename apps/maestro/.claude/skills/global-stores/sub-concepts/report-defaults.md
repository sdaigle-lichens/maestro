# Report defaults

The global fallback tier for a per-agent "Mandatory Output Format" report, in
`~/.claude/maestro-report-defaults.sqlite`.

**Two tables:** `agent_reports` (agent_name → report_id) and `reports` (report_id → content +
version). The indirection through `report_id`, rather than keying content directly by agent name,
is what would let a future global-editing UI point two agents at one shared report without a schema
change — nothing in this slice creates that sharing itself.

Resolution order at dispatch: the project's `reports` slice → this global tier → no report at all.

**There is no seed tier under it, which is why `035` was a real bug rather than a degradation.** The
`SubagentStart` hook `require`s `lib/maestro-report-defaults.cjs` inside a try/catch (for a `node`
older than 22.5), and until `035` that lib was not copied into `.claude/scripts/lib/` — so a project
running its own copy of the hook fell straight past the middle tier to *nothing*, silently, for any
agent whose report exists only globally (one used outside Maestro's routing, since the sync
materializes a project file only for agents in `agents_available`). Handoffs survived the same gap
because they have a seed; reports do not. The lib is now a `STATIC_ASSET` in both install
implementations.
Install/update syncs a project's `.claude/reports/*.md` _from_ here, and `MaestroReportEntry.syncedFrom`
is how the staleness check tells a materialized copy from a hand-authored override.

**`priorReportSeeds(agentName)` (`059`) exports what was a private constant**, so `report-sync.ts`
and the terminal path's `maestro-report-defaults.cjs` bundle can both build the `matchesKnownVersion`
set `decideSync`'s `adopt` verdict needs — see `agent-fork-sync`'s shared-decision sub-concept. It is
`report-defaults.ts`'s equivalent of `handoff-seeds.ts`'s already-exported `PRIOR_SEEDS`, kept private
until now only because nothing needed it outside this module.

**A body leaves `PRIOR_SEEDS` while it is current and returns when superseded.** A prior equal to
the current body would be "refreshed" (version bumped) on every open. `090` made the scribe's V1
body current again, so it was dropped from `PRIOR_SEEDS.scribe`; `114` appended
`SCRIBE_ENDING_NOTE` (the `SKILL_GAPS_HANDLED:`/`HANDOFF:` ending rule) to it, so `SCRIBE_REPORT_V1`
is a prior again beside `SCRIBE_REPORT_V2`. `144` scoped the gap note's path to
`.claude/channels/<scope>/scribe/<agent>.1.md` (the agent reads `<scope>` from its injected context),
so each backend-like/test body before it is a v5 prior (`backendLikeV5`, `TEST_REPORT_V5`) and the
scribe's unscoped ending note is `SCRIBE_REPORT_V3` (`scribeEndingNote(gapsDir)` builds both).

Files: `src/core/report-defaults.ts`, `src/core/report-resolution.ts`, `src/core/report-sync.ts`,
`src/core/reports.ts`.
