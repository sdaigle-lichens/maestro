// Channel-only write permission for the read-only agents (`078`).
//
// The reviewer and refactor agents may not modify application code, yet their handoff protocol
// has them write a payload file under `.claude/channels/`. Removing `Write`/`Edit` from their
// `disallowedTools` and enforcing "channel lane files only" in a PreToolUse hook gives them that
// one write without letting them touch anything else. The check lives here, in `fs`/`path` only
// code, so `plugins/maestro/scripts/maestro-channel-write-guard.js` can reach it through the
// `maestro-session` bundle (which must stay free of `node:sqlite`).
//
// The path is judged by where it REALLY lands: `..` segments are refused outright (the OS resolves
// `link/..` through the symlink, lexical collapsing does not), and symlinks — in an ancestor, or
// the file itself, including a dangling one — are resolved before the containment test.
//
// Team meetings (`meeting-mode.ts`) narrow this further: a meeting PARTICIPANT, of any agent type,
// may write only inside the session's meeting directory (`<session dir>/meeting/`) — not even its
// channel lane, since a lane file it wrote would be stamped and delivered into a later workflow
// step. The caller passes `meetingDir` only for a participant; it comes from the session's own
// paths, never from tool input.

import fs from "node:fs";
import path from "node:path";
import { bareAgentName } from "./success-path.js";

/** Agents whose writes are confined to `.claude/channels/`. */
export const CHANNEL_ONLY_AGENTS: readonly string[] = ["reviewer", "refactor"];

/** The tools that write a file, and the input key that names the target. */
const WRITE_TOOL_PATH_KEYS: Record<string, string> = {
  Write: "file_path",
  Edit: "file_path",
  MultiEdit: "file_path",
  NotebookEdit: "notebook_path",
};

export type ChannelWriteVerdict = { allow: true } | { allow: false; reason: string };

/** Is this agent type confined to channel writes? Accepts `plugin:agent` namespaced names. */
export function isChannelOnlyAgent(agentType: string | null | undefined): boolean {
  return CHANNEL_ONLY_AGENTS.includes(bareAgentName(agentType));
}

/**
 * Resolve `p` through symlinks even when its tail does not exist yet: realpath the deepest
 * existing ancestor and re-append the rest. A dangling symlink anywhere on the path returns null
 * (its target is unknowable, so it cannot be proven to stay inside the lane).
 */
function realResolve(p: string): string | null {
  let cur = path.resolve(p);
  const tail: string[] = [];
  for (;;) {
    let st: fs.Stats | null = null;
    try {
      st = fs.lstatSync(cur);
    } catch {
      st = null;
    }
    if (st) {
      try {
        return path.join(fs.realpathSync(cur), ...tail);
      } catch {
        return null; // dangling symlink / unreadable
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) return cur ? path.join(cur, ...tail) : null;
    tail.unshift(path.basename(cur));
    cur = parent;
  }
}

function denyMeeting(target: string, meetingDir: string): ChannelWriteVerdict {
  return {
    allow: false,
    reason:
      `Blocked: a Maestro team meeting is in progress and you are a participant — you may only write files under ` +
      `${meetingDir}/ (the meeting directory). "${target}" is outside it (or reaches outside through a ".." segment ` +
      `or a symlink). Propose changes in your round file; never apply them.`,
  };
}

/**
 * The real path of a meeting directory, or null when it cannot be trusted as one. The caller's
 * `meetingDir` is `<claudeDir>/maestro_sessions/<id>/meeting` for ITS OWN session `<id>`; the real
 * path must be exactly that session directory's real path plus `meeting`, and its `<id>` segment
 * must still be `<id>`. So a `meeting` entry that is a symlink — to another session's meeting
 * directory or anywhere else — and a session directory that is a symlink to another session's are
 * both refused rather than followed; a shape-only check would accept either.
 */
function realMeetingDir(meetingDir: string): string | null {
  const resolved = path.resolve(meetingDir);
  const sessionDir = path.dirname(resolved);
  const sessionId = path.basename(sessionDir);
  if (path.basename(resolved) !== "meeting" || path.basename(path.dirname(sessionDir)) !== "maestro_sessions") {
    return null;
  }
  const realSession = realResolve(sessionDir);
  const real = realResolve(resolved);
  if (!realSession || !real) return null;
  if (real !== path.join(realSession, "meeting")) return null; // `meeting` itself is a symlink
  const parts = real.split(path.sep);
  const n = parts.length;
  if (n < 3 || parts[n - 2] !== sessionId || parts[n - 3] !== "maestro_sessions") return null;
  return real;
}

function deny(target: string): ChannelWriteVerdict {
  return {
    allow: false,
    reason:
      `Blocked: this agent may only write files under .claude/channels/ (its handoff channel lanes). ` +
      `"${target}" is outside it (or reaches outside through a ".." segment or a symlink). ` +
      `Report findings in your final message instead; delegate edits to the responsible agent.`,
  };
}

/**
 * Decide whether a tool call is allowed. Non-restricted agents, and tools that do not write a
 * file, are always allowed — this guard only ever narrows the reviewer and refactor agents, and
 * (when `meetingDir` is given) a team-meeting participant of any type.
 */
export function checkChannelWrite(input: {
  cwd: string;
  agentType: string | null | undefined;
  toolName: string | null | undefined;
  toolInput: Record<string, unknown> | null | undefined;
  /** Set only when this agent is a participant of the session's active team meeting. */
  meetingDir?: string | null;
}): ChannelWriteVerdict {
  const { cwd, agentType, toolName, toolInput, meetingDir } = input;
  const key = toolName ? WRITE_TOOL_PATH_KEYS[toolName] : undefined;

  if (meetingDir) {
    if (!key) return { allow: true };
    const raw = toolInput?.[key];
    if (typeof raw !== "string" || raw === "") return denyMeeting(String(raw ?? ""), meetingDir);
    if (raw.split(/[\\/]+/).includes("..")) return denyMeeting(raw, meetingDir);
    const target = realResolve(path.resolve(cwd || meetingDir, raw));
    const root = realMeetingDir(meetingDir);
    if (!target || !root) return denyMeeting(raw, meetingDir);
    return target.startsWith(root + path.sep) ? { allow: true } : denyMeeting(raw, meetingDir);
  }

  if (!isChannelOnlyAgent(agentType)) return { allow: true };
  if (!key) return { allow: true };

  const raw = toolInput?.[key];
  if (typeof raw !== "string" || raw === "") return deny(String(raw ?? ""));
  if (!cwd) return deny(raw);
  if (raw.split(/[\\/]+/).includes("..")) return deny(raw);

  const target = realResolve(path.resolve(cwd, raw));
  const realCwd = realResolve(cwd);
  const lane = realResolve(path.join(cwd, ".claude", "channels"));
  if (!target || !realCwd || !lane) return deny(raw);
  // A `.claude/channels` that is itself a symlink out of the project is not a lane.
  if (lane !== path.join(realCwd, ".claude", "channels") && !lane.startsWith(realCwd + path.sep)) {
    return deny(raw);
  }
  return target.startsWith(lane + path.sep) ? { allow: true } : deny(raw);
}
