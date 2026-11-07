// Delivering a channel payload to a RESUMED loop-back target (`088`).
//
// A cold `Task` gets its lane through SubagentStart's `additionalContext` (`036`). A resume does
// not: Claude Code fires SubagentStart for a `SendMessage` resume and runs the hook, but never
// attaches that run's `additionalContext` to the agent (task 085's transcript has the hook's stdout
// with the reviewer's payload inlined, and no `hook_additional_context` entry after it). Before
// `088` the hook still retired the file it had "delivered", so the resumed agent found its lane
// empty and worked from the orchestrator's summary alone.
//
// So a resume's payload travels in the orchestrator's own `SendMessage`, as a file path, never as
// content (the orchestrator still never reads a payload):
//
//   1. `maestro-resume-target.cjs` prints `deliver: <file>` for every current-run file in the
//      target's lane and records them under `session.json`'s `resume_deliveries[<agent_id>]`.
//   2. SubagentStart on a resume leaves the lane alone (no inline, no retire).
//   3. The resumed agent's own SubagentStop retires exactly the recorded files, logs each as a
//      `channel_delivery` (`via: "resume"`), and drops the record. Retired only once the run that
//      was handed the path has ended.
//
// The same CLI also checks the loop-back's EXPECTED payload (`expectedLoopbackPayloads`): the
// route the latest workflow handoff took toward this target resolves a protocol, and no current-run
// file from that sender is in the lane. That is recorded as a `missing_payload` handoff issue and
// printed as `missing: <file>`, whether the target is then resumed or dispatched cold.
//
// `159`: a payload delivered to a run that was then cut off by a restart (the session resumed under
// the same id, its `.consumed/` kept by a resumable SessionEnd) is put back into the lane first
// (`restoreInterruptedDeliveries`), by this CLI and by a cold SubagentStart alike, so the re-run
// receives it and it is never reported missing.
//
// `fs`/`path` only: rides in the maestro-session bundle, which must stay free of `node:sqlite`.

import fs from "node:fs";
import path from "node:path";
import {
  channelRelPath,
  isGapReport,
  readConsumed,
  readLane,
  retire,
  unretire,
  type ChannelEntry,
} from "./handoff-channels.js";
import type { PayloadRoute } from "./handoff-payload.js";
import { SESSION_END_LOG_KIND } from "./session-paths.js";
import { bareAgentName } from "./success-path.js";
import type { HandoffIssueRecord, MaestroSession, ResumeDelivery } from "./types.js";

/**
 * The files in `receiver`'s lane IN `scope` (`144`, the resuming session's own) stamped with this
 * session's `runId` — what a resumed `receiver` must be handed. None without a `runId`: an
 * unattributable file is never presented as this run's. Another scope's lane is never read.
 */
export function pendingResumeDeliveries(
  projectDir: string,
  scope: string,
  receiver: string,
  runId: string | null | undefined
): ResumeDelivery[] {
  if (!runId) return [];
  const bare = bareAgentName(receiver);
  return readLane(projectDir, scope, bare)
    .filter((e) => e.runId === runId)
    .map((e) => ({ file: channelRelPath(scope, bare, e.fileName), sender: e.sender, run_id: runId }));
}

/** The newest entry's time in ms among `lines` that `match`, or null (no match, or no parseable `ts`). */
function latestAt(lines: unknown[], match: (e: Record<string, unknown>) => boolean): number | null {
  let latest: number | null = null;
  for (const line of lines ?? []) {
    if (!line || typeof line !== "object") continue;
    const e = line as Record<string, unknown>;
    if (typeof e.ts !== "string" || !match(e)) continue;
    const at = Date.parse(e.ts);
    if (Number.isFinite(at) && (latest === null || at > latest)) latest = at;
  }
  return latest;
}

/** When this session last ended resumably (`159`, the `session_end` log line), in ms, or null. */
export function lastResumableEndAt(lines: unknown[]): number | null {
  return latestAt(lines, (e) => e.kind === SESSION_END_LOG_KIND);
}

/**
 * When `receiver` (bare type) last finished a run this session: the newest `kind:"handoff"` entry
 * for it that carries a `HANDOFF:` label (meeting turns skipped), in ms. A run cut off by a restart
 * ends with no `HANDOFF:` line, so a stop the hook logged for it does not count as finished. Null
 * when it never finished one or no timestamp parses.
 */
export function lastFinishedRunAt(lines: unknown[], receiver: string): number | null {
  const bare = bareAgentName(receiver);
  return latestAt(
    lines,
    (e) =>
      e.kind === "handoff" &&
      e.meeting !== true &&
      typeof e.label === "string" &&
      e.label !== "" &&
      typeof e.origin === "string" &&
      bareAgentName(e.origin) === bare
  );
}

/**
 * `159`: put back into `receiver`'s lane IN `scope` (the session's own, `144`) every payload this
 * run delivered to a run of `receiver` that a restart cut off — the session ended resumably and came
 * back under the same id, keeping `.consumed/`. Such a payload is otherwise lost to the re-run: the
 * cold inline and a resume's `deliver:` both read the live lane only, and the resume path reports it
 * `missing:`, sending the sender to rewrite it (task 075).
 *
 * Nothing is put back unless the session has ended resumably ({@link lastResumableEndAt}), so
 * deliver-once is untouched in an uninterrupted session. A consumed file is then put back only when:
 * it carries this session's `runId`; it is not a scribe gap report (`112`: an acknowledged one stays
 * acknowledged); no file of its name is in the lane already; it was written before that end; no run
 * of `receiver` finished after it was written ({@link lastFinishedRunAt}, so a payload an earlier
 * round acted on never comes back as this round's); and no delivery from its sender to `receiver`
 * is logged since that end (it was already handed to the re-run). Returns the entries put back.
 */
export function restoreInterruptedDeliveries(
  projectDir: string,
  scope: string,
  receiver: string,
  runId: string | null | undefined,
  lines: unknown[],
  now: number = Date.now()
): ChannelEntry[] {
  if (!runId) return [];
  const endAt = lastResumableEndAt(lines);
  if (endAt === null) return [];
  const bare = bareAgentName(receiver);
  const finishedAt = lastFinishedRunAt(lines, bare);
  const restored: ChannelEntry[] = [];
  for (const e of readConsumed(projectDir, scope, bare, now)) {
    if (e.runId !== runId || isGapReport(e)) continue;
    const writtenAt = now - e.ageMs;
    if (writtenAt > endAt) continue;
    if (finishedAt !== null && writtenAt <= finishedAt) continue;
    const redelivered = latestAt(
      lines,
      (l) => l.kind === "channel_delivery" && l.sender === e.sender && l.receiver === bare
    );
    if (redelivered !== null && redelivered > endAt) continue;
    try {
      if (unretire(projectDir, scope, bare, e)) restored.push(e);
    } catch {
      // Left consumed: still aged out like any other, never worth failing a hook over.
    }
  }
  return restored;
}

/** `session` with `deliveries` recorded for `agentId` (replacing any earlier record for it). */
export function recordResumeDeliveries(
  session: MaestroSession,
  agentId: string,
  deliveries: ResumeDelivery[]
): MaestroSession {
  const all = { ...(session.resume_deliveries ?? {}) };
  if (deliveries.length > 0) all[agentId] = deliveries;
  else delete all[agentId];
  const next: MaestroSession = { ...session, resume_deliveries: all };
  if (Object.keys(all).length === 0) delete next.resume_deliveries;
  return next;
}

/**
 * Retire the files recorded for `agentId` that are still in `receiver`'s lane in `scope` with the
 * recorded stamp (a file the sender rewrote since carries the same run's stamp and is the fresher
 * payload, so it is retired too; a file now gone is skipped). A recorded file is matched by its
 * full scoped path, so a record made in another scope never retires anything here. Returns the
 * session without the record and the entries retired, for the caller to log.
 */
export function retireResumeDeliveries(
  projectDir: string,
  scope: string,
  session: MaestroSession,
  agentId: string,
  receiver: string
): { session: MaestroSession; retired: ChannelEntry[] } {
  const recorded = session.resume_deliveries?.[agentId];
  if (!agentId || !recorded || recorded.length === 0) return { session, retired: [] };
  const bare = bareAgentName(receiver);
  const want = new Map(recorded.map((d) => [d.file, d.run_id]));
  const retired: ChannelEntry[] = [];
  for (const e of readLane(projectDir, scope, bare)) {
    const runId = want.get(channelRelPath(scope, bare, e.fileName));
    if (runId === undefined || e.runId !== runId) continue;
    // `112`: a scribe-lane gap report is retired only by the scribe's own `SKILL_GAPS_HANDLED:`
    // line (`acknowledgeGaps`), never by having been handed over.
    if (isGapReport(e)) continue;
    try {
      retire(projectDir, scope, bare, e);
      retired.push(e);
    } catch {
      // Left in the lane: a later cold start still delivers it.
    }
  }
  return { session: recordResumeDeliveries(session, agentId, []), retired };
}

/** The handoff a loop-back answers: the most recent workflow `kind:"handoff"` entry with a label. */
export interface LatestHandoff {
  agentType: string;
  agentId: string;
  label: string;
}

/** The latest workflow handoff in this session's log (meeting turns and owner runs skipped), or null. */
export function latestWorkflowHandoff(lines: unknown[]): LatestHandoff | null {
  let latest: LatestHandoff | null = null;
  for (const line of lines ?? []) {
    if (!line || typeof line !== "object") continue;
    const e = line as Record<string, unknown>;
    if (e.kind !== "handoff" || e.meeting === true || e.owner_run === true) continue;
    if (typeof e.origin !== "string" || !e.origin || typeof e.label !== "string" || !e.label) continue;
    latest = { agentType: e.origin, agentId: typeof e.agent_id === "string" ? e.agent_id : "", label: e.label };
  }
  return latest;
}

/**
 * The payload routes the latest handoff took toward `target`: same label (case-insensitive), the
 * target's bare type as receiver. `senderRoutes` are that sender's payload routes, resolved by the
 * caller with the same three tiers the injector uses (`payloadRoutes`).
 */
export function expectedLoopbackPayloads(
  latest: LatestHandoff | null,
  senderRoutes: PayloadRoute[],
  target: string
): PayloadRoute[] {
  if (!latest) return [];
  const want = latest.label.toLowerCase();
  const receiver = bareAgentName(target);
  return senderRoutes.filter((r) => r.label.toLowerCase() === want && r.receiver === receiver);
}

/**
 * The expected routes whose payload is NOT in the target's lane as a current-run file, as a
 * `missing_payload` issue to append to `session.json`'s `handoff_issues` — or null when every one
 * is there.
 */
export function missingLoopbackPayload(
  latest: LatestHandoff,
  expected: PayloadRoute[],
  deliveries: ResumeDelivery[],
  now: Date = new Date()
): HandoffIssueRecord | null {
  const present = new Set(deliveries.map((d) => d.file));
  const missing = expected.filter((r) => !present.has(r.channelFile));
  if (missing.length === 0) return null;
  const files = missing.map((r) => r.channelFile);
  const receivers = [...new Set(missing.map((r) => r.receiver))];
  return {
    ts: now.toISOString(),
    agent: latest.agentType,
    agent_id: latest.agentId,
    kind: "missing_payload",
    verdict: null,
    label: latest.label,
    files,
    message:
      `The loop-back to ${receivers.join(", ")} expects ${files.join(", ")} from this run, and it is not in the channel. ` +
      `Do not dispatch or resume ${receivers.join(", ")} without it: resume this agent (SendMessage to its agent_id) and ask it to write that file, then route.`,
  };
}

/** Slack on the warning's timestamp, as the stop hook's own payload check allows (`MTIME_SLACK_MS`). */
const RESOLVED_SLACK_MS = 1000;

/** The mtime of a project-relative channel file in ms, or null when it cannot be read. */
export function channelFileMtime(projectDir: string, file: string): number | null {
  try {
    return fs.statSync(path.join(projectDir, ...file.split("/"))).mtimeMs;
  } catch {
    return null;
  }
}

/**
 * `issues` without each pending `missing_payload` whose files are all now in the lane as current-run
 * files (`present`). The sender wrote them after the warning, so reporting it would send the
 * orchestrator to fix a payload that is already there. Other issues are kept as they are.
 *
 * `156`: `present` is keyed on the session run id, which an earlier run of the SAME agent shares, so
 * a payload written before the warning proves nothing about it (a resumed run that skipped its
 * payload looked fulfilled by its first run's `test.1.md`). With `writtenAt`, a file resolves an
 * issue only when it was written at or after the issue's own timestamp (less the hook's 1 s slack);
 * a file whose time is unknown, or an issue without a parseable timestamp, never resolves it.
 */
export function dropResolvedMissingPayloads(
  issues: HandoffIssueRecord[] | undefined,
  present: ResumeDelivery[],
  writtenAt?: (file: string) => number | null
): HandoffIssueRecord[] {
  const list = Array.isArray(issues) ? issues : [];
  const files = new Set(present.map((d) => d.file));
  const fresh = (file: string, ts: string): boolean => {
    if (!writtenAt) return true;
    const warned = Date.parse(ts);
    const at = writtenAt(file);
    return Number.isFinite(warned) && at !== null && at >= warned - RESOLVED_SLACK_MS;
  };
  return list.filter(
    (i) =>
      i.kind !== "missing_payload" ||
      !i.files ||
      i.files.length === 0 ||
      !i.files.every((f) => files.has(f) && fresh(f, i.ts))
  );
}

/** `issues` plus `issue`, unless an equal one (same kind, agent_id, files) is already pending. */
export function appendHandoffIssue(
  issues: HandoffIssueRecord[] | undefined,
  issue: HandoffIssueRecord
): HandoffIssueRecord[] {
  const list = Array.isArray(issues) ? issues : [];
  const key = (i: HandoffIssueRecord) => `${i.kind}|${i.agent_id}|${(i.files ?? []).join(",")}`;
  return list.some((i) => key(i) === key(issue)) ? list : [...list, issue];
}
