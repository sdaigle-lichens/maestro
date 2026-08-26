// The /agents page's data access: resolve what's in effect for an agent, and save a project
// override. Thin — the actual decision is `report-resolution.ts`'s pure `resolveReport`; this
// module is only the `fs` + config plumbing around it, exactly as `config.ts` is to `save.ts`.

import fs from "node:fs";
import path from "node:path";
import { readConfig, writeConfig, blankConfig } from "./config.js";
import { readAgentReportDefault, DEFAULT_REPORT_DEFAULTS_DB_PATH } from "./report-defaults.js";
import { resolveReport } from "./report-resolution.js";
import type { ResolvedReport } from "./contracts.js";

export type { ResolvedReport };

function reportFilePath(projectRoot: string, reportId: string): string {
  return path.join(projectRoot, ".claude", "reports", `${reportId}.md`);
}

function readProjectReportFile(projectRoot: string, reportId: string): string | null {
  try {
    const body = fs.readFileSync(reportFilePath(projectRoot, reportId), "utf8");
    return body.trim().length > 0 ? body : null;
  } catch {
    return null;
  }
}

/** What's in effect for `agentName` right now — project override, else global default, else none. */
export function getResolvedReport(
  projectRoot: string,
  agentName: string,
  dbPath: string = DEFAULT_REPORT_DEFAULTS_DB_PATH
): ResolvedReport {
  // "" means no project is open — there is no project tier to consult, only the global one.
  const cfg = projectRoot ? readConfig(projectRoot) : null;
  const entry = cfg?.reports?.[agentName];
  const projectContent = entry ? readProjectReportFile(projectRoot, entry.id) : null;
  const global = readAgentReportDefault(agentName, dbPath);
  const resolved = resolveReport(agentName, cfg?.reports, projectContent, global);
  return { source: resolved.source, content: resolved.content ?? "" };
}

/**
 * Save semantics: "if you touch it, it becomes this project's override." Always writes a PROJECT
 * override keyed by the agent's OWN name — never whatever id it may have inherited from the global
 * tier — and drops `syncedFrom`: a hand-authored save is no longer tracking a moving global
 * default, it IS the project's answer now.
 */
export function saveProjectReportOverride(projectRoot: string, agentName: string, content: string): ResolvedReport {
  const dir = path.join(projectRoot, ".claude", "reports");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(reportFilePath(projectRoot, agentName), content);

  const cfg = readConfig(projectRoot) ?? blankConfig();
  const reports = { ...(cfg.reports ?? {}), [agentName]: { id: agentName } };
  writeConfig(projectRoot, { ...cfg, reports });

  return { source: "project", content };
}
