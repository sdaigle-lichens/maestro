// What the pane may pick up from the CLI's own session store, and what it has to SAY first (`025`).
//
// The sixth pure module beside the four scope ones and the budget. It reads nothing — `fs` is
// `agent-sdk.ts`'s, which asks the SDK for the store rather than walking `~/.claude/projects`
// itself — and it decides nothing about permissions. What it owns is the two judgements a picker
// needs and every sentence it says:
//
//   • WHICH conversations may be offered, which is a filter on the store's own answer rather than a
//     search: `cwd` must be the open project, and the pane's own live conversation is not a thing to
//     resume (Continue is that door, and resuming your own live session would fork it beside itself).
//
//   • WHAT the user is shown before they commit. This is the disclosure `025` exists for and the one
//     that is easy to skip. A resumed transcript was produced under THE TERMINAL SESSION'S rules —
//     any tools, any permission mode, possibly with permissions skipped entirely — so it can already
//     contain the contents of files from anywhere on disk. The pane's boundary applies going FORWARD
//     only. Without this list, "this session cannot leave the selected directory" is true of every
//     future turn and quietly false of the context it starts with, and the guarantee reads as intact
//     while a hole sits underneath it.
//
// MEASURED, AND THE MEASUREMENTS ARE WHY THIS FILE IS SHAPED LIKE THIS (probe A and B, `025`):
//
//   • A resume does NOT restore the recorded session's `settingSources`. A custom project-tier slash
//     command present in the terminal session's `slash_commands` was absent from the resumed one, so
//     `settingSources: []` holds across a resume — no permissions widening, and no settings-file
//     `ANTHROPIC_API_KEY` redirecting the bill off the subscription.
//   • A resume does NOT restore the recorded session's working directory or its readable set. The
//     resuming query's `cwd` is what `init` reports, and a `Read` of the RECORDED session's own cwd
//     reached `canUseTool` — it was asked about, not waved through.
//   • `forkSession: true` leaves the original transcript byte-identical and writes the fork into the
//     PANE's project directory. That is the whole of "the terminal session's history is not written".
//   • And the reason the disclosure is not optional: the resumed conversation answered a question
//     about a file's contents with NO tool call at all. The bytes were already in the transcript.

import path from "node:path";
import { withinDirectory } from "./read-scope.js";
import { boundaryTargetOf } from "./session-scope.js";
import { formatUsd } from "./session-budget.js";
import type { ResumableSession, ResumeDisclosure, ResumeRead } from "./contracts.js";

/**
 * One row of the CLI's session store, in the shape this module reads it.
 *
 * Declared here rather than imported from the SDK for the reason `CanUseToolOptions` is declared in
 * `agent-sdk.ts`: this module must stay importable by anything, and the SDK is one module's
 * dependency. Every field is optional because the store's older entries do not all carry them.
 */
export interface StoredSession {
  sessionId: string;
  summary?: string | null;
  customTitle?: string | null;
  firstPrompt?: string | null;
  gitBranch?: string | null;
  cwd?: string | null;
  lastModified?: number | null;
  createdAt?: number | null;
  fileSize?: number | null;
}

/**
 * One message out of a stored transcript. The `message` is the model API's own shape and is walked
 * DEFENSIVELY — it is a record someone else wrote, not a payload this app typed.
 */
export interface StoredMessage {
  type: string;
  message: unknown;
}

/** How many conversations the picker offers. Enough to find last week's, few enough to read. */
export const RESUME_LIST_LIMIT = 15;

/** How many read paths the disclosure lists before it starts counting instead. */
export const RESUME_READ_CAP = 30;

/**
 * The rate the replay estimate is quoted at, in USD per million input tokens.
 *
 * NAMED IN THE SENTENCE IT PRODUCES, because it is an assumption and not a fact: the pane's model is
 * selectable, and the same transcript costs several times this on a larger one. A figure with the
 * rate stated is a figure the user can correct; a bare dollar amount is one they would trust.
 */
export const REPLAY_USD_PER_MTOK = 3;

/** The crude tokens-per-character the estimate uses. Four is the usual English approximation. */
export const CHARS_PER_TOKEN = 4;

/**
 * Which stored conversations this project may be offered, newest first.
 *
 * A FILTER, NOT A SEARCH. The store is asked for one project directory and this drops what does not
 * belong: the `cwd` check is what makes "sessions belonging to other projects are not offered" true
 * rather than merely likely — the store keys projects by a slug that flattens every `/` to `-`, so
 * `/home/a-b` and `/home/a/b` land in the same directory, and a git worktree of this project is a
 * different directory whose sessions were produced somewhere the pane's boundary does not reach.
 *
 * `exclude` is the ids this window's own session already holds — its live conversation and any
 * exhausted entry kept for Continue. Resuming your own live session would fork it beside itself and
 * leave two panes' worth of conversation with one transcript on screen.
 */
export function resumableFrom(
  stored: readonly StoredSession[],
  { projectRoot, exclude = [] }: { projectRoot: string; exclude?: readonly string[] }
): ResumableSession[] {
  if (!projectRoot) return [];
  const skip = new Set(exclude.filter(Boolean));
  const rows: ResumableSession[] = [];

  for (const row of stored) {
    const id = typeof row?.sessionId === "string" ? row.sessionId : "";
    if (!id || skip.has(id)) continue;
    const cwd = typeof row.cwd === "string" ? row.cwd : "";
    // Equality, not containment. A session run in a SUBDIRECTORY of the project is a session whose
    // relative paths mean something else, and offering it would be offering a conversation whose
    // every unqualified filename resolves somewhere the pane would not look.
    if (path.resolve(cwd) !== path.resolve(projectRoot)) continue;

    const summary = firstText(row.customTitle, row.summary, row.firstPrompt) ?? "Untitled conversation";
    const firstPrompt = firstText(row.firstPrompt);
    rows.push({
      id,
      summary,
      // Never the same string twice: when the store had no title of its own it already fell back to
      // the first prompt above, and a row showing one sentence in both places reads as two facts.
      firstPrompt: firstPrompt && firstPrompt !== summary ? firstPrompt : null,
      branch: firstText(row.gitBranch),
      cwd: path.resolve(cwd),
      lastModified: Number.isFinite(row.lastModified) ? Number(row.lastModified) : 0,
      createdAt: Number.isFinite(row.createdAt) ? Number(row.createdAt) : null,
      sizeBytes: Number.isFinite(row.fileSize) ? Math.max(0, Number(row.fileSize)) : 0,
    });
  }

  rows.sort((a, b) => b.lastModified - a.lastModified);
  return rows.slice(0, RESUME_LIST_LIMIT);
}

/** The first of these that is a non-empty string, trimmed. */
function firstText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

/**
 * What one stored transcript already read, and how much of it will be replayed.
 *
 * `directories` is what the PANE session may read — the open project and the app's own additions —
 * so `inScope` answers "would today's boundary have allowed this", which is the question that makes
 * the list worth reading. `cwd` is the RECORDED session's, because that is what its relative paths
 * resolved against.
 */
export function resumeDisclosure({
  session,
  messages,
  directories,
}: {
  session: ResumableSession;
  messages: readonly StoredMessage[];
  directories: readonly string[];
}): ResumeDisclosure {
  const seen = new Map<string, ResumeRead>();
  let chars = 0;
  let capped = 0;

  for (const entry of messages) {
    for (const block of contentBlocks(entry?.message)) {
      chars += textLengthOf(block);
      if (block?.type !== "tool_use") continue;
      const tool = typeof block.name === "string" ? block.name : "";
      const input = isRecord(block.input) ? block.input : {};
      const { base, pattern } = boundaryTargetOf(tool, input);
      // The pattern half of a Glob/Grep only ever comes back when it ESCAPES (see
      // `boundaryTargetOf`), so a search that climbed out of its base is disclosed as its own line
      // rather than hidden behind the directory it was rooted at.
      for (const target of [base, pattern]) {
        if (!target) continue;
        const absolute = path.resolve(session.cwd, target);
        if (seen.has(absolute)) continue;
        if (seen.size >= RESUME_READ_CAP) {
          capped += 1;
          continue;
        }
        seen.set(absolute, {
          path: absolute,
          tool: tool || "a tool",
          inScope: directories.some((dir) => withinDirectory(dir, absolute)),
        });
      }
    }
  }

  const reads = [...seen.values()].sort((a, b) => Number(a.inScope) - Number(b.inScope));
  const outside = reads.filter((r) => !r.inScope).length;
  const replayTokens = Math.max(0, Math.round(chars / CHARS_PER_TOKEN));
  const replayUsd = (replayTokens / 1_000_000) * REPLAY_USD_PER_MTOK;

  return {
    session,
    messages: messages.length,
    reads,
    more: capped,
    outside,
    replayTokens,
    replayUsd,
    replayNote: replayNote(messages.length, replayTokens, replayUsd),
    readNote: readNote(reads.length, outside, capped),
    scopeNote: RESUME_SCOPE_NOTE,
  };
}

/** The content blocks of a stored message, whatever shape the record turned out to be. */
function contentBlocks(message: unknown): Array<Record<string, unknown>> {
  if (!isRecord(message)) return [];
  const content = message.content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content.filter(isRecord);
}

/** How much text one block puts back in front of the model. Tool results are most of a transcript. */
function textLengthOf(block: Record<string, unknown>): number {
  if (typeof block.text === "string") return block.text.length;
  if (typeof block.content === "string") return block.content.length;
  if (block.type === "tool_use" && block.input !== undefined) return JSON.stringify(block.input ?? "").length;
  if (Array.isArray(block.content)) {
    return block.content.reduce((sum: number, part: unknown) => sum + (isRecord(part) ? textLengthOf(part) : 0), 0);
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * What replaying this transcript costs, said before the user commits to it.
 *
 * A LONG CONVERSATION IS NOT FREE TO PICK UP: the whole of it is replayed as input on the first
 * turn, uncached, and the pane's ceiling is measured against the result. `024` supplies the register
 * this is written in — `formatUsd`, and the standing insistence that the figure is an estimate — and
 * the rate is named because it is the assumption the estimate rests on.
 */
export function replayNote(messages: number, tokens: number, usd: number): string {
  return (
    `Resuming replays the whole conversation as context on the first turn: ${messages} message` +
    `${messages === 1 ? "" : "s"}, roughly ${formatTokens(tokens)} tokens, about ${formatUsd(usd)} at ` +
    `$${REPLAY_USD_PER_MTOK}/M input tokens. An estimate, not a bill — a larger model costs several times ` +
    `it — and it is spent against this session's ceiling the moment you send anything.`
  );
}

/** Tokens, rounded the way a person reads them. */
export function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}k`;
  return String(tokens);
}

/**
 * The sentence about what the transcript already carries.
 *
 * IT SAYS WHAT THIS LIST CANNOT SEE, and that is not hedging. The list is built from the transcript's
 * own tool calls, so it enumerates what the session went and read; a conversation can also carry file
 * contents that were attached, pasted or auto-loaded, and no walk of the recorded tool calls will
 * find those. A disclosure that implied completeness would be worse than one that admits its edge.
 */
export function readNote(listed: number, outside: number, more: number): string {
  const head =
    listed === 0
      ? "This conversation's own tool calls read no files."
      : `This conversation already read ${listed} path${listed === 1 ? "" : "s"}` +
        `${more > 0 ? ` (and ${more} more, not listed)` : ""}` +
        `${outside > 0 ? `, ${outside} of them outside what this session may read` : ""}.`;
  return (
    `${head} Their contents are already in the transcript, and resuming puts them back in front of the ` +
    `model — the boundary applies to what happens NEXT, not to what is already there. The list is built ` +
    `from the tool calls the transcript recorded; a conversation can also carry text that was attached ` +
    `or pasted, which nothing here can enumerate.`
  );
}

/**
 * What does NOT come across, said next to what does.
 *
 * A resumed session starting with no grants is CORRECT rather than an omission: grants live on
 * main's per-window entry, die with it on every teardown path, and are written nowhere — so there is
 * nothing on disk for a resume to restore. The consequence is the useful half, and it belongs beside
 * the read list because it is the same set of paths: what the terminal session read freely is
 * exactly what the pane will now start asking about.
 */
export const RESUME_SCOPE_NOTE =
  "Nothing about the old session's permissions comes across. It starts with no grants and nothing " +
  "writable, reads only what this pane's session reads, and loads no settings files — measured: a " +
  "resume honours the directories and the settings sources this app passes, not the ones the recorded " +
  "session ran under. A path that conversation read freely will raise a prompt here.";

/**
 * What the transcript says when a foreign conversation is picked up.
 *
 * Written here for the reason every other sentence in the pane is: main composes no prose, and a
 * notice the user reads has to come from the same place as the disclosure they agreed to.
 */
export function resumedNotice(session: ResumableSession, disclosure: ResumeDisclosure | null): string {
  const when = new Date(session.lastModified || Date.now()).toISOString().slice(0, 16).replace("T", " ");
  return (
    `Resumed "${session.summary}" (last active ${when}${session.branch ? `, branch ${session.branch}` : ""}). ` +
    `The conversation was FORKED: this session writes to a copy, and the original transcript is untouched, ` +
    `so the terminal session you started it in still has its own history. ` +
    `${disclosure ? `${disclosure.replayNote} ` : ""}` +
    `Everything above the fork happened under that session's rules; from here it runs under this pane's — ` +
    `${RESUME_SCOPE_NOTE.slice(0, 1).toLowerCase()}${RESUME_SCOPE_NOTE.slice(1)}`
  );
}
