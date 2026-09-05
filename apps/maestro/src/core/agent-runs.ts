// Resolving which agent_id a loop-back should RESUME, from the session log alone (`039`).
//
// The index this needs already exists: `maestro-subagent-log.js` appends a `kind:"handoff"` entry
// to maestro_session.log.jsonl on every SubagentStop that carries an `agent_type` — `{ origin:
// <agent type>, agent_id, ... }`. That log is append-only and deleted at SessionEnd, so it is
// already a per-run agent-type → agent-id index with exactly the right lifetime. This module adds
// no state of its own; it only reads what is already there.
//
// Pure — no `fs`. The caller reads and parses the log's lines and hands them in.

import { bareAgentName, resolveSearchList, collectAgentSkills } from "./success-path.js";
import type { MaestroConfigV3, MaestroSession } from "./types.js";

export interface AgentRun {
  /** The agent's raw type as logged — may be namespaced (e.g. "maestro:backend"). */
  agentType: string;
  agentId: string;
  ts: string;
}

/**
 * Every completed agent run in this session's log, in file (chronological) order. Only
 * `kind:"handoff"` entries count — those are SubagentStop with a real `agent_type`, i.e. a
 * workflow agent that finished a run and reported a HANDOFF line. A `kind:"transition"` entry (no
 * `agent_type`) or a malformed line is skipped rather than thrown on: the log is written by a hook
 * best-effort, and a caller resolving a resume target must degrade to "no prior run" rather than
 * fail the orchestrator over one bad line.
 */
export function agentRunsFromLog(lines: unknown[]): AgentRun[] {
  const runs: AgentRun[] = [];
  for (const line of lines ?? []) {
    if (!line || typeof line !== "object") continue;
    const entry = line as Record<string, unknown>;
    if (entry.kind !== "handoff") continue;
    const agentType = entry.origin;
    const agentId = entry.agent_id;
    if (typeof agentType !== "string" || !agentType) continue;
    if (typeof agentId !== "string" || !agentId) continue;
    runs.push({ agentType, agentId, ts: typeof entry.ts === "string" ? entry.ts : "" });
  }
  return runs;
}

/**
 * Whether `agentId` has a `kind:"handoff"` entry anywhere in this session's log — i.e. this
 * `SubagentStart` is a RESUME (the orchestrator `SendMessage`d an agent that already completed a
 * run this session) rather than a first dispatch (`040`).
 *
 * Deliberately keyed on `handoff`, never `dispatch`: the sibling `SubagentStart` hook
 * (`maestro-subagent-log.js`) writes a `dispatch` entry carrying this SAME `agent_id`, and both
 * hooks sit in one matcher with no ordering guarantee between them. A `dispatch` entry IS
 * written for a run that has NOT finished — which is exactly the race — so keying on it would
 * risk this hook finding the sibling's own entry for the CURRENT run and misreading a first run
 * as a resume. A `handoff` entry is only ever written at `SubagentStop`, so it cannot exist yet
 * for an unfinished run: immune to that race by construction.
 *
 * A missing or unreadable log — no lines, or nothing matches — answers `false`: the safe
 * direction is to fall through to a first run's full injection, never to the one-line reminder.
 */
export function hasCompletedRun(lines: unknown[], agentId: string): boolean {
  if (!agentId) return false;
  for (const line of lines ?? []) {
    if (!line || typeof line !== "object") continue;
    const entry = line as Record<string, unknown>;
    if (entry.kind !== "handoff") continue;
    if (entry.agent_id === agentId) return true;
  }
  return false;
}

/**
 * The `agent_id` a loop-back to `agentType` should resume, or `null` when a cold `Task` is the
 * only safe answer:
 *
 * - no completed run for this agent type yet in this session's log (the common case — a first
 *   visit has nothing to resume);
 * - the active workflow's search list resolves `agentType` to more than one DISTINCT instance
 *   name. `SubagentStart` injects context by agent TYPE alone, never by instance
 *   (`collectAgentSkills` returns `matchedInstances`, plural) — so with two instances sharing one
 *   `agent`, the log's bare `origin` can't say which one actually ran, and resuming would risk
 *   silently attaching the wrong instance's history under a shared name. A cold spawn is merely
 *   slower; a wrong resume is corrupt and silent.
 *
 * Takes the MOST RECENT matching entry, so a third-plus visit resumes the latest run rather than
 * the first one. Both sides are compared bare (`033`'s trap): `origin` is the raw agent_type
 * Claude Code logs, which may be namespaced, while `agentType` here may be either.
 */
export function resumeTarget(
  lines: unknown[],
  cfg: MaestroConfigV3 | null,
  session: MaestroSession,
  agentType: string
): string | null {
  const wantBare = bareAgentName(agentType);
  if (!wantBare) return null;

  const { searchList } = resolveSearchList(cfg, session);
  const { matchedInstances } = collectAgentSkills(searchList, cfg?.workflow_instances, agentType);
  if (new Set(matchedInstances).size > 1) return null;

  let latest: AgentRun | null = null;
  for (const run of agentRunsFromLog(lines)) {
    if (bareAgentName(run.agentType) !== wantBare) continue;
    latest = run;
  }
  return latest ? latest.agentId : null;
}
