// Handoff defaults: the GLOBAL (per machine, every project) tier for a `handoff_details` payload
// protocol, backed by `node:sqlite`. The exact counterpart of report-defaults.ts one directory
// over, and global for the same reason that file gives: it is the fallback a project falls back to
// when it has no opinion of its own, and it is what install/update syncs a project's
// `.claude/handoffs/<sender>/<receiver>.md` FROM.
//
// ONE TABLE, not two. `report-defaults.ts` routes agent -> report_id -> content so a future UI
// could point two agents at one shared body; its own header admits nothing creates that sharing.
// Handoffs have 24 keys to reports' 6, and eight of the seed bodies are byte-identical today
// purely as a seed artifact (see `handoff-seeds.ts`) — so the hop would buy an id-sharing nobody
// asked for at the cost of one more join to keep correct. `handoff_id` IS the key, and it is
// `"<sender>/<receiver>"`, which maps straight onto the project file's path. The store self-seeds,
// so if edit-once ever matters, "migrating" is deleting the sqlite file.
//
// THE SEED IS NOT IN HERE. `handoff-seeds.ts` holds it, imports nothing, and travels to the hook
// inside `maestro-session.cjs` — the bundle the hook requires unconditionally — so the seed tier
// still answers on a `node` older than 22.5, where requiring this module throws. See that file's
// header for the grep that holds it.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { SEED_HANDOFFS, PRIOR_SEEDS, isValidHandoffId } from "./handoff-seeds.js";
import type { HandoffDefault } from "./contracts.js";

export type { HandoffDefault };

/** `~/.claude/maestro-handoff-defaults.sqlite` — one store, every project on this machine. */
export const DEFAULT_HANDOFF_DEFAULTS_DB_PATH = path.join(os.homedir(), ".claude", "maestro-handoff-defaults.sqlite");

/**
 * Every id that reaches this module becomes a path in the project tier, so it is rejected HERE
 * too, not only in the sync — the store is the other place an id crosses from data into a
 * filesystem operation, and a guard that lives in only one of two callers is a guard that will be
 * missed by the third.
 */
function requireValidId(handoffId: string): void {
  if (!isValidHandoffId(handoffId)) throw new Error(`Invalid handoff id: ${String(handoffId)}`);
}

function openDb(dbPath: string): DatabaseSync {
  // Can be opened on a machine where `~/.claude` itself doesn't exist yet — `DatabaseSync` doesn't
  // create parent directories.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS handoffs (
      handoff_id TEXT PRIMARY KEY,
      content    TEXT NOT NULL,
      version    INTEGER NOT NULL
    )
  `);
  seedIfEmpty(db);
  refreshSupersededSeeds(db);
  return db;
}

/** Idempotent: only runs when `handoffs` has never been written to, on THIS db file. */
function seedIfEmpty(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) AS n FROM handoffs").get() as { n: number };
  if (row.n > 0) return;
  db.exec("BEGIN");
  try {
    const insert = db.prepare("INSERT INTO handoffs (handoff_id, content, version) VALUES (?, ?, 1)");
    for (const [id, content] of Object.entries(SEED_HANDOFFS)) insert.run(id, content);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Move any row still carrying a superseded seed body forward to the current one, bumping its
 * `version` so `handoff-sync.ts` refreshes the project copies it has already materialized.
 *
 * A row the user edited matches nothing in `PRIOR_SEEDS` and is left exactly as it is — the same
 * "never clobber a customization" rule the sync applies one tier down. Idempotent: after one pass
 * the content matches the CURRENT seed, which is not in the prior list.
 */
function refreshSupersededSeeds(db: DatabaseSync): void {
  const select = db.prepare("SELECT content, version FROM handoffs WHERE handoff_id = ?");
  const update = db.prepare("UPDATE handoffs SET content = ?, version = ? WHERE handoff_id = ?");

  db.exec("BEGIN");
  try {
    for (const [id, current] of Object.entries(SEED_HANDOFFS)) {
      const row = select.get(id) as { content: string; version: number } | undefined;
      if (!row) continue;
      if (!(PRIOR_SEEDS[id] ?? []).includes(row.content)) continue;
      update.run(current, row.version + 1, id);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** The global default protocol for one `"<sender>/<receiver>"` pair, or null when it has none. */
export function readHandoffDefault(
  handoffId: string,
  dbPath: string = DEFAULT_HANDOFF_DEFAULTS_DB_PATH
): HandoffDefault | null {
  requireValidId(handoffId);
  const db = openDb(dbPath);
  try {
    const row = db.prepare("SELECT content, version FROM handoffs WHERE handoff_id = ?").get(handoffId) as
      { content: string; version: number } | undefined;
    return row ? { handoffId, content: row.content, version: row.version } : null;
  } finally {
    db.close();
  }
}

/** Every pair with a global default, keyed by handoff id — what `034`'s Handoffs tab lists. */
export function readAllHandoffDefaults(
  dbPath: string = DEFAULT_HANDOFF_DEFAULTS_DB_PATH
): Record<string, HandoffDefault> {
  const db = openDb(dbPath);
  try {
    const rows = db.prepare("SELECT handoff_id AS handoffId, content, version FROM handoffs").all() as Array<{
      handoffId: string;
      content: string;
      version: number;
    }>;
    const out: Record<string, HandoffDefault> = {};
    for (const row of rows) out[row.handoffId] = row;
    return out;
  } finally {
    db.close();
  }
}

/**
 * Upsert one pair's global default.
 *
 * Bumps `version` by 1 when a row already exists, else inserts at version 1 — this is what makes
 * `handoff-sync.ts`'s "global version advanced past `syncedFrom.version`" refresh branch fire for
 * a project that already synced the old content.
 */
export function writeHandoffDefault(
  handoffId: string,
  content: string,
  dbPath: string = DEFAULT_HANDOFF_DEFAULTS_DB_PATH
): HandoffDefault {
  requireValidId(handoffId);
  const db = openDb(dbPath);
  try {
    db.exec("BEGIN");
    try {
      const existing = db.prepare("SELECT version FROM handoffs WHERE handoff_id = ?").get(handoffId) as
        { version: number } | undefined;
      const version = existing ? existing.version + 1 : 1;
      db.prepare(
        `INSERT INTO handoffs (handoff_id, content, version) VALUES (?, ?, ?)
         ON CONFLICT(handoff_id) DO UPDATE SET content = excluded.content, version = excluded.version`
      ).run(handoffId, content, version);
      db.exec("COMMIT");
      return { handoffId, content, version };
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } finally {
    db.close();
  }
}

/**
 * Drop one pair's global default. Returns whether a row was actually removed.
 *
 * A row for a SEEDED pair comes straight back on the next open — `seedIfEmpty` only fires on an
 * empty table, but a delete that empties the table re-seeds every id. That is deliberate: the
 * store's floor is what Maestro ships, and "delete" here means "stop overriding the seed", not
 * "make this route protocol-less". A route the user genuinely wants silent is one they delete the
 * project file for.
 */
export function deleteHandoffDefault(handoffId: string, dbPath: string = DEFAULT_HANDOFF_DEFAULTS_DB_PATH): boolean {
  requireValidId(handoffId);
  const db = openDb(dbPath);
  try {
    const before = db.prepare("SELECT COUNT(*) AS n FROM handoffs WHERE handoff_id = ?").get(handoffId) as {
      n: number;
    };
    if (before.n === 0) return false;
    db.prepare("DELETE FROM handoffs WHERE handoff_id = ?").run(handoffId);
    return true;
  } finally {
    db.close();
  }
}
