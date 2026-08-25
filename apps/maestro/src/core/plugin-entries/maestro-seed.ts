// Bundle entry for plugins/maestro/scripts/lib/maestro-seed.cjs.
//
// Why the plugin needs the seed at all: with the Docker app retired (M5), `/maestro-install` is
// the terminal-only path into a project, and it has to produce a `maestro.json` on its own —
// the desktop app is no longer guaranteed to be the next step. Hand-authoring the seeded graph
// in a SKILL.md prompt would duplicate `defaultV3Config` in prose and drift from it silently,
// so `maestro-install.js` requires this bundle instead.
//
// `seed.ts` is pure (no fs, no env), which is what makes it bundleable for a script that runs
// under bare `node` in a project with no node_modules.

export { defaultV3Config, seededAgentNames } from "../seed.js";
export type { SkillMap } from "../seed.js";
