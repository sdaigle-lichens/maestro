// Install/update's report sync step — the app-side half. Mirrored in plain JS by
// `plugins/maestro/scripts/maestro-install.js` for the terminal path (the global store is read
// through the same generated `lib/maestro-report-defaults.cjs`, wrapped in try/catch there for a
// `node` without `node:sqlite`).
//
// Walks every agent this project has actually opted into — the union of (a) an agent already
// present in the `reports` slice, and (b) an agent in `agents_available` with no `reports` entry
// yet (the "newly-seeded on first install" case: a project's own agent roster is a bounded,
// project-scoped set, not "every agent on this machine with a global default"). For each:
//
//   - no project file at the mapped id            -> materialize (copy the global default in)
//   - project file present, unmodified since sync,
//     global version advanced past `syncedFrom`    -> refresh (overwrite, bump syncedFrom)
//   - project file present, hash != syncedFrom.hash -> the user edited it: skip, flag as
//                                                       stale-but-customized
//   - a hand-authored override (no `syncedFrom`)    -> never touched
//
// Deliberately NOT a "does maestro.json exist" seed-once operation like maestro.json's own seed:
// reports keep tracking a moving global default, which is the entire reason `syncedFrom` exists.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readConfig, writeConfig } from "./config.js";
import { readAgentReportDefault, DEFAULT_REPORT_DEFAULTS_DB_PATH } from "./report-defaults.js";
import type { MaestroReportsSlice } from "./types.js";
import type { ReportSyncSummary } from "./contracts.js";

export type { ReportSyncSummary };

function reportsDir(projectRoot: string): string {
  return path.join(projectRoot, ".claude", "reports");
}

function reportFilePath(projectRoot: string, reportId: string): string {
  return path.join(reportsDir(projectRoot), `${reportId}.md`);
}

function sha256(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function writeReportFile(projectRoot: string, reportId: string, content: string): void {
  fs.mkdirSync(reportsDir(projectRoot), { recursive: true });
  fs.writeFileSync(reportFilePath(projectRoot, reportId), content);
}

/** No-op (returns all-empty) when the project has no `maestro.json` yet. */
export function syncProjectReports(projectRoot: string, dbPath: string = DEFAULT_REPORT_DEFAULTS_DB_PATH): ReportSyncSummary {
  const summary: ReportSyncSummary = { materialized: [], refreshed: [], staleCustomized: [], unchanged: [] };
  const cfg = readConfig(projectRoot);
  if (!cfg) return summary;

  const reports: MaestroReportsSlice = { ...(cfg.reports ?? {}) };
  const candidateAgents = new Set([...Object.keys(reports), ...(cfg.agents_available ?? [])]);
  let changed = false;

  for (const agentName of candidateAgents) {
    const entry = reports[agentName];

    // A hand-authored override (no syncedFrom) is the user's own content — never touched, and
    // never even compared against the global default.
    if (entry && !entry.syncedFrom) continue;

    const global = readAgentReportDefault(agentName, dbPath);
    if (!global) continue; // nothing to sync from — this agent has no global default at all

    const reportId = entry?.id ?? agentName;
    const filePath = reportFilePath(projectRoot, reportId);
    const onDisk = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;

    if (onDisk === null) {
      writeReportFile(projectRoot, reportId, global.content);
      reports[agentName] = { id: reportId, syncedFrom: { version: global.version, hash: sha256(global.content) } };
      summary.materialized.push(agentName);
      changed = true;
      continue;
    }

    // entry.syncedFrom is guaranteed set here: either entry was absent (handled above, onDisk
    // would have been null too since the file can't exist with no slice entry pointing at it —
    // unless a stray file happens to sit there, in which case treating it as unmodified-since a
    // sync that never happened is wrong, so guard explicitly) or entry.syncedFrom exists.
    if (!entry) {
      // A file already exists at the default id with no tracking entry — leave it alone; this
      // is not a case the spec describes and overwriting an unrelated file would be a surprise.
      summary.unchanged.push(agentName);
      continue;
    }

    const currentHash = sha256(onDisk);
    if (currentHash !== entry.syncedFrom!.hash) {
      summary.staleCustomized.push(agentName);
      continue;
    }

    if (global.version > entry.syncedFrom!.version) {
      writeReportFile(projectRoot, reportId, global.content);
      reports[agentName] = { id: reportId, syncedFrom: { version: global.version, hash: sha256(global.content) } };
      summary.refreshed.push(agentName);
      changed = true;
      continue;
    }

    summary.unchanged.push(agentName);
  }

  if (changed) writeConfig(projectRoot, { ...cfg, reports });
  return summary;
}
