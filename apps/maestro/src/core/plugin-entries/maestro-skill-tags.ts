// Bundle entry for plugins/maestro/scripts/lib/maestro-skill-tags.cjs.
//
// `/maestro-install` (terminal path, no desktop app) needs to read the SAME
// `~/.claude/maestro-skill-tags.sqlite` schema the app writes, or the two would silently drift —
// exactly the reason maestro-seed.cjs/maestro-session.cjs exist. `skill-tags.ts` uses
// `node:sqlite`, which stays external (see build-plugin-libs.mjs) rather than bundled, and the
// script that requires this wraps the call in try/catch: an older system `node` (this runs under
// whatever `node` is on the session's PATH, not Electron's bundled one) degrades to the plugin's
// existing Claude-driven best-fit flow with nothing surfaced as an error.

export { readAllSkillTags, skillMapFromTags, DEFAULT_SKILL_TAGS_DB_PATH } from "../skill-tags.js";
