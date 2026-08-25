// Skill tags: a user's manual backend|frontend|mobile|refactor|reviewer|scribe|test annotation on
// a skill, stored once per skill id and shared across every project.
//
// Global, not per-project — confirmed with the user: a skill from a marketplace is the same skill
// wherever it's used, so tagging it once should tag it everywhere, rather than re-tagging the same
// skill id in every project that references it.
//
// Backed by `node:sqlite` rather than another JSON file under `.claude/`. This is the one thing
// the app keeps in a database: reads/writes are per-tag rows, not a single blob that a concurrent
// edit could clobber, and `node:sqlite` ships in Node itself (stable enough on Electron's bundled
// Node — verified: `require('node:sqlite')` loads with only the standard experimental-feature
// warning) — so this needs no native module and no Electron-rebuild step, unlike `better-sqlite3`.
//
// `skillMapFromTags` is the pure half: no db, no fs, just tags → SkillMap. It's what both seed
// paths (the app's `data:workflows`/`data:reseed`, and `/maestro-install`'s terminal path via the
// generated `maestro-skill-tags.cjs`) converge on, so "tag a skill, it lands in the right agent's
// referenced_skills" is one function's behaviour, not two.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SKILL_TAGS, type SkillTag } from "./contracts.js";
import type { SkillMap } from "./seed.js";

/** `~/.claude/maestro-skill-tags.sqlite` — one store, every project on this machine. */
export const DEFAULT_SKILL_TAGS_DB_PATH = path.join(os.homedir(), ".claude", "maestro-skill-tags.sqlite");

function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_tags (
      skill_id TEXT NOT NULL,
      tag      TEXT NOT NULL,
      PRIMARY KEY (skill_id, tag)
    )
  `);
  return db;
}

/** Every tagged skill in the store, keyed by skill id. Untagged skills are simply absent. */
export function readAllSkillTags(dbPath: string = DEFAULT_SKILL_TAGS_DB_PATH): Record<string, SkillTag[]> {
  const db = openDb(dbPath);
  try {
    const rows = db.prepare("SELECT skill_id, tag FROM skill_tags ORDER BY skill_id, tag").all() as Array<{
      skill_id: string;
      tag: string;
    }>;
    const out: Record<string, SkillTag[]> = {};
    for (const row of rows) {
      (out[row.skill_id] ??= []).push(row.tag as SkillTag);
    }
    return out;
  } finally {
    db.close();
  }
}

/** Replace-all: `skillId`'s tags become exactly `tags` (deduped), in one transaction. */
export function setSkillTags(
  skillId: string,
  tags: SkillTag[],
  dbPath: string = DEFAULT_SKILL_TAGS_DB_PATH
): SkillTag[] {
  const clean = Array.from(new Set(tags)).sort();
  const db = openDb(dbPath);
  try {
    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM skill_tags WHERE skill_id = ?").run(skillId);
      const insert = db.prepare("INSERT INTO skill_tags (skill_id, tag) VALUES (?, ?)");
      for (const tag of clean) insert.run(skillId, tag);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
    return clean;
  } finally {
    db.close();
  }
}

/**
 * Tags → `SkillMap`, deterministically — no inference, because a tag IS the name of the agent it
 * belongs to.
 *
 * Pure: no db, no fs. `skillIds` bounds the result to skills that actually exist right now, so a
 * stale tag left over from a renamed/removed skill (or one that happens to share an id with a
 * skill tagged in an unrelated project — the global store's one real trade-off) never produces a
 * dangling reference in a seeded `referenced_skills` list. `knownAgents` bounds it the other way:
 * a tag that isn't one of this seed's agents (e.g. "mobile" on a backend-only repo) is simply not
 * a route anywhere, and is silently dropped rather than invented into a new agent.
 */
export function skillMapFromTags(
  tagsBySkill: Record<string, SkillTag[]>,
  skillIds: string[],
  knownAgents: string[]
): SkillMap {
  const knownAgentSet = new Set(knownAgents);
  const skillIdSet = new Set(skillIds);
  const map: SkillMap = {};
  for (const skillId of Object.keys(tagsBySkill)) {
    if (!skillIdSet.has(skillId)) continue;
    for (const tag of tagsBySkill[skillId]) {
      if (!knownAgentSet.has(tag)) continue;
      (map[tag] ??= []).push(skillId);
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// The "Update skill tags" pane flow's OTHER half — see `apps/ai-tools-manager`'s
// `update-skill-tags` skill. It can't call `skillTags:set` (no such tool is offered to a session,
// see `agent-sdk.ts`'s narrow tool surface), so it reports tag changes as one fenced JSON block at
// the end of its last message instead, and `claude-session.ts` applies it from here.
// ─────────────────────────────────────────────────────────────────────────────

const TAGS_BLOCK_RE = /```update-skill-tags\s*\n([\s\S]*?)\n```/;

/**
 * Pull the `update-skill-tags` block out of a completed assistant message and validate it, without
 * touching disk. Returns null on anything that isn't EXACTLY `{ [skillId]: SkillTag[] }` — no
 * block, invalid JSON, a non-object, or a single bad tag anywhere in it. Whole-block rejection
 * rather than a partial one: a value the model didn't finish typing correctly is not one to guess
 * at applying half of.
 */
export function parseSkillTagsBlock(text: string): Record<string, SkillTag[]> | null {
  const match = TAGS_BLOCK_RE.exec(text);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const knownTags: readonly string[] = SKILL_TAGS;
  const out: Record<string, SkillTag[]> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!Array.isArray(value) || !value.every((t) => typeof t === "string" && knownTags.includes(t))) return null;
    out[id] = value as SkillTag[];
  }
  return out;
}

/**
 * Apply a parsed tags block — but ONLY for a skill id this check can confirm actually exists under
 * `skillsDir`, since the parser above has no filesystem and cannot make that check itself. An id
 * for a skill that was renamed, removed, or never existed (a model that invented one) is silently
 * skipped, same as a stale tag `skillMapFromTags` already drops. Returns the ids actually written.
 */
export function applySkillTagsBlock(
  tagsById: Record<string, SkillTag[]>,
  skillsDir: string,
  dbPath: string = DEFAULT_SKILL_TAGS_DB_PATH
): string[] {
  const applied: string[] = [];
  for (const [id, tags] of Object.entries(tagsById)) {
    if (/[\\/]/.test(id) || id.includes("..")) continue;
    if (!fs.existsSync(path.join(skillsDir, id, "SKILL.md"))) continue;
    setSkillTags(id, tags, dbPath);
    applied.push(id);
  }
  return applied;
}
