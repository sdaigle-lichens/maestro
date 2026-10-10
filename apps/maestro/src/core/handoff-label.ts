// Recovering a HANDOFF label from a tool-call hand-back (`078`, `087`).
//
// An agent can deliver its report as a TOOL CALL instead of as its final text, and then its
// SubagentStop payload carries no `HANDOFF:` line (`last_assistant_message` is absent or empty).
// The agent's own transcript still holds the call; this finds it. `fs`-free: callers pass the
// transcript text.
//
// Two hand-back tools exist:
//   - `SendMessage` — an agent resumed through SendMessage answering back (`078`).
//   - `SubagentHandback` — `087`. Current Claude Code tells EVERY subagent "Your final report is
//     delivered through SubagentHandback: … call SubagentHandback({message: <your full report>})",
//     and only that call reaches the caller. `078`'s recovery matched the tool name `SendMessage`
//     only (and skipped every transcript line not containing that string), so in task 084 every
//     agent's report — HANDOFF line included — was invisible to the stop hook and each was
//     flagged `missing`.

const HANDOFF_RE = /[`*]*HANDOFF:\s*([^\n`*]+)[`*]*/gi;

/** Tool names whose `input` carries an agent's hand-back report. */
export const HANDBACK_TOOLS: readonly string[] = ["SubagentHandback", "SendMessage"];

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
  for (const k of ["message", "content", "text", "summary", "report"]) {
    if (typeof o[k] === "string" && lastHandoffLabel(o[k])) return o[k] as string;
  }
  return "";
}

/**
 * The text of the last hand-back tool call (`SubagentHandback` or `SendMessage`) in a JSONL
 * transcript that carries a `HANDOFF:` line, or null. Tolerates malformed lines and both
 * transcript shapes (`message.content[]` and a top-level `content[]`).
 */
export function handbackHandoff(transcript: string): string | null {
  let found: string | null = null;
  for (const line of transcript.split("\n")) {
    if (!HANDBACK_TOOLS.some((t) => line.includes(t))) continue;
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
      if (block && block.type === "tool_use" && HANDBACK_TOOLS.includes(block.name)) {
        const text = messageText(block.input);
        if (text) found = text;
      }
    }
  }
  return found;
}

/** `078`'s name for `handbackHandoff`, kept because the generated bundle's export surface only grows. */
export const sendMessageHandoff = handbackHandoff;
