// A display title for a Maestro session tab (`068`). Framework-free.
//
// Priority, first hit wins:
//   1. the session's active maestro task — `<project>/.claude/maestro_sessions/<id>/session.json`
//      `active_task` names a file in `.claude/maestro-tasks/`; its first `# ` heading, else the
//      filename;
//   2. the title `claude --resume` shows, read from the Claude transcript
//      `<claude config dir>/projects/<slug>/<sessionId>.jsonl`;
//   3. null — the caller applies its own fallback.
//
// ── The transcript entries (inspected on real transcripts, 4k+ entries) ─────────────────────────
//   {"type":"ai-title","aiTitle":"..."}          written repeatedly as the AI re-titles the session
//   {"type":"agent-name","agentName":"..."}      a user /rename
//   {"type":"custom-title","customTitle":"..."}  a user /rename in Claude Code versions that use this
//                                                type (none exist on the inspected machine; handled
//                                                by the documented shape, not observed)
//   {"type":"summary","summary":"..."}           the older auto-summary
// A /rename on the inspected machine wrote `agent-name` AND rewrote the following `ai-title` to the
// same text, so a rename is visible either way. Precedence: the LAST user-name entry
// (agent-name / custom-title) beats the last ai-title, which beats the last summary.
//
// The slug is the project path with every non-alphanumeric character replaced by `-`. Two paths can
// flatten to one slug, so the slug directory is a lookup key only; the transcript file name is the
// session id, which is what makes the match exact.
//
// Transcripts reach tens of MB, so only the last `TAIL_BYTES` are read (titles are re-appended over
// a session's life, so the tail carries the latest), and a result is cached by path+mtime+size.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isValidSessionId, sessionPathsFor } from "./session-paths.js";

const TAIL_BYTES = 4 * 1024 * 1024;
const MAX_TITLE_LEN = 200;

export interface SessionTitleRef {
  projectRoot: string;
  sessionId: string;
}

/** Map key used by `resolveSessionTitles` and the renderer: `${projectRoot}::${sessionId}`. */
export function sessionTitleKey(projectRoot: string, sessionId: string): string {
  return `${projectRoot}::${sessionId}`;
}

/** The directory Claude Code keeps transcripts under: `$CLAUDE_CONFIG_DIR` else `~/.claude`. */
function claudeHome(env: Record<string, string | undefined>): string {
  return env.CLAUDE_CONFIG_DIR || path.join(env.HOME || os.homedir(), ".claude");
}

export function projectSlug(projectRoot: string): string {
  return projectRoot.replace(/[^A-Za-z0-9]/g, "-");
}

function clean(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.replace(/\s+/g, " ").trim();
  return t ? t.slice(0, MAX_TITLE_LEN) : null;
}

function readTail(file: string, size: number): string {
  const fd = fs.openSync(file, "r");
  try {
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const text = buf.toString("utf8");
    // A read that starts mid-file begins mid-line: drop the partial first line.
    if (start === 0) return text;
    const nl = text.indexOf("\n");
    return nl === -1 ? "" : text.slice(nl + 1);
  } finally {
    fs.closeSync(fd);
  }
}

const transcriptCache = new Map<string, { mtimeMs: number; size: number; title: string | null }>();

/** The `--resume` title from a transcript file, or null. Never throws. */
export function readTranscriptTitle(file: string): string | null {
  try {
    const st = fs.statSync(file);
    const cached = transcriptCache.get(file);
    if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) return cached.title;
    let named: string | null = null;
    let ai: string | null = null;
    let summary: string | null = null;
    const lines = readTail(file, st.size).split("\n");
    for (let i = lines.length - 1; i >= 0 && named === null; i--) {
      const line = lines[i];
      if (!line || line[0] !== "{") continue;
      // Cheap pre-filter before JSON.parse on the (mostly large, irrelevant) lines.
      if (!/"type":"(ai-title|agent-name|custom-title|summary)"/.test(line.slice(0, 40))) continue;
      let e: { type?: string; aiTitle?: unknown; agentName?: unknown; customTitle?: unknown; summary?: unknown };
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      if (e.type === "custom-title") named = clean(e.customTitle);
      else if (e.type === "agent-name") named = clean(e.agentName);
      else if (e.type === "ai-title" && ai === null) ai = clean(e.aiTitle);
      else if (e.type === "summary" && summary === null) summary = clean(e.summary);
    }
    const title = named ?? ai ?? summary;
    transcriptCache.set(file, { mtimeMs: st.mtimeMs, size: st.size, title });
    return title;
  } catch {
    return null;
  }
}

/** First `# ` heading of a task file's text, else null. */
function taskHeading(text: string): string | null {
  for (const line of text.split("\n")) {
    const m = /^#\s+(.+?)\s*$/.exec(line);
    if (m) return clean(m[1]);
  }
  return null;
}

function activeTaskTitle(projectRoot: string, sessionId: string): string | null {
  try {
    const claudeDir = path.join(projectRoot, ".claude");
    const paths = sessionPathsFor(claudeDir, sessionId);
    if (!paths) return null;
    const state: unknown = JSON.parse(fs.readFileSync(paths.state, "utf8"));
    const active = (state as { active_task?: unknown })?.active_task;
    if (typeof active !== "string" || !active) return null;
    const filename = path.basename(active);
    try {
      const heading = taskHeading(fs.readFileSync(path.join(claudeDir, "maestro-tasks", filename), "utf8"));
      if (heading) return heading;
    } catch {
      // task file missing: fall back to the name
    }
    return clean(filename);
  } catch {
    return null;
  }
}

/** Resolve one session's title, or null. Never throws. */
export function resolveSessionTitle(
  projectRoot: string,
  sessionId: string,
  env: Record<string, string | undefined> = process.env
): string | null {
  if (!projectRoot || !isValidSessionId(sessionId)) return null;
  const task = activeTaskTitle(projectRoot, sessionId);
  if (task) return task;
  return readTranscriptTitle(path.join(claudeHome(env), "projects", projectSlug(projectRoot), `${sessionId}.jsonl`));
}

/**
 * Batch form: a record keyed by `sessionTitleKey`. Sessions with no title are present with `null`
 * so the caller can tell "resolved to nothing" from "not asked".
 */
export function resolveSessionTitles(
  refs: SessionTitleRef[],
  env: Record<string, string | undefined> = process.env
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const r of refs) out[sessionTitleKey(r.projectRoot, r.sessionId)] = resolveSessionTitle(r.projectRoot, r.sessionId, env);
  return out;
}
