// The fork PROVENANCE SIDECAR and the frontmatter arithmetic around it — split out of
// `agent-fork.ts` by `031` so that reading and updating a fork record costs nothing but `fs`.
//
// The split is not cosmetic. `agent-fork.ts` writes three GLOBAL SQLITE STORES on a renamed fork
// (`copyAgentAttributeRows`), so it transitively imports `node:sqlite`; `agent-sync.ts` and the
// generated `lib/maestro-agent-sync.cjs` the `maestro`/`maestro-update` skills call need only the
// sidecar and the hashing, and must keep running under a bare `node` that may predate `node:sqlite`
// entirely. Everything here is fs-and-strings, and `agent-fork.ts` re-exports all of it so existing
// call sites are unchanged.

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { FRONTMATTER } from "./agent-descriptions.js";
import type { AgentForkRecord } from "./contracts.js";

export type { AgentForkRecord };

const AGENT_FORKS_FILENAME = "agent-forks.json";

export function agentForksPath(projectRoot: string): string {
  return path.join(projectRoot, ".claude", AGENT_FORKS_FILENAME);
}

/**
 * The fields every reader of a record dereferences without checking. `agent-forks.json` is a
 * COMMITTED file (only the three ephemeral session files are gitignored), so it reaches this
 * function through merges and hand-edits, and a record missing `templateBody` used to throw a bare
 * `Cannot read properties of undefined` out of `computeAgentSync` — which the app then swallowed
 * in `callMain`, silently taking the whole fork review and the `/maestro` banner with it.
 */
function isUsableRecord(value: unknown): value is AgentForkRecord {
  if (!value || typeof value !== "object") return false;
  const r = value as Record<string, unknown>;
  return (
    typeof r.agentName === "string" &&
    (r.sourceTier === "user" || r.sourceTier === "plugin") &&
    typeof r.templateBody === "string" &&
    typeof r.templateBodyHash === "string"
  );
}

/**
 * Every recorded fork in this project, keyed by the forked agent's own name. Missing file ⇒ {}.
 *
 * Unreadable/unparseable JSON and individually malformed records both degrade to "this agent is
 * not a tracked fork", which is the same thing detaching says and the safest reading of a file
 * this app can no longer interpret: nothing is compared, nothing is offered, and no `.md` is
 * touched. Note that a dropped record does not survive the next `writeAgentForkRecord` — that
 * rewrites the whole object from what was read — so a malformed entry is repaired away rather than
 * carried forever.
 */
export function readAgentForks(projectRoot: string): Record<string, AgentForkRecord> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(agentForksPath(projectRoot), "utf8"));
  } catch {
    return {};
  }
  if (!parsed || typeof parsed !== "object") return {};
  const out: Record<string, AgentForkRecord> = {};
  for (const [name, record] of Object.entries(parsed as Record<string, unknown>)) {
    if (isUsableRecord(record)) out[name] = record;
  }
  return out;
}

function writeAllForks(projectRoot: string, all: Record<string, AgentForkRecord>): void {
  const file = agentForksPath(projectRoot);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(all, null, 2) + "\n", "utf8");
}

/**
 * Add or replace one provenance record. Exported for `agent-sync.ts`'s update/keep actions, which
 * re-stamp what a fork is tracking without going anywhere near `forkAgent` — the sidecar has one
 * writer, and this is it.
 */
export function writeAgentForkRecord(projectRoot: string, record: AgentForkRecord): void {
  const all = readAgentForks(projectRoot);
  all[record.agentName] = record;
  writeAllForks(projectRoot, all);
}

/**
 * DETACH: drop one agent's provenance record and nothing else. The `.md` stays exactly where it
 * is — this is a statement about ownership, not a deletion. Afterwards the agent is an ordinary
 * project agent that no sync will ever look at again, which is `decideSync`'s `detached` verdict
 * arrived at by the user rather than by `saveProjectReportOverride`.
 */
export function removeAgentFork(projectRoot: string, agentName: string): boolean {
  const all = readAgentForks(projectRoot);
  if (!(agentName in all)) return false;
  delete all[agentName];
  writeAllForks(projectRoot, all);
  return true;
}

/** The frontmatter block's lines plus the untouched body after it. Null when there is no block. */
function splitFrontmatter(contents: string): { lines: string[]; body: string } | null {
  const match = contents.match(FRONTMATTER);
  if (!match) return null;
  return { lines: match[1].split("\n"), body: contents.slice(match[0].length) };
}

function joinFrontmatter(lines: string[], body: string): string {
  return `---\n${lines.join("\n")}\n---` + body;
}

/**
 * The span of one frontmatter key: its own line plus any continuation lines indented under it.
 * `parseFrontmatter` has no notion of depth, but a hand-written agent file may still wrap a long
 * `description:` across lines, and taking only the first would leave the rest dangling.
 */
function fieldSpan(lines: string[], key: string): { start: number; end: number } | null {
  const start = lines.findIndex((l) => new RegExp(`^${key}\\s*:`).test(l));
  if (start === -1) return null;
  let end = start + 1;
  while (end < lines.length && lines[end].trim() !== "" && /^\s/.test(lines[end])) end++;
  return { start, end };
}

/**
 * The bytes a fork's baseline hash is taken over: the file with its `name:` and `description:`
 * frontmatter lines (and any continuation lines directly under them) removed, then the untouched
 * body.
 *
 * BOTH of those fields are EXPECTED to diverge from the template, which is the whole reason a fork
 * is worth having:
 *
 *   - the `description:` is the one thing this app itself lets a global-tier agent's card edit
 *     after a fork (`029`), and
 *   - the `name:` is rewritten by `forkAgent` itself on a RENAMED fork.
 *
 * Hashing either would mark a fork as user-modified the moment it was created or first edited, and
 * `031`'s refresh branch would then never fire for anybody — every fork would sit permanently in
 * `staleCustomized`. The `name:` half is `031`'s correction to `029`, which stripped only the
 * description and so reported every renamed fork as diverged from birth. Pin this normalisation
 * with a test; it is the one part of the hash that is not obvious from reading the ticket later.
 */
export function bodyForHashing(contents: string): string {
  const split = splitFrontmatter(contents);
  if (!split) return contents;
  let { lines } = split;
  // Descending order, so removing one span cannot shift the other's indices.
  const spans = [fieldSpan(lines, "name"), fieldSpan(lines, "description")]
    .filter((s): s is { start: number; end: number } => s !== null)
    .sort((a, b) => b.start - a.start);
  if (spans.length === 0) return contents;
  for (const span of spans) lines = [...lines.slice(0, span.start), ...lines.slice(span.end)];
  return joinFrontmatter(lines, split.body);
}

export function hashAgentBody(contents: string): string {
  return createHash("sha256").update(bodyForHashing(contents)).digest("hex");
}

/**
 * What "take the new body, keep my description" actually writes (`031`): the template's current
 * contents with the FORK's own `name:` and `description:` lines carried over verbatim.
 *
 * Verbatim, rather than re-quoted through `replaceDescriptionInFrontmatter`, because the fork's
 * description is already a line that round-trips — it came out of a file — and re-serialising it
 * would rewrite quoting the user chose. It is exactly the inverse of `bodyForHashing`: the two
 * fields that hash out are the two fields that carry over.
 *
 * A template with no frontmatter is returned unchanged; there is nowhere to put the fields, and
 * refusing would block a refresh over a file this app never wrote.
 */
export function mergeForkBody(templateContents: string, forkContents: string): string {
  const template = splitFrontmatter(templateContents);
  const fork = splitFrontmatter(forkContents);
  if (!template || !fork) return templateContents;

  let lines = template.lines;
  for (const key of ["description", "name"] as const) {
    const from = fieldSpan(fork.lines, key);
    if (!from) continue;
    const kept = fork.lines.slice(from.start, from.end);
    const to = fieldSpan(lines, key);
    if (to) lines = [...lines.slice(0, to.start), ...kept, ...lines.slice(to.end)];
    else if (key === "name") lines = [...kept, ...lines];
    else {
      // No description on the template: put it directly after `name:`, where every file this app
      // writes has it — the same placement `replaceDescriptionInFrontmatter` chooses.
      const afterName = fieldSpan(lines, "name");
      const at = afterName ? afterName.end : lines.length;
      lines = [...lines.slice(0, at), ...kept, ...lines.slice(at)];
    }
  }
  return joinFrontmatter(lines, template.body);
}

/**
 * Rewrite the frontmatter `name:` line to `name`, leaving everything else — including the
 * `description:` line — byte-identical. Only used for a RENAMED fork; a same-name fork copies the
 * template's bytes untouched, which is what the acceptance criterion means by "byte-for-byte".
 */
export function renameAgentInFrontmatter(contents: string, name: string): string {
  const split = splitFrontmatter(contents);
  if (!split) throw new Error("This agent's file has no frontmatter block to rename.");
  const span = fieldSpan(split.lines, "name");
  if (!span) throw new Error("This agent's frontmatter has no name: line to rename.");
  const lines = [...split.lines];
  lines[span.start] = `name: ${name}`;
  return joinFrontmatter(lines, split.body);
}
