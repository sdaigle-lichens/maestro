// Team-meeting mode: the one flag that makes the runtime treat a meeting participant differently
// from a workflow agent.
//
// A team meeting (`/maestro-team-meeting`) resumes or dispatches the project's REAL configured
// agents, hub-and-spoke, so they can propose changes to the Maestro setup. Without this flag those
// runs are indistinguishable from workflow steps, and three things leak into a later workflow run
// in the same session:
//
//   1. channel delivery would inline AND retire a same-run payload waiting for the agent's next
//      workflow step, and SubagentStop would stamp anything the participant wrote to a lane, so a
//      later workflow agent would consume it;
//   2. the participant's `kind:"handoff"` log entry would make it a resume target for a later
//      condition-edge loop-back;
//   3. a participant with write tools could apply changes instead of proposing them.
//
// The flag lives in the session's own `session.json` (`meeting`), so it is per session and
// disappears with the session directory at a final SessionEnd. It applies only to the agent types
// listed in `participants` — any other subagent in the session is untouched.
//
// Every writer of `session.json` spreads the existing object, so this key survives them all;
// `maestro-set-session-workflow.cjs` is the one writer that deliberately removes it (starting a
// workflow ends any meeting). Both ending paths go through `closeMeeting`, which also records the
// participants' unstamped lane files as `meeting_leftovers` — the write guard cannot see a Bash
// write, and a leftover must never be stamped by the sender's next workflow run.
//
// `fs`/`path` only — re-exported from the `maestro-session` bundle, which must stay free of
// `node:sqlite`.

import fs from "node:fs";
import path from "node:path";
import { bareAgentName } from "./success-path.js";
import { unstampedFilesOf, type ChannelFileMark } from "./handoff-channels.js";
import type { MaestroMeetingState } from "./types.js";

/** `<session dir>/meeting/` — the transcript directory and the only place participants may write. */
export const MEETING_DIR_NAME = "meeting";

/** The `session.json` key `closeMeeting` records an ended meeting's leftover lane files under. */
export const MEETING_LEFTOVERS_KEY = "meeting_leftovers";

const MEETING_MODES: readonly string[] = ["review", "post-mortem"];

/** The meeting directory for a session directory. Pure path shape. */
export function meetingDirFor(sessionDir: string): string {
  return path.join(sessionDir, MEETING_DIR_NAME);
}

/**
 * The active meeting recorded in a parsed `session.json`, or null when there is none or the value
 * is malformed. A malformed value is treated as "no meeting" — the fail-safe direction for the
 * hooks is then today's normal workflow behaviour, which is what a corrupt flag must not change.
 */
export function readMeeting(session: unknown): MaestroMeetingState | null {
  if (!session || typeof session !== "object") return null;
  const m = (session as { meeting?: unknown }).meeting;
  if (!m || typeof m !== "object") return null;
  const v = m as Record<string, unknown>;
  if (typeof v.id !== "string" || !v.id) return null;
  if (typeof v.mode !== "string" || !MEETING_MODES.includes(v.mode)) return null;
  if (typeof v.dir !== "string") return null;
  if (!Array.isArray(v.participants) || !v.participants.every((p) => typeof p === "string")) return null;
  return {
    id: v.id,
    mode: v.mode as MaestroMeetingState["mode"],
    dir: v.dir,
    participants: v.participants.map((p) => bareAgentName(p as string)).filter(Boolean),
    started_at: typeof v.started_at === "string" ? v.started_at : "",
  };
}

/**
 * The meeting `agentType` takes part in, or null. Compared BARE on both sides, so
 * `maestro:backend` matches a `backend` participant. An empty agent type (the main session) is
 * never a participant.
 */
export function meetingFor(session: unknown, agentType: string | null | undefined): MaestroMeetingState | null {
  const bare = bareAgentName(agentType);
  if (!bare) return null;
  const meeting = readMeeting(session);
  return meeting && meeting.participants.includes(bare) ? meeting : null;
}

/** A copy of a parsed `session.json` with the meeting removed and every other key kept. Pure. */
export function withoutMeeting<T extends object>(session: T): T {
  const copy = { ...session } as T & { meeting?: unknown };
  delete copy.meeting;
  return copy;
}

function readRawState(statePath: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function writeRawState(statePath: string, state: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const tmp = statePath + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, statePath);
}

/**
 * Switch meeting mode on for one session: create `<sessionDir>/meeting/` and record the flag in
 * `statePath`, keeping every other key. Starting over an existing meeting replaces it (a fresh
 * id). Returns the recorded state.
 */
export function startMeeting(
  statePath: string,
  sessionDir: string,
  opts: { mode: MaestroMeetingState["mode"]; participants: string[]; now?: Date }
): MaestroMeetingState {
  const now = opts.now ?? new Date();
  const dir = meetingDirFor(sessionDir);
  fs.mkdirSync(dir, { recursive: true });
  const meeting: MaestroMeetingState = {
    id: `m-${now.getTime()}`,
    mode: opts.mode,
    dir,
    participants: [...new Set(opts.participants.map((p) => bareAgentName(p)).filter(Boolean))],
    started_at: now.toISOString(),
  };
  writeRawState(statePath, { ...readRawState(statePath), meeting });
  return meeting;
}

/**
 * The meeting leftovers recorded in a parsed `session.json` (`meeting_leftovers`): unstamped lane
 * files the participants of an ended meeting left behind, as they stood when it ended. The
 * sender's SubagentStop passes these to `writeStamp` as `skip`, so a later workflow run never
 * adopts one as its own payload while it is unchanged. Malformed entries are dropped.
 */
export function meetingLeftovers(session: unknown): ChannelFileMark[] {
  if (!session || typeof session !== "object") return [];
  const raw = (session as Record<string, unknown>)[MEETING_LEFTOVERS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.filter(
    (m): m is ChannelFileMark =>
      !!m &&
      typeof m === "object" &&
      typeof (m as ChannelFileMark).path === "string" &&
      typeof (m as ChannelFileMark).mtimeMs === "number" &&
      typeof (m as ChannelFileMark).size === "number"
  );
}

/**
 * A parsed `session.json` with its meeting closed: the `meeting` key removed, every other key kept,
 * and the participants' current unstamped lane files merged into `meeting_leftovers` (newest mark
 * per path wins). The ONE way a meeting ends — `endMeeting` and `maestro-set-session-workflow.cjs`
 * both go through it, so neither path can let a participant's leftover be stamped later.
 * `ended` is false (and the state returned untouched) when no meeting key was present.
 */
export function closeMeeting(
  session: Record<string, unknown>,
  projectDir: string
): { state: Record<string, unknown>; ended: boolean } {
  if (!("meeting" in session)) return { state: session, ended: false };
  const participants = readMeeting(session)?.participants ?? [];
  const byPath = new Map(meetingLeftovers(session).map((m) => [m.path, m]));
  for (const participant of participants) {
    for (const mark of unstampedFilesOf(projectDir, participant)) byPath.set(mark.path, mark);
  }
  const state = withoutMeeting(session);
  if (byPath.size > 0) state[MEETING_LEFTOVERS_KEY] = [...byPath.values()];
  return { state, ended: true };
}

/** `<project>/.claude/maestro_sessions/<id>/session.json` → `<project>`. Pure path shape. */
function projectDirOfState(statePath: string): string {
  return path.resolve(statePath, "..", "..", "..", "..");
}

/**
 * Switch meeting mode off through `closeMeeting`, keeping every other key and the meeting
 * directory (the transcript stays until SessionEnd removes the session directory). Returns whether
 * a meeting was on. `projectDir` defaults to the project the state path sits in.
 */
export function endMeeting(statePath: string, projectDir: string = projectDirOfState(statePath)): boolean {
  if (!fs.existsSync(statePath)) return false;
  const { state, ended } = closeMeeting(readRawState(statePath), projectDir);
  if (ended) writeRawState(statePath, state);
  return ended;
}

/**
 * The context SubagentStart injects for a participant, on a first run AND on a resume — a resumed
 * workflow agent carries its first run's HANDOFF routing in its own history, so this has to
 * override it explicitly every time.
 */
export function meetingNotice(meeting: MaestroMeetingState, agentType: string): string {
  const bare = bareAgentName(agentType);
  return (
    `Maestro team meeting in progress (${meeting.mode}, ${meeting.id}). This run is a meeting turn, NOT a workflow step:\n` +
    `- Ignore every HANDOFF routing line, handoff payload / channel-file instruction and mandatory output format you ` +
    `were given, including any from an earlier run in your history. Do not end with a HANDOFF: line.\n` +
    `- Do not write anything under .claude/channels/. Your only writable location is the meeting directory: ` +
    `${meeting.dir}/ — write your proposals to the round file the moderator names (e.g. round-1/${bare}.json).\n` +
    `- Propose, never apply: do not edit project files, agents, skills, rules or .claude/maestro.json. ` +
    `Bash is for read-only checks only — never write or modify a file with it.\n` +
    `- Follow the moderator's brief, and end your reply with one short line saying what you wrote.`
  );
}
