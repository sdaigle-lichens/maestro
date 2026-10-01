// Recovering a HANDOFF label from a SendMessage hand-back (`078`).
//
// An agent resumed through SendMessage delivers its handoff as a `SendMessage` tool call, so its
// `last_assistant_message` carries no `HANDOFF:` line and the log recorded the handoff as
// `unknown`. The agent's own transcript still holds the call; this finds it. `fs`-free: callers
// pass the transcript text.

const HANDOFF_RE = /[`*]*HANDOFF:\s*([^\n`*]+)[`*]*/gi;

/** The label of the LAST `HANDOFF:` line in `msg`, or null. */
export function lastHandoffLabel(msg: unknown): string | null {
  if (typeof msg !== "string") return null;
  const matches = [...msg.matchAll(HANDOFF_RE)];
  if (matches.length === 0) return null;
  return matches[matches.length - 1][1].trim() || null;
}

function messageText(input: unknown): string {
  if (typeof input === "string") return input;
  if (!input || typeof input !== "object") return "";
  const o = input as Record<string, unknown>;
  for (const k of ["message", "content", "text", "summary"]) {
    if (typeof o[k] === "string" && lastHandoffLabel(o[k])) return o[k] as string;
  }
  return "";
}

/**
 * The text of the last `SendMessage` tool call in a JSONL transcript that carries a `HANDOFF:`
 * line, or null. Tolerates malformed lines and both transcript shapes (`message.content[]` and a
 * top-level `content[]`).
 */
export function sendMessageHandoff(transcript: string): string | null {
  let found: string | null = null;
  for (const line of transcript.split("\n")) {
    if (!line.includes("SendMessage")) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const e = entry as { message?: { content?: unknown }; content?: unknown };
    const content = e?.message?.content ?? e?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === "tool_use" && block.name === "SendMessage") {
        const text = messageText(block.input);
        if (text) found = text;
      }
    }
  }
  return found;
}
