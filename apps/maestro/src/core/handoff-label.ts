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
export function handbackHandoff(transcript: string, sinceMs: number | null = null): string | null {
  return scanHandbacks(transcript, sinceMs).text;
}

/**
 * Whether a hand-back tool call is in the transcript at all, labelled or not. Once one is there
 * the transcript is complete as far as the hand-back goes, so a missing label is real (`124`).
 */
export function hasHandbackCall(transcript: string, sinceMs: number | null = null): boolean {
  return scanHandbacks(transcript, sinceMs).sawCall;
}

type Entry = {
  type?: unknown;
  message?: { content?: unknown };
  content?: unknown;
  promptId?: unknown;
  isMeta?: unknown;
  origin?: { kind?: unknown };
  timestamp?: unknown;
};

/** Clock slack between the Maestro log's dispatch `ts` and the transcript entry's timestamp (`153`). */
const DISPATCH_SLACK_MS = 1000;

/**
 * Whether a parsed transcript entry opens a run (`151`, `153`). A resumed agent's transcript keeps
 * the earlier run's hand-back call, and only calls AFTER the run boundary belong to the current run.
 *
 * Real Claude Code transcripts (checked against a resumed agent's log, `153`): the resume prompt is
 * a `user` entry, `isMeta` with `origin.kind: "coordinator"` and string content, carrying a NEW
 * `promptId` that every later `tool_result` of that run repeats. So the boundary is a CHANGE of
 * `promptId` on a non-tool_result user entry. A harness reminder after the hand-back (string,
 * `isMeta`, no coordinator origin) is not a boundary. Entries with no `promptId` (old fixtures) keep
 * the earlier rule: any non-tool_result user entry, except an `isMeta` one that is not the
 * coordinator's. `state.prompt` is the promptId of the current run.
 */
function startsRun(e: Entry, state: { prompt: string | null }, sawCall: boolean): boolean {
  if (e.type !== "user") return false;
  const content = e.message?.content ?? e.content;
  if (Array.isArray(content) && content.length > 0 && content.every((b) => b && b.type === "tool_result")) {
    return false;
  }
  const opens = e.isMeta !== true || e.origin?.kind === "coordinator";
  if (typeof e.promptId === "string") {
    const changed = e.promptId !== state.prompt && (state.prompt !== null || sawCall);
    state.prompt = e.promptId;
    return changed && opens;
  }
  return opens;
}

/**
 * Hand-back calls of the CURRENT run only (`151`, `153`). With `sinceMs` (this run's dispatch time
 * from the Maestro log) a call whose entry timestamp is older than it, less 1 s of slack, belongs to
 * an earlier run and is ignored even when the resume prompt has not reached the file yet. No
 * `sinceMs`, or no timestamp on the entry, keeps the call, as a first run always did.
 */
function scanHandbacks(transcript: string, sinceMs: number | null = null): { text: string | null; sawCall: boolean } {
  const { text, sawCall } = scanRun(transcript, sinceMs);
  return { text, sawCall };
}

/** Tools that change files: a run with none of these changed nothing. */
const EDIT_TOOLS: readonly string[] = ["Write", "Edit", "MultiEdit", "NotebookEdit"];

/**
 * What the CURRENT run looked like (`153`): `resumed` when an earlier run's hand-back precedes the
 * run boundary, `wroteFiles` when the current run called a file-writing tool. The stop hook uses it
 * to decide a resumed run that only re-verified has no payload to write.
 */
export function runProfile(
  transcript: string,
  sinceMs: number | null = null
): { resumed: boolean; wroteFiles: boolean } {
  const { resumed, wroteFiles } = scanRun(transcript, sinceMs);
  return { resumed, wroteFiles };
}

function scanRun(
  transcript: string,
  sinceMs: number | null
): {
  text: string | null;
  sawCall: boolean;
  resumed: boolean;
  wroteFiles: boolean;
} {
  let found: string | null = null;
  let sawCall = false;
  let resumed = false;
  let wroteFiles = false;
  const state = { prompt: null as string | null };
  for (const line of transcript.split("\n")) {
    const named = HANDBACK_TOOLS.some((t) => line.includes(t));
    const edits = EDIT_TOOLS.some((t) => line.includes(`"${t}"`));
    if (!named && !edits && !line.includes('"user"')) continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    const e = entry as Entry;
    if (!e || typeof e !== "object") continue;
    if (startsRun(e, state, sawCall || resumed)) {
      if (sawCall) resumed = true;
      found = null;
      sawCall = false;
      wroteFiles = false;
      continue;
    }
    if (edits) {
      const c = e?.message?.content ?? e?.content;
      // An edit older than this run's dispatch is an earlier run's, even with no resume prompt yet.
      const editAt = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
      const earlier = sinceMs !== null && !Number.isNaN(editAt) && editAt < sinceMs - DISPATCH_SLACK_MS;
      if (!earlier && Array.isArray(c) && c.some((b) => b && b.type === "tool_use" && EDIT_TOOLS.includes(b.name)))
        wroteFiles = true;
    }
    if (!named) continue;
    const content = e?.message?.content ?? e?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block && block.type === "tool_use" && HANDBACK_TOOLS.includes(block.name)) {
        const at = typeof e.timestamp === "string" ? Date.parse(e.timestamp) : NaN;
        if (sinceMs !== null && !Number.isNaN(at) && at < sinceMs - DISPATCH_SLACK_MS) {
          resumed = true; // an earlier run's hand-back, ahead of this run's dispatch
          continue;
        }
        sawCall = true;
        const text = messageText(block.input);
        if (text) found = text;
      }
    }
  }
  return { text: found, sawCall, resumed, wroteFiles };
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
 * `missing`), when the transcript cannot be read, or after `waitMs`. Only calls after the last
 * non-tool_result user entry count (`151`), so a resumed agent's earlier hand-back never ends the
 * wait and is never returned. `read` returns the
 * transcript text, or null when unreadable; `sleep` is injected so this stays `fs`-free.
 */
export async function awaitHandback(
  read: () => string | null,
  sleep: (ms: number) => Promise<void>,
  waitMs: number = HANDBACK_WAIT_MS,
  pollMs: number = HANDBACK_POLL_MS,
  sinceMs: number | null = null
): Promise<string | null> {
  const attempts = Math.max(1, Math.ceil(waitMs / pollMs) + 1);
  for (let i = 0; i < attempts; i++) {
    const transcript = read();
    if (transcript === null) return null;
    const scan = scanHandbacks(transcript, sinceMs);
    if (scan.sawCall) return scan.text;
    if (i < attempts - 1) await sleep(pollMs);
  }
  return null;
}

/** `078`'s name for `handbackHandoff`, kept because the generated bundle's export surface only grows. */
export const sendMessageHandoff = handbackHandoff;
