// Project tags: a global catalog of project-classification labels — seeded with backend/frontend/
// mobile, the same three categories detect.ts's evidence matching already looks for (see that
// file's `ImplAgent` union) and the same three shown as chips at the top of the /workflows canvas
// (`DetectedChain`'s candidates, sourced from discovered agents today) — plus `infra`, the fourth
// bundled agent's own category (declarative infrastructure repos), which detect.ts does not look
// for evidence of yet.
//
// This store is standalone: nothing reads it yet. detect.ts's dependency/file signal tables are
// fixed per-category logic, not data a generic string list could safely drive, so a tag added here
// beyond the seeded backend/frontend/mobile trio gets no automatic evidence detection — the user
// assigns it manually wherever a future feature consumes this catalog. That asymmetry is the
// point: the three original tags are detectable, `infra` and anything added after it are not, and
// every kind sits in the same list.
//
// Backed by `node:sqlite`, mirroring skill-tags.ts / agent-types.ts. Unlike those two, the tag
// TEXT is the identity (no separate id column) — there is no rename here, only add/remove; renaming
// is delete-old, add-new. Every add is normalized (trimmed, lowercased) before it's checked against
// what's already there, so "Backend" and "backend " can't coexist as two different rows.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** `~/.claude/maestro-project-tags.sqlite` — one store, every project on this machine. */
export const DEFAULT_PROJECT_TAGS_DB_PATH = path.join(os.homedir(), ".claude", "maestro-project-tags.sqlite");

/**
 * The catalog's starting vocabulary — detect.ts's three evidence-matched categories, plus `infra`
 * for the bundled infra agent (no evidence detection yet — see the module header).
 */
const SEED_PROJECT_TAGS = ["backend", "frontend", "mobile", "infra"];

function openDb(dbPath: string): DatabaseSync {
  // Can be opened on a machine where `~/.claude` itself doesn't exist yet — same as
  // report-defaults.ts / agent-types.ts.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS project_tags (
      tag TEXT PRIMARY KEY
    )
  `);
  seedIfEmpty(db);
  return db;
}

/** Idempotent: only runs when `project_tags` has never been written to, on THIS db file. */
function seedIfEmpty(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) AS n FROM project_tags").get() as { n: number };
  if (row.n > 0) return;
  db.exec("BEGIN");
  try {
    const insert = db.prepare("INSERT INTO project_tags (tag) VALUES (?)");
    for (const tag of SEED_PROJECT_TAGS) insert.run(tag);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Trim + lowercase — the one normalization every add goes through before it's checked or stored. */
function normalizeTag(tag: string): string {
  return tag.trim().toLowerCase();
}

/** Every tag in the catalog, sorted. */
export function readAllProjectTags(dbPath: string = DEFAULT_PROJECT_TAGS_DB_PATH): string[] {
  const db = openDb(dbPath);
  try {
    const rows = db.prepare("SELECT tag FROM project_tags ORDER BY tag").all() as Array<{ tag: string }>;
    return rows.map((r) => r.tag);
  } finally {
    db.close();
  }
}

/**
 * Add a tag to the catalog — normalized, and a no-op if it's already there (case-insensitively,
 * by construction: everything stored is already normalized). Returns the full catalog after the
 * add. Throws on an empty tag (after trimming) — nothing meaningful to store.
 */
export function addProjectTag(tag: string, dbPath: string = DEFAULT_PROJECT_TAGS_DB_PATH): string[] {
  const clean = normalizeTag(tag);
  if (!clean) throw new Error("A project tag can't be empty.");
  const db = openDb(dbPath);
  try {
    db.prepare("INSERT OR IGNORE INTO project_tags (tag) VALUES (?)").run(clean);
    const rows = db.prepare("SELECT tag FROM project_tags ORDER BY tag").all() as Array<{ tag: string }>;
    return rows.map((r) => r.tag);
  } finally {
    db.close();
  }
}

/** Remove a tag from the catalog — a no-op if it isn't there. Returns the full catalog after. */
export function removeProjectTag(tag: string, dbPath: string = DEFAULT_PROJECT_TAGS_DB_PATH): string[] {
  const db = openDb(dbPath);
  try {
    db.prepare("DELETE FROM project_tags WHERE tag = ?").run(normalizeTag(tag));
    const rows = db.prepare("SELECT tag FROM project_tags ORDER BY tag").all() as Array<{ tag: string }>;
    return rows.map((r) => r.tag);
  } finally {
    db.close();
  }
}
