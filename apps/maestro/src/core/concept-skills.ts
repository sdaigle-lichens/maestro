// Concept skills — the node side.
//
// A "concept skill" is an ordinary `.claude/skills/<id>/SKILL.md` whose frontmatter `metadata:` map
// says it explains one of the project's CORE concepts, and how fresh that explanation is:
//
//   metadata:
//     type: concept-skill
//     version: "1.0"
//     last-update: <commit sha>
//
// `metadata` is where this belongs and inventing top-level keys is actively wrong, for a reason
// that is not obvious from Claude Code alone. Claude Code accepts every field in its own table and
// deliberately does not act on `metadata`'s contents — the docs describe it as "free-form YAML map
// for your own key-value data ... read by your own tooling". But `metadata` is also one of only SIX
// fields that survive the OTHER distribution paths (claude.ai skill uploads, the Skills API, and
// packaging with `package_skill.py`: `allowed-tools, compatibility, description, license, metadata,
// name`), and those paths reject an unknown key with a HARD ERROR rather than ignoring it. A
// concept skill carrying `concept-version:` at the top level loads fine here and fails to package,
// which is the worst place to find out.
//
// It must be read with `parseFrontmatterMetadata`, never off `parseFrontmatter`. That reader has no
// notion of depth — it splits each line on the first `:` — so a `metadata:` block does not fail, it
// FLATTENS into top-level keys, and `metadata.version` becomes indistinguishable from a top-level
// `version`. It happens to yield the right values today, which is exactly why relying on it is a
// trap: it would keep working until someone adds a second nested block.
//
// `type: concept-skill` is the discriminator; the other two only mean anything alongside it.
//
// The version is `major.minor` and the two bumps mean different amounts of work:
//   - `/create-concept-skills` writes 1.0        — a skeleton, never deeply researched
//   - `/update-concept-skills` bumps the MINOR   — reconciled against a diff, still shallow
//   - `/update-single-concept-skill` bumps MAJOR — one concept, actually explored
// So a skill still at `x.0` has never had a deep pass, which is exactly what the single-skill flow
// reads to decide how hard to search.

import fs from "node:fs";
import path from "node:path";
import { parseFrontmatterMetadata, readSkillEntriesFromDir } from "@repo/claude-fs";
import { readConfig } from "./config.js";
import { skillSearchDirs } from "./fs-scan.js";
import type { MaestroConceptSkillsState } from "./types.js";

/** The `metadata:` keys. `TYPE_KEY` must equal `CONCEPT_TYPE` for a skill to count as one. */
export const TYPE_KEY = "type";
export const CONCEPT_TYPE = "concept-skill";
export const VERSION_KEY = "version";
export const LAST_UPDATE_KEY = "last-update";

/** What `/create-concept-skills` stamps on a brand-new skill and on a brand-new list. */
export const INITIAL_VERSION = "1.0";

/** A skill's referenced-file subdirectories. `agents/` is written by the single-skill flow only. */
export const SUB_CONCEPTS_DIR = "sub-concepts";
export const AGENT_NOTES_DIR = "agents";

export interface ConceptSkill {
  /** Frontmatter `name`, falling back to the directory name. */
  id: string;
  /** The skill's own directory. */
  dir: string;
  /** `<dir>/SKILL.md`. */
  skillPath: string;
  description: string;
  /** `major.minor`. `INITIAL_VERSION` when the key is missing or unparseable. */
  version: string;
  /** The commit this skill was last reconciled against; `""` when never stamped. */
  lastUpdate: string;
  /** Filenames under `sub-concepts/`, sorted. */
  subConcepts: string[];
  /** Filenames under `agents/`, sorted. */
  agentNotes: string[];
}

// ---------------------------------------------------------------------------
// Version arithmetic
// ---------------------------------------------------------------------------

/** Parse `major.minor`. Anything unparseable reads as 1.0 rather than throwing — a hand-edited or
 *  missing version must never be able to stop a scan of the whole repo. */
export function parseVersion(v: string | undefined): { major: number; minor: number } {
  const m = /^\s*(\d+)\.(\d+)\s*$/.exec(v ?? "");
  if (!m) return { major: 1, minor: 0 };
  return { major: Number(m[1]), minor: Number(m[2]) };
}

export function formatVersion(v: { major: number; minor: number }): string {
  return `${v.major}.${v.minor}`;
}

export function bumpMinor(v: string | undefined): string {
  const { major, minor } = parseVersion(v);
  return formatVersion({ major, minor: minor + 1 });
}

export function bumpMajor(v: string | undefined): string {
  const { major } = parseVersion(v);
  return formatVersion({ major: major + 1, minor: 0 });
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

function listDir(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .sort();
  } catch {
    return [];
  }
}

/**
 * Every concept skill under `root`, from EVERY `.claude/skills` in the tree — not just the root's.
 * In a monorepo a concept skill lives beside the code it explains, so a single-directory read
 * (what `discoverSkills` does) would miss most of them.
 *
 * Ordered by path, so two runs over an unchanged tree report the same list.
 */
export async function discoverConceptSkills(root: string): Promise<ConceptSkill[]> {
  const out: ConceptSkill[] = [];
  for (const skillsDir of skillSearchDirs(root)) {
    for (const entry of await readSkillEntriesFromDir(skillsDir)) {
      if (entry.metadata[TYPE_KEY] !== CONCEPT_TYPE) continue;
      out.push({
        id: entry.id,
        dir: entry.dir,
        skillPath: entry.skillPath,
        description: entry.frontmatter.description ?? "",
        version: formatVersion(parseVersion(entry.metadata[VERSION_KEY])),
        lastUpdate: entry.metadata[LAST_UPDATE_KEY] ?? "",
        subConcepts: listDir(path.join(entry.dir, SUB_CONCEPTS_DIR)),
        agentNotes: listDir(path.join(entry.dir, AGENT_NOTES_DIR)),
      });
    }
  }
  return out.sort((a, b) => a.skillPath.localeCompare(b.skillPath));
}

/** Find one concept skill by id or by directory path. Null when it isn't one (or isn't there). */
export async function findConceptSkill(root: string, idOrPath: string): Promise<ConceptSkill | null> {
  const target = path.resolve(root, idOrPath);
  const all = await discoverConceptSkills(root);
  return all.find((s) => s.id === idOrPath || s.dir === target || s.skillPath === target) ?? null;
}

/**
 * The `SKILL.md` of ANY skill in the tree — marked or not — by id, directory or file path.
 *
 * `findConceptSkill` deliberately only sees skills that already carry the marker, which makes it
 * useless for the create flow's commonest call: stamping a skill that was written thirty seconds
 * ago and is not a concept skill *yet*. Resolving the id as a relative path instead is the obvious
 * shortcut and is wrong — it silently produces `<root>/<id>` and fails on a file that was never
 * going to be there.
 *
 * Null when nothing matches, so the caller can say which id it couldn't find.
 */
export async function resolveSkillPath(root: string, idOrPath: string): Promise<string | null> {
  const target = path.resolve(root, idOrPath);
  if (fs.existsSync(target)) {
    const asDir = path.join(target, "SKILL.md");
    if (fs.existsSync(asDir)) return asDir;
    if (fs.statSync(target).isFile()) return target;
  }
  for (const skillsDir of skillSearchDirs(root)) {
    // Directory name first — it is what the create flow just wrote — then the frontmatter `name`,
    // which is what a user reading `list` output will type.
    const byDir = path.join(skillsDir, idOrPath, "SKILL.md");
    if (fs.existsSync(byDir)) return byDir;
    const match = (await readSkillEntriesFromDir(skillsDir)).find((e) => e.id === idOrPath);
    if (match) return match.skillPath;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Stamping a skill
// ---------------------------------------------------------------------------

const FRONTMATTER_RE = /^(---\s*\r?\n)([\s\S]*?)(\r?\n---)/;

const DEFAULT_INDENT = "  ";

/** Where the `metadata:` map is in a frontmatter line list, and how its children are indented. */
function locateMetadata(lines: string[]): { start: number; end: number; indent: string } | null {
  const start = lines.findIndex((l) => /^metadata\s*:/.test(l));
  if (start === -1) return null;
  // An inline flow map (`metadata: { ... }`) or a scalar has no block to edit line-by-line; the
  // caller rewrites the whole map instead of trying to patch one key inside a single line.
  if (lines[start].slice(lines[start].indexOf(":") + 1).trim()) return null;

  let end = start + 1;
  let indent = DEFAULT_INDENT;
  let seen = false;
  for (; end < lines.length; end++) {
    if (!lines[end].trim()) continue;
    if (!/^\s/.test(lines[end])) break;
    if (!seen) {
      indent = /^(\s+)/.exec(lines[end])![1];
      seen = true;
    }
  }
  return { start, end, indent };
}

function setIn(lines: string[], indent: string, key: string, value: string): string[] {
  const rendered = `${indent}${key}: ${value}`;
  const idx = lines.findIndex((l) => l.includes(":") && l.slice(0, l.indexOf(":")).trim() === key);
  if (idx === -1) return [...lines, rendered];
  const next = [...lines];
  next[idx] = rendered;
  return next;
}

/**
 * Rewrite a SKILL.md's `metadata:` markers IN PLACE, creating the block when it has none.
 *
 * A line rewrite, never a re-serialize: the description of a real concept skill is a long quoted
 * sentence and the body is the whole point of the file, so round-tripping either through a YAML
 * emitter and a markdown renderer would churn the diff on every stamp and eventually lose
 * something. Every other frontmatter line, and the entire body, come out byte-identical.
 *
 * An existing `metadata:` map is edited in place and keeps its own indentation and any keys that
 * are not ours — it is the user's map and this feature is one tenant in it. A map written inline
 * (`metadata: { ... }`) is rewritten as a block, which is the one case where a line is not
 * preserved; patching a key inside a flow mapping by hand is where a YAML rewriter earns its keep,
 * and this is not one.
 *
 * Throws when the file has no frontmatter block — a SKILL.md without one is not a skill, and
 * silently prepending one would hide a wrong path.
 */
export function stampConceptSkill(skillPath: string, next: { version: string; lastUpdate: string }): void {
  const raw = fs.readFileSync(skillPath, "utf8");
  const match = FRONTMATTER_RE.exec(raw);
  if (!match) throw new Error(`no frontmatter block in ${skillPath}`);

  const lines = match[2].split(/\r?\n/);
  const found = locateMetadata(lines);

  let rebuiltLines: string[];
  if (found) {
    let body = lines.slice(found.start + 1, found.end);
    body = setIn(body, found.indent, TYPE_KEY, CONCEPT_TYPE);
    body = setIn(body, found.indent, VERSION_KEY, `"${next.version}"`);
    body = setIn(body, found.indent, LAST_UPDATE_KEY, next.lastUpdate);
    rebuiltLines = [...lines.slice(0, found.start + 1), ...body, ...lines.slice(found.end)];
  } else {
    // No block, or one written inline/as a scalar: drop any such line and append a fresh block,
    // carrying over whatever the inline form held so nothing the user wrote is lost.
    const carried = parseFrontmatterMetadata(raw);
    const kept = lines.filter((l) => !/^metadata\s*:/.test(l));
    const merged: Record<string, string> = {
      ...carried,
      [TYPE_KEY]: CONCEPT_TYPE,
      [VERSION_KEY]: `"${next.version}"`,
      [LAST_UPDATE_KEY]: next.lastUpdate,
    };
    rebuiltLines = [
      ...kept,
      "metadata:",
      ...Object.entries(merged).map(([k, v]) => `${DEFAULT_INDENT}${k}: ${v}`),
    ];
  }

  const rebuilt = `${match[1]}${rebuiltLines.join("\n")}${match[3]}`;
  fs.writeFileSync(skillPath, raw.slice(0, match.index) + rebuilt + raw.slice(match.index + match[0].length));
}

// ---------------------------------------------------------------------------
// The repo-level state: <root>/.claude/concept-skills.json
// ---------------------------------------------------------------------------
//
// Its own file, deliberately NOT a block on `maestro.json`. Concept skills are an ordinary
// `.claude/skills` convention — a repo can have them, and keep them reconciled, with Maestro
// nowhere in sight. Hanging their state off Maestro's config meant `state-set` reported
// `written:false` for exactly those repos and the list's freshness went unrecorded, which is the
// one thing `/update-concept-skills` needs in order to diff forward instead of re-reading
// everything.
//
// Machine-owned, like `runtimeVersion`: written only by `maestro-concept-skills.cjs` on behalf of
// the create/update flows. Committed, not ignored — `last_update` is a statement about the repo's
// history, so it has to mean the same thing on every clone.
//
// Unlike `maestro.json` this file has no legacy on-disk format to preserve, so it is written with
// a trailing newline.

/** `<root>/.claude/concept-skills.json`. */
export function conceptSkillsJsonPath(projectRoot: string): string {
  return path.join(projectRoot, ".claude", "concept-skills.json");
}

/**
 * The recorded state, or null when no list has been created yet.
 *
 * A missing, unreadable or malformed file all read as null — "no list recorded". That is the same
 * answer the create flow acts on, and it is the safe one: the worst case is that
 * `/update-concept-skills` has to ask for its diff window instead of reading it.
 */
export function readConceptSkillsState(projectRoot: string): MaestroConceptSkillsState | null {
  const p = conceptSkillsJsonPath(projectRoot);
  if (!fs.existsSync(p)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { version, last_update } = parsed as Partial<MaestroConceptSkillsState>;
  if (typeof version !== "string" || typeof last_update !== "string") return null;
  return { version, last_update };
}

/**
 * The project's `agents_available` from `maestro.json`, or `[]` when it has no `maestro.json`.
 *
 * This is the one place the concept-skill flows still read Maestro's config, because there is no
 * other source for the list of agents a project runs. It degrades to the right answer:
 * `/update-single-concept-skill` writes an `agents/<agent>.md` note only for an agent in this list,
 * so an empty answer means "write none", which is exactly right for a project without Maestro.
 *
 * It lives here rather than as an inline `node -e` in the skill so that the project root is
 * resolved ONCE, by the caller that already knows how (env, `--root`, then cwd); an inline script
 * reaching for `process.env.CLAUDE_PROJECT_DIR` alone reads `undefined/.claude/…` when the variable
 * is unset, catches its own error, and reports no agents rather than failing.
 */
export function readAgentsAvailable(projectRoot: string): string[] {
  return readConfig(projectRoot)?.agents_available ?? [];
}

/**
 * Write the state file, creating `.claude/` and the file itself if they are absent.
 *
 * Returns false and writes nothing only when the value is already what it would write, so a
 * re-stamp of an unchanged list costs one read and zero writes — and shows no diff.
 */
export function writeConceptSkillsState(
  projectRoot: string,
  next: MaestroConceptSkillsState
): boolean {
  const cur = readConceptSkillsState(projectRoot);
  if (cur && cur.version === next.version && cur.last_update === next.last_update) return false;
  const claudeDir = path.join(projectRoot, ".claude");
  if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true });
  fs.writeFileSync(conceptSkillsJsonPath(projectRoot), JSON.stringify(next, null, 2) + "\n");
  return true;
}
