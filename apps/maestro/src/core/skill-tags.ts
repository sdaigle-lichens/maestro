// Skill tags: a user's manual, two-dimensional annotation on a skill, stored once per skill id and
// shared across every project.
//
// Global, not per-project — confirmed with the user: a skill from a marketplace is the same skill
// wherever it's used, so tagging it once should tag it everywhere, rather than re-tagging the same
// skill id in every project that references it.
//
// TWO DIMENSIONS, mirroring the two per-agent classifications that already exist:
//   - projectTags: which Project Tags catalog entries this skill applies to (project-tags.ts's
//     catalog), plus GLOBAL_TAG for "regardless of project tag".
//   - agentTypes: which AGENT_TYPES this skill applies to (agent-types.ts's closed vocabulary),
//     plus GLOBAL_TAG for "regardless of agent type".
// A skill's OLD single dimension (SKILL_TAGS — literally the seven built-in agent NAMES, matched
// 1:1 against an agent's name) is gone: it conflated "which kind of project" with "which kind of
// agent" into one flat list, and could only ever route a skill to an agent whose name it already
// knew. These two dimensions instead match against each seeded agent INSTANCE's own stored
// attributes (agent-types.ts's type, agent-project-tags.ts's project tag) — see `skillMapFromTags`
// below — so a skill routes by what kind of agent and what kind of project it's for, not by name.
//
// Both dimensions are edited together in the same Skills-tab row and always read together to build
// a seed's SkillMap, so they live in one module / one sqlite file with two tables, rather than
// mirroring agent-types.ts/agent-project-tags.ts's two-module split — those two are edited on
// separate /templates tabs, by different people, at different times; a skill's two dimensions have
// no such independent lifecycle.
//
// NO MIGRATION from the old single-table schema: the old tag vocabulary (backend/frontend/mobile/
// refactor/reviewer/scribe/test as agent NAMES) doesn't map cleanly onto either new dimension, and
// this is a sparse, personal dev-machine cache — a fresh start costs less than a guessed migration
// that plants silently-wrong tags.
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
import { AGENT_TYPES, GLOBAL_TAG } from "./contracts.js";
import type { SkillMap } from "./seed.js";

/** `~/.claude/maestro-skill-tags.sqlite` — one store, every project on this machine. */
export const DEFAULT_SKILL_TAGS_DB_PATH = path.join(os.homedir(), ".claude", "maestro-skill-tags.sqlite");

/** One skill's two tag dimensions, as read back from the store. */
export interface SkillTagSet {
  projectTags: string[];
  agentTypes: string[];
}

/** A seeded agent instance's own two classifications — what a skill's tags are matched against. */
export interface AgentAttrs {
  /** agent-types.ts's value for this agent name. */
  type: string;
  /** agent-project-tags.ts's value for this agent name — a catalog tag, or GLOBAL_TAG. */
  projectTag: string;
}

function openDb(dbPath: string): DatabaseSync {
  // `DatabaseSync` doesn't create parent directories, so on a machine that has never run any
  // Maestro store-writing feature and has no `~/.claude` yet, this would otherwise throw "unable
  // to open database file" — surfaced by installRuntime()'s first-install seed, which reads this
  // store via discoverSkills() before `~/.claude` is guaranteed to exist. Same fix already applied
  // to agent-types.ts / project-tags.ts / agent-project-tags.ts; this store just predates it.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_project_tags (
      skill_id TEXT NOT NULL,
      tag      TEXT NOT NULL,
      PRIMARY KEY (skill_id, tag)
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS skill_agent_types (
      skill_id TEXT NOT NULL,
      tag      TEXT NOT NULL,
      PRIMARY KEY (skill_id, tag)
    )
  `);
  return db;
}

function readAllFrom(db: DatabaseSync, table: "skill_project_tags" | "skill_agent_types"): Record<string, string[]> {
  const rows = db.prepare(`SELECT skill_id, tag FROM ${table} ORDER BY skill_id, tag`).all() as Array<{
    skill_id: string;
    tag: string;
  }>;
  const out: Record<string, string[]> = {};
  for (const row of rows) (out[row.skill_id] ??= []).push(row.tag);
  return out;
}

/** Every tagged skill in the store, keyed by skill id. Untagged skills are simply absent. */
export function readAllSkillTags(dbPath: string = DEFAULT_SKILL_TAGS_DB_PATH): Record<string, SkillTagSet> {
  const db = openDb(dbPath);
  try {
    const projectTags = readAllFrom(db, "skill_project_tags");
    const agentTypes = readAllFrom(db, "skill_agent_types");
    const ids = new Set([...Object.keys(projectTags), ...Object.keys(agentTypes)]);
    const out: Record<string, SkillTagSet> = {};
    for (const id of ids) out[id] = { projectTags: projectTags[id] ?? [], agentTypes: agentTypes[id] ?? [] };
    return out;
  } finally {
    db.close();
  }
}

function replaceAll(
  table: "skill_project_tags" | "skill_agent_types",
  skillId: string,
  tags: string[],
  dbPath: string
): string[] {
  const clean = Array.from(new Set(tags)).sort();
  const db = openDb(dbPath);
  try {
    db.exec("BEGIN");
    try {
      db.prepare(`DELETE FROM ${table} WHERE skill_id = ?`).run(skillId);
      const insert = db.prepare(`INSERT INTO ${table} (skill_id, tag) VALUES (?, ?)`);
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

/** Replace-all: `skillId`'s project tags become exactly `tags` (deduped), in one transaction. */
export function setSkillProjectTags(
  skillId: string,
  tags: string[],
  dbPath: string = DEFAULT_SKILL_TAGS_DB_PATH
): string[] {
  return replaceAll("skill_project_tags", skillId, tags, dbPath);
}

/** Replace-all: `skillId`'s agent types become exactly `tags` (deduped), in one transaction. */
export function setSkillAgentTypes(
  skillId: string,
  tags: string[],
  dbPath: string = DEFAULT_SKILL_TAGS_DB_PATH
): string[] {
  return replaceAll("skill_agent_types", skillId, tags, dbPath);
}

/**
 * Tags → `SkillMap`, deterministically — no inference.
 *
 * Pure: no db, no fs. A skill routes to agent name `a` (one of `agentAttrs`'s keys) when its
 * `agentTypes` includes `agentAttrs[a].type` or `GLOBAL_TAG`, AND its `projectTags` includes
 * `agentAttrs[a].projectTag` or `GLOBAL_TAG` — both dimensions have to match; an untagged
 * dimension (empty array) matches nothing on that axis, same as an untagged skill routes nowhere.
 * `skillIds` bounds the result to skills that actually exist right now, so a stale tag left over
 * from a renamed/removed skill (or one that happens to share an id with a skill tagged in an
 * unrelated project — the global store's one real trade-off) never produces a dangling reference in
 * a seeded `referenced_skills` list.
 */
export function skillMapFromTags(
  tagsBySkill: Record<string, SkillTagSet>,
  skillIds: string[],
  agentAttrs: Record<string, AgentAttrs>
): SkillMap {
  const skillIdSet = new Set(skillIds);
  const map: SkillMap = {};
  for (const skillId of Object.keys(tagsBySkill)) {
    if (!skillIdSet.has(skillId)) continue;
    const { projectTags, agentTypes } = tagsBySkill[skillId];
    if (projectTags.length === 0 || agentTypes.length === 0) continue;
    for (const [agentName, attrs] of Object.entries(agentAttrs)) {
      const typeMatches = agentTypes.includes(GLOBAL_TAG) || agentTypes.includes(attrs.type);
      const projectTagMatches = projectTags.includes(GLOBAL_TAG) || projectTags.includes(attrs.projectTag);
      if (typeMatches && projectTagMatches) (map[agentName] ??= []).push(skillId);
    }
  }
  return map;
}

// ─────────────────────────────────────────────────────────────────────────────
// The "Update skill tags" pane flow's OTHER half — see `plugins/maestro/skills/update-skill-tags`.
// It can't call the setters above directly (no such tool is offered to a session, see
// `agent-sdk.ts`'s narrow tool surface), so it reports tag changes as one fenced JSON block at the
// end of its last message instead, and `claude-session.ts` applies it from here.
// ─────────────────────────────────────────────────────────────────────────────

const TAGS_BLOCK_RE = /```update-skill-tags\s*\n([\s\S]*?)\n```/;

/**
 * Pull the `update-skill-tags` block out of a completed assistant message and validate it, without
 * touching disk. Returns null on anything that isn't EXACTLY `{ [skillId]: { projectTags: string[];
 * agentTypes: string[] } }` — no block, invalid JSON, a non-object, or a single bad value anywhere
 * in it. Whole-block rejection rather than a partial one: a value the model didn't finish typing
 * correctly is not one to guess at applying half of.
 *
 * `validProjectTags` is the live Project Tags catalog (plus GLOBAL_TAG) at the moment of parsing —
 * passed in rather than read here, which is what keeps this function pure. `agentTypes` validates
 * against the fixed `AGENT_TYPES` vocabulary (plus GLOBAL_TAG), which needs no such input.
 */
export function parseSkillTagsBlock(text: string, validProjectTags: string[]): Record<string, SkillTagSet> | null {
  const match = TAGS_BLOCK_RE.exec(text);
  if (!match) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[1]);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const knownProjectTags = new Set([...validProjectTags, GLOBAL_TAG]);
  const knownAgentTypes: readonly string[] = [...AGENT_TYPES, GLOBAL_TAG];
  const out: Record<string, SkillTagSet> = {};
  for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
    const { projectTags, agentTypes } = value as Record<string, unknown>;
    if (!Array.isArray(projectTags) || !projectTags.every((t) => typeof t === "string" && knownProjectTags.has(t))) {
      return null;
    }
    if (!Array.isArray(agentTypes) || !agentTypes.every((t) => typeof t === "string" && knownAgentTypes.includes(t))) {
      return null;
    }
    out[id] = { projectTags, agentTypes };
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
  tagsById: Record<string, SkillTagSet>,
  skillsDir: string,
  dbPath: string = DEFAULT_SKILL_TAGS_DB_PATH
): string[] {
  const applied: string[] = [];
  for (const [id, tags] of Object.entries(tagsById)) {
    if (/[\\/]/.test(id) || id.includes("..")) continue;
    if (!fs.existsSync(path.join(skillsDir, id, "SKILL.md"))) continue;
    setSkillProjectTags(id, tags.projectTags, dbPath);
    setSkillAgentTypes(id, tags.agentTypes, dbPath);
    applied.push(id);
  }
  return applied;
}
