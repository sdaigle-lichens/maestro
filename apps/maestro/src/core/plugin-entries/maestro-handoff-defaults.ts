// Bundle entry for plugins/maestro/scripts/lib/maestro-handoff-defaults.cjs.
//
// THE SQLITE TIER ONLY. The seeds and the route walk are deliberately NOT here — they live in
// `maestro-session.cjs`, which the SubagentStart hook requires unconditionally, so that the seed
// tier still answers when this bundle cannot be loaded at all. `node:sqlite` needs `node` >= 22.5
// and these scripts run under whatever `node` is on the session's PATH, not Electron's; every
// caller of this file wraps the `require()` in try/catch and falls through to the seed.
//
// That is the difference from `maestro-report-defaults.cjs`, whose caller degrades to "no report".
// A report degrading to nothing is tolerable; a handoff degrading to nothing would leave the
// receiving agent with an unspecified payload shape on a route the graph explicitly wires — which
// is why `033` split `handoff-seeds.ts` out of `handoff-defaults.ts` rather than shipping one
// module the way reports do.

export {
  readHandoffDefault,
  readAllHandoffDefaults,
  writeHandoffDefault,
  deleteHandoffDefault,
  DEFAULT_HANDOFF_DEFAULTS_DB_PATH,
} from "../handoff-defaults.js";
