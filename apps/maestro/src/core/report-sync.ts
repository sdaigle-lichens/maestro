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
//   - no entry at all, but the file's bytes match a
//     known version of the global default (`059`)   -> adopt (write current, record tracking)
//
// THOSE SIX BRANCHES NOW LIVE IN `sync-decision.ts` (`031`, `059`), not here. A forked agent is the same
// shape of thing — a project-local copy of a global template that records what it was copied from
// — and `agent-sync.ts` asks the same function the same question. This file keeps everything that
// is actually about REPORTS: which agents are candidates, where the file goes, what the hash is
// taken over, and what "the global advanced" means for an integer store version.
//
// Deliberately NOT a "does maestro.json exist" seed-once operation like maestro.json's own seed:
// reports keep tracking a moving global default, which is the entire reason `syncedFrom` exists.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { readConfig, writeConfig } from "./config.js";
import { readAgentReportDefault, priorReportSeeds, DEFAULT_REPORT_DEFAULTS_DB_PATH } from "./report-defaults.js";
import { isValidReportId } from "./report-resolution.js";
import { decideSync, type SyncTracking } from "./sync-decision.js";
import type { MaestroReportsSlice } from "./types.js";
import type { ReportSyncSummary } from "./contracts.js";

export type { ReportSyncSummary };

function reportsDir(projectRoot: string): string {
  return path.join(projectRoot, ".claude", "reports");
}

function reportFilePath(projectRoot: string, reportId: string): string {
  // `reportId` reaches here from `maestro.json`'s `reports[agent].id` or from `agents_available`,
  // both hand-editable, and is joined straight into a path. Guarded explicitly — see
  // `isValidReportId`. Callers filter their candidate list rather than relying on the throw.
  if (!isValidReportId(reportId)) throw new Error(`Invalid report id: ${String(reportId)}`);
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
export function syncProjectReports(
  projectRoot: string,
  dbPath: string = DEFAULT_REPORT_DEFAULTS_DB_PATH
): ReportSyncSummary {
  const summary: ReportSyncSummary = {
    materialized: [],
    refreshed: [],
    adopted: [],
    staleCustomized: [],
    unchanged: [],
  };
  const cfg = readConfig(projectRoot);
  if (!cfg) return summary;

  const reports: MaestroReportsSlice = { ...(cfg.reports ?? {}) };
  const candidateAgents = new Set([...Object.keys(reports), ...(cfg.agents_available ?? [])]);
  let changed = false;

  for (const agentName of candidateAgents) {
    const entry = reports[agentName];
    const reportId = entry?.id ?? agentName;
    // Both halves come from a hand-editable maestro.json and `reportId` becomes a path. A value
    // that isn't a bare name is skipped rather than thrown on: one malformed entry must not take
    // the whole install down.
    if (!isValidReportId(agentName) || !isValidReportId(reportId)) continue;
    const global = readAgentReportDefault(agentName, dbPath);

    const filePath = reportFilePath(projectRoot, reportId);
    const onDisk = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
    const localHash = onDisk === null ? null : sha256(onDisk);

    // A `reports` entry with no `syncedFrom` is a hand-authored override — the user's own content,
    // which `saveProjectReportOverride` marks by dropping the field. No entry at all is a
    // different thing: a stray file with nothing pointing at it. `decideSync` keeps them apart —
    // unless its bytes are themselves the evidence (`matchesKnownVersion` below).
    const tracking: SyncTracking = entry
      ? entry.syncedFrom
        ? { kind: "tracked", hash: entry.syncedFrom.hash }
        : { kind: "detached" }
      : { kind: "untracked" };

    // Known versions of this agent's report: the CURRENT global content, plus every body this
    // module has ever seeded for it (`refreshSupersededSeeds`'s own history). An id that was only
    // ever hand-written through `/templates` has no prior seeds, so only the current content
    // counts — which is correct: there is nothing else recorded to attribute a match to.
    const knownHashes = global ? [global.content, ...priorReportSeeds(agentName)].map(sha256) : [];

    const verdict = decideSync({
      tracking,
      localHash,
      hasTemplate: global !== null,
      // The global store's version is an integer that only ever goes up, so "advanced" is `>`.
      templateAdvanced: !!global && !!entry?.syncedFrom && global.version > entry.syncedFrom.version,
      matchesKnownVersion: localHash !== null && knownHashes.includes(localHash),
    });

    // Neither of these is a state the user needs told about: one is content they own outright, the
    // other is an agent with no global default to sync from in the first place.
    if (verdict === "detached" || verdict === "no-template") continue;

    if (verdict === "materialize" || verdict === "refresh" || verdict === "adopt") {
      // `adopt` may already match byte-for-byte (the untracked copy IS the current default) — the
      // write is then a no-op on disk, and is done anyway so this path never has to ask "did it
      // already match" a second time; what matters is that tracking always ends up recorded.
      writeReportFile(projectRoot, reportId, global!.content);
      reports[agentName] = { id: reportId, syncedFrom: { version: global!.version, hash: sha256(global!.content) } };
      summary[verdict === "materialize" ? "materialized" : verdict === "refresh" ? "refreshed" : "adopted"].push(
        agentName
      );
      changed = true;
      continue;
    }

    if (verdict === "stale-customized") {
      summary.staleCustomized.push(agentName);
      continue;
    }

    summary.unchanged.push(agentName);
  }

  if (changed) writeConfig(projectRoot, { ...cfg, reports });
  return summary;
}
