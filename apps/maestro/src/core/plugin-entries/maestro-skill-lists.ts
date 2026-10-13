// Bundle entry for plugins/maestro/scripts/lib/maestro-skill-lists.cjs.
//
// `maestro-step1-gates.cjs` and `maestro-end-skills.cjs` (and, through the plugin's own copy of the
// former, `/to-maestro-tasks`) print the project's configured start / end skills. They resolve them
// with the SAME function the desktop app uses, so the page and the runtime cannot disagree. Pure
// logic, no fs and no node:sqlite. Copied into projects (see install.ts STATIC_ASSETS).

export { resolveSkillLists, LEGACY_CONFIDENCE_SKILL, LEGACY_DESIGN_SKILL } from "../skill-lists.js";
export type { ResolvedSkillLists } from "../skill-lists.js";
