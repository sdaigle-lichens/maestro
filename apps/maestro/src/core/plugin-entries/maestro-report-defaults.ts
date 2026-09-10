// Bundle entry for plugins/maestro/scripts/lib/maestro-report-defaults.cjs.
//
// The SubagentStart hook (maestro-inject-agent-context.js) and the terminal /maestro-install
// path both need to read the SAME `~/.claude/maestro-report-defaults.sqlite` schema the app
// writes, or the two would silently drift — exactly the reason maestro-skill-tags.cjs exists.
// `report-defaults.ts` uses `node:sqlite`, which stays external (see build-plugin-libs.mjs) rather
// than bundled, and every caller of this generated file wraps the require() in try/catch: an
// older system `node` (this runs under whatever `node` is on the session's PATH, not Electron's
// bundled one) degrades to "no global default" — no report injected, no crash.

export {
  readAgentReportDefault,
  readAllAgentReportDefaults,
  priorReportSeeds,
  DEFAULT_REPORT_DEFAULTS_DB_PATH,
} from "../report-defaults.js";
