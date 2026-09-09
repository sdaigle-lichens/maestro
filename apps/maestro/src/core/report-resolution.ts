// Pure resolution: which report is "in effect" for a given agent, and where it came from.
//
// Mirrors read-scope.ts/write-scope.ts's style — no `fs`, no `node:sqlite`, no import of
// report-defaults.ts's DatabaseSync. The caller (the SubagentStart hook, or the app's `/agents`
// page) has already done the actual reading — a project override's file content, and the global
// tier's row for this agent — and hands both in here so there is exactly ONE place that decides
// project-beats-global-beats-none. That is the whole point: the hook and the app UI must never be
// able to disagree about what report is in effect for an agent.
//
// Order: project override (the project's `reports` slice maps this agent AND the mapped file's
// content was read) -> global default (the agent has a row in `agent_reports`) -> none.

import type { MaestroReportsSlice } from "./types.js";

export type ReportSource = "project" | "global" | "none";

export interface ReportResolution {
  source: ReportSource;
  content: string | null;
  reportId: string | null;
}

export interface GlobalReportInput {
  reportId: string;
  content: string;
}

/**
 * `projectContent` is the content already read from `.claude/reports/<id>.md` at the id the
 * project's `reports` slice maps this agent to — null when there is no mapping, or the mapped
 * file doesn't exist / is empty. `globalDefault` is the agent's row in the global store, or null
 * when it has none.
 */
export function resolveReport(
  agentName: string,
  reportsSlice: MaestroReportsSlice | undefined,
  projectContent: string | null,
  globalDefault: GlobalReportInput | null
): ReportResolution {
  const entry = reportsSlice?.[agentName];
  if (entry && projectContent) {
    return { source: "project", content: projectContent, reportId: entry.id };
  }
  if (globalDefault) {
    return { source: "global", content: globalDefault.content, reportId: globalDefault.reportId };
  }
  return { source: "none", content: null, reportId: null };
}

/**
 * A report id becomes `.claude/reports/<id>.md`, so it is joined into a path — and it comes from
 * `maestro.json`, which is a file the user hand-edits and a foreign repo may ship. `033` added the
 * equivalent guard to `handoff-defaults.ts`/`handoff-sync.ts` and fixed this one at the same time:
 * the exposure was latent here, with no guard at all, through `entry.id` and through an agent name
 * taken straight from `agents_available`.
 *
 * Stricter than `isValidDocSlug` (which only bans separators) because a report id has never been
 * anything but a bare agent-style name — there is no legitimate value this rejects.
 */
export function isValidReportId(reportId: unknown): reportId is string {
  return typeof reportId === "string" && /^[A-Za-z0-9_-]+$/.test(reportId);
}
