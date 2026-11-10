// Deferred judgement of an agent's interim stops (`160`). Pure and `fs`-free: it rides in the
// maestro-session bundle, and every caller passes the session state's `pending_interim` map in.
//
// A workflow agent that stops with no hand-back may be mid-run (waiting on background work, to be
// resumed) or finished in plain text. The SubagentStop input cannot tell them apart, so the stop is
// logged `interim: true` with no issue and recorded here instead. What settles it:
//
//   - the agent is resumed (its next SubagentStart)          -> cleared, the later stop is judged;
//   - the agent's later stop carries a judged hand-back        -> cleared by that stop;
//   - another agent is dispatched, or `handoff-issues` has
//     shown the marker once already, with no resume           -> promoted to a `missing` issue.
//
// `169`: session state forgets a settlement once `handoff-issues` prints it, so every marker removed
// by `settleInterimStops` (promoted to missing, or settled by a late hand-back) is also returned in
// `settled`, and the caller appends one `interim_settled` line per settlement to the session log
// (`interimSettleEntry`). An interim stop logged since then carries `settles_in_log: true`, telling
// a reader that no such line yet means "not settled yet", never "missing".

import { checkHandoff, type HandoffIssue } from "./handoff-check.js";
import { lastHandoffLabel } from "./handoff-label.js";
import type { HandoffIssueRecord, PendingInterimStop } from "./types.js";

type Pending = Record<string, PendingInterimStop> | undefined;

/**
 * A hand-back that reached the transcript after the stop, already judged by the caller exactly as an
 * on-time one is (HANDOFF line, route, payload): `issue` is null when it is valid. `message` is the
 * hand-back's text, read for its HANDOFF label in the settle record (`169`).
 */
export interface LandedHandback {
  issue: HandoffIssue | null;
  message?: string | null;
}

/**
 * How one pending interim stop was settled (`169`): `missing` when it was moved on from or already
 * seen with no hand-back, `late_handback` when a hand-back reached the transcript after the stop
 * (valid when `issue` is null). The caller writes one log record per settlement
 * (`interimSettleEntry`), so the session log says durably what session state forgets.
 */
export interface InterimSettlement {
  stop: PendingInterimStop;
  as: "missing" | "late_handback";
  label: string | null;
  issue: HandoffIssue | null;
}

/** Log `kind` of the settle record. */
export const INTERIM_SETTLED_KIND = "interim_settled";

/**
 * The `log.jsonl` line recording one settlement (`169`). `ts` is when it was settled, `stop_ts` when
 * the interim stop happened; `agent` + `agent_id` name the run. The post-mortem digest reads it in
 * place of inferring a missing hand-off from an interim stop with no later final stop.
 */
export function interimSettleEntry(s: InterimSettlement, nowIso: string): Record<string, unknown> {
  const what =
    s.as === "missing"
      ? "missing HANDOFF"
      : `late hand-back${s.label ? ` HANDOFF: ${s.label}` : ""}${s.issue ? ` [${s.issue.kind}]` : ""}`;
  return {
    ts: nowIso,
    origin: "main_session",
    kind: INTERIM_SETTLED_KIND,
    agent: s.stop.agent,
    agent_id: s.stop.agent_id,
    stop_ts: s.stop.ts,
    settled_as: s.as,
    label: s.label,
    ...(s.issue
      ? {
          handoff_issue: {
            kind: s.issue.kind,
            verdict: s.issue.verdict,
            label: s.issue.label,
            message: s.issue.message,
            ...(s.issue.files ? { files: s.issue.files } : {}),
          },
        }
      : {}),
    log: `interim stop settled: ${s.stop.agent} ${what}`,
  };
}

/** `pending` plus this interim stop (an agent id appears once, a repeat stop keeps the first marker's flags). */
export function recordInterimStop(
  pending: Pending,
  stop: {
    ts: string;
    agent: string;
    agent_id: string;
    transcript_path?: string;
    run_since?: number | null;
    cwd?: string;
    scope?: string;
  }
): Record<string, PendingInterimStop> {
  const map = { ...(pending ?? {}) };
  if (!stop.agent_id) return map;
  const prior = map[stop.agent_id];
  map[stop.agent_id] = {
    ...(prior?.moved_on ? { moved_on: true } : {}),
    ...(prior?.seen ? { seen: true } : {}),
    ts: stop.ts,
    agent: stop.agent,
    agent_id: stop.agent_id,
    ...(stop.cwd ? { cwd: stop.cwd } : {}),
    ...(stop.scope ? { scope: stop.scope } : {}),
    ...(stop.transcript_path ? { transcript_path: stop.transcript_path } : {}),
    ...(typeof stop.run_since === "number" ? { run_since: stop.run_since } : {}),
  };
  return map;
}

/** `pending` without `agentId`'s marker (it was resumed, or it stopped with a judged hand-back). */
export function clearInterimStop(pending: Pending, agentId: string): Record<string, PendingInterimStop> {
  const map = { ...(pending ?? {}) };
  delete map[agentId];
  return map;
}

/** A dispatch of `agentId`: its own marker clears (a resume), every other marker is marked moved on. */
export function noteDispatch(pending: Pending, agentId: string): Record<string, PendingInterimStop> {
  const map: Record<string, PendingInterimStop> = {};
  for (const [id, p] of Object.entries(pending ?? {})) {
    if (id === agentId) continue;
    map[id] = { ...p, moved_on: true };
  }
  return map;
}

/**
 * What `handoff-issues` reports: markers that were moved on from, or already seen once, become
 * `missing` issues; the rest are kept and marked seen. Returns the issues to add, the markers left,
 * and every marker settled this call (`settled`, one per removed marker, for the log record `169`).
 */
export function settleInterimStops(
  pending: Pending,
  nowIso: string,
  recheck?: (stop: PendingInterimStop) => LandedHandback | null
): { issues: HandoffIssueRecord[]; pending: Record<string, PendingInterimStop>; settled: InterimSettlement[] } {
  const issues: HandoffIssueRecord[] = [];
  const left: Record<string, PendingInterimStop> = {};
  const settled: InterimSettlement[] = [];
  for (const [id, p] of Object.entries(pending ?? {})) {
    // A hand-back that reached the transcript after the stop's bounded wait: judge that, never the stop.
    const landed = recheck ? recheck(p) : null;
    if (landed) {
      const found = landed.issue;
      settled.push({ stop: p, as: "late_handback", label: lastHandoffLabel(landed.message), issue: found });
      if (found) {
        issues.push({
          ts: nowIso,
          agent: p.agent,
          agent_id: p.agent_id,
          kind: found.kind,
          verdict: found.verdict,
          label: found.label,
          message: found.message,
          ...(found.files ? { files: found.files } : {}),
        });
      }
      continue;
    }
    if (p.moved_on || p.seen) {
      const base = checkHandoff(null)!;
      settled.push({ stop: p, as: "missing", label: null, issue: base });
      issues.push({
        ts: nowIso,
        agent: p.agent,
        agent_id: p.agent_id,
        kind: "missing",
        verdict: null,
        label: null,
        message: `${base.message} It stopped at ${p.ts} and was never resumed, so that stop was its final one.`,
      });
    } else {
      left[id] = { ...p, seen: true };
    }
  }
  return { issues, pending: left, settled };
}
