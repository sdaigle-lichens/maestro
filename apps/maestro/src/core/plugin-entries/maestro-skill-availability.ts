// Bundle entry for plugins/maestro/scripts/lib/maestro-skill-availability.cjs.
//
// `maestro-install.js` (the terminal installer) seeds a fresh config with the same optional-skill
// decision the desktop app makes, and `maestro-stale-refs.cjs` (run by /maestro-update) reports the
// skill ids an existing config references that no longer resolve. Both call the functions the app
// calls, so the two paths cannot disagree about what is available. Pure `fs`; no sqlite.

export { seedSkillsFor, findStaleSkillRefs, readSkillSources, whyUnavailable } from "../skill-availability.js";
export type { SeedSkills, StaleRefsReport } from "../skill-availability.js";
