// Derives a best-effort context-window fill percentage from a hook payload's own transcript_path,
// so a session-log entry can carry "how full was this agent's context right now" without every
// caller needing to know the transcript JSONL shape or which model maps to which context-window
// ceiling. See the `code-architecture-design` brief for `maestro_session.log.jsonl` context/usage
// stamping — this module is that brief's `deriveUsage`.
//
// Reads only a growing tail of the file rather than the whole thing — transcripts run to multiple
// MB and this is meant to run on every PreToolUse — starting at TAIL_CHUNK_BYTES and quadrupling
// until a parseable assistant line with `message.usage` turns up or MAX_TAIL_BYTES is hit.
//
// KNOWN LIMITATION (open question in the design brief): `transcript_path` is the hook payload's own
// field, and for a `PreToolUse` fired from inside a subagent it is the SAME file the main thread and
// every sibling subagent write to — only `SubagentStop` gets a private `agent_transcript_path`. So
// under parallel subagents, "last assistant line in this file" can belong to a different agent than
// the one this call is stamping. Treat `ctx_pct` on those entries as an estimate, not a guarantee.

import fs from "node:fs";

const TAIL_CHUNK_BYTES = 64 * 1024;
const MAX_TAIL_BYTES = 4 * 1024 * 1024; // give up rather than parse an unbounded file

/** Context-window ceiling per model, in tokens. Unlisted models fall back to `DEFAULT_CONTEXT_WINDOW`. */
export const CONTEXT_WINDOW_TOKENS: Record<string, number> = {
  "claude-opus-5": 200_000,
  "claude-sonnet-5": 200_000,
  "claude-fable-5-1": 200_000,
  "claude-haiku-4-5-20251001": 200_000,
};

export const DEFAULT_CONTEXT_WINDOW = 200_000;

interface TranscriptUsage {
  input_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface TranscriptLine {
  type?: string;
  message?: { model?: string; usage?: TranscriptUsage };
}

/** Reads a growing tail of `filePath` until a parseable assistant `usage` line turns up. */
function lastAssistantUsageLine(filePath: string): TranscriptLine | undefined {
  const size = fs.statSync(filePath).size;
  if (size === 0) return undefined;
  for (let window = TAIL_CHUNK_BYTES; ; window *= 4) {
    const start = Math.max(0, size - window);
    const length = size - start;
    const buf = Buffer.alloc(length);
    const fd = fs.openSync(filePath, "r");
    try {
      fs.readSync(fd, buf, 0, length, start);
    } finally {
      fs.closeSync(fd);
    }
    const lines = buf.toString("utf8").split("\n").filter(Boolean);
    if (start > 0) lines.shift(); // drop a line truncated by the window's start
    for (let i = lines.length - 1; i >= 0; i--) {
      let parsed: TranscriptLine;
      try {
        parsed = JSON.parse(lines[i]);
      } catch {
        continue;
      }
      if (parsed.type === "assistant" && parsed.message?.usage) return parsed;
    }
    if (start === 0 || window >= MAX_TAIL_BYTES) return undefined;
  }
}

export interface DerivedUsage {
  ctx_pct: number;
  ctx_model: string;
}

/**
 * Best-effort context-window fill percentage for the agent that fired a hook, from its own
 * `transcript_path`. Never throws — returns `undefined` on anything short of a clean read (missing
 * path, missing file, empty file, no parseable usage line), so a caller (`appendSessionLog`) can
 * treat "unknown" as the only failure mode it needs to handle. An unrecognized model id still
 * produces a percentage, against `DEFAULT_CONTEXT_WINDOW` — a rough estimate beats none.
 */
export function deriveUsage(payload: { transcript_path?: string }): DerivedUsage | undefined {
  if (!payload.transcript_path) return undefined;
  let line: TranscriptLine | undefined;
  try {
    line = lastAssistantUsageLine(payload.transcript_path);
  } catch {
    return undefined;
  }
  const usage = line?.message?.usage;
  const model = line?.message?.model;
  if (!usage || !model) return undefined;
  const { input_tokens = 0, cache_read_input_tokens = 0, cache_creation_input_tokens = 0 } = usage;
  const used = input_tokens + cache_read_input_tokens + cache_creation_input_tokens;
  const window = CONTEXT_WINDOW_TOKENS[model] ?? DEFAULT_CONTEXT_WINDOW;
  return { ctx_pct: Math.round((used / window) * 1000) / 10, ctx_model: model };
}
