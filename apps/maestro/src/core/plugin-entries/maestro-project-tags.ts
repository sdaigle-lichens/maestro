// Bundle entry for plugins/maestro/scripts/lib/maestro-project-tags.cjs.
//
// `/maestro-install` (terminal path, no desktop app) needs to read the SAME
// `~/.claude/maestro-project-tags.sqlite` schema the app writes, or the two would silently drift —
// exactly the reason maestro-skill-tags.cjs / maestro-report-defaults.cjs exist. `project-tags.ts`
// uses `node:sqlite`, which stays external (see build-plugin-libs.mjs) rather than bundled, and
// the script that requires this wraps the call in try/catch: an older system `node` (this runs
// under whatever `node` is on the session's PATH, not Electron's bundled one) degrades to no
// catalog read — the install proceeds with no `project_tags` recorded, same as omitting the flag.

export { readAllProjectTags, DEFAULT_PROJECT_TAGS_DB_PATH } from "../project-tags.js";
