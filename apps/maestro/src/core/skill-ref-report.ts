// The IPC-facing answer to "which skills does this project's config name that don't resolve?".
//
// Detection is `findStaleSkillRefs` (skill-availability.ts, shared with the plugin's
// `maestro-stale-refs.cjs`); this only reads the project's on-disk maestro.json and shapes the
// result. Deliberately NOT part of the plugin-entries graph. Advisory: never throws, and a
// missing or corrupt config is simply an empty report.

import { readConfig } from "./config.js";
import { findStaleSkillRefs } from "./skill-availability.js";
import type { StaleRefsReport } from "./skill-availability.js";

export function skillRefReport(projectRoot: string, homeDir?: string): StaleRefsReport {
  const empty: StaleRefsReport = { dangling: [], suggestions: [] };
  if (!projectRoot) return empty;
  try {
    const cfg = readConfig(projectRoot);
    return cfg ? findStaleSkillRefs(projectRoot, cfg, homeDir) : empty;
  } catch {
    return empty;
  }
}
