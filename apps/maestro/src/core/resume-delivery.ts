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
// `fs`/`path` only: rides in the maestro-session bundle, which must stay free of `node:sqlite`.

import { channelRelPath, isGapReport, readLane, retire, type ChannelEntry } from "./handoff-channels.js";
import type { PayloadRoute } from "./handoff-payload.js";
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

/**
 * `issues` without each pending `missing_payload` whose files are all now in the lane as current-run
 * files (`present`). The sender wrote them after the warning, so reporting it would send the
 * orchestrator to fix a payload that is already there. Other issues are kept as they are.
 */
export function dropResolvedMissingPayloads(
  issues: HandoffIssueRecord[] | undefined,
  present: ResumeDelivery[]
): HandoffIssueRecord[] {
  const list = Array.isArray(issues) ? issues : [];
  const files = new Set(present.map((d) => d.file));
  return list.filter(
    (i) => i.kind !== "missing_payload" || !i.files || i.files.length === 0 || !i.files.every((f) => files.has(f))
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
