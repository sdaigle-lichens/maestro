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
  return scanHandbacks(transcript).text;
}

/**
 * Whether a hand-back tool call is in the transcript at all, labelled or not. Once one is there
 * the transcript is complete as far as the hand-back goes, so a missing label is real (`124`).
 */
export function hasHandbackCall(transcript: string): boolean {
  return scanHandbacks(transcript).sawCall;
}

function scanHandbacks(transcript: string): { text: string | null; sawCall: boolean } {
  let found: string | null = null;
  let sawCall = false;
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
        sawCall = true;
        const text = messageText(block.input);
        if (text) found = text;
      }
    }
  }
  return { text: found, sawCall };
}

/** How long `awaitHandback` keeps looking, and how often (`124`). */
export const HANDBACK_WAIT_MS = 3000;
export const HANDBACK_POLL_MS = 100;

/**
 * `handbackHandoff` over a transcript that may not be fully written yet (`124`). Claude Code fires
 * `SubagentStop` before it has flushed the agent's final `SubagentHandback` tool_use line to the
 * transcript (probed live: the hook saw the transcript one assistant turn short, with no
 * hand-back call in it), so a single read finds nothing and the agent is flagged `missing` though
 * its report carried `HANDOFF: success`. Re-read until a hand-back call shows up, then judge it as
 * `handbackHandoff` always did. Stops early once a call is present (a labelless one is a real
 * `missing`), when the transcript cannot be read, or after `waitMs`. `read` returns the
 * transcript text, or null when unreadable; `sleep` is injected so this stays `fs`-free.
 */
export async function awaitHandback(
  read: () => string | null,
  sleep: (ms: number) => Promise<void>,
  waitMs: number = HANDBACK_WAIT_MS,
  pollMs: number = HANDBACK_POLL_MS
): Promise<string | null> {
  const attempts = Math.max(1, Math.ceil(waitMs / pollMs) + 1);
  for (let i = 0; i < attempts; i++) {
    const transcript = read();
    if (transcript === null) return null;
    const scan = scanHandbacks(transcript);
    if (scan.sawCall) return scan.text;
    if (i < attempts - 1) await sleep(pollMs);
  }
  return null;
}

/** `078`'s name for `handbackHandoff`, kept because the generated bundle's export surface only grows. */
export const sendMessageHandoff = handbackHandoff;
