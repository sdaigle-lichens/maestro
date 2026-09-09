// Agent avatars: a purely cosmetic pixel-art appearance, stored once per agent NAME and shared
// across every project — same discipline as `skill-tags.ts`, applied to a different key.
//
// Global, not per-project — confirmed with the user: an agent named the same thing is the same
// agent wherever it's used, so its look should follow the name rather than being re-picked in
// every project that happens to have an agent of that name.
//
// Backed by `node:sqlite` for the same reason `skill-tags.ts` is: no native module, no
// Electron-rebuild step. See that file's header comment for the fuller argument.
//
// KEYED BY (project_root, agent_name), not agent_name alone (030) — same reasoning as
// agent-types.ts / agent-project-tags.ts: a `user`/`maestro`/plugin-tier agent's look is the same
// everywhere and keys on `agent_name` with `project_root = ''` (global); a `project`-tier agent is
// one project's own file, so two projects with a same-named project agent no longer share a hat.
// Omit `projectRoot` for the global row alone; pass it to overlay a project's own row on top of the
// global one. NO MIGRATION: a pre-030 db is dropped and reseeded, not rewritten in place.

import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AVATAR_CATEGORIES, AVATAR_PARTS, HEX_COLOR_RE, type AvatarCategory, type AvatarLayers } from "./contracts.js";

/** `~/.claude/maestro-avatars.sqlite` — one store, every project on this machine. */
export const DEFAULT_AVATAR_DB_PATH = path.join(os.homedir(), ".claude", "maestro-avatars.sqlite");

function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  dropLegacySchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_avatars (
      project_root TEXT NOT NULL DEFAULT '',
      agent_name   TEXT NOT NULL,
      layers       TEXT NOT NULL,
      PRIMARY KEY (project_root, agent_name)
    )
  `);
  return db;
}

/** See the module header's "NO MIGRATION" note: a pre-030 table has no `project_root` column. */
function dropLegacySchema(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(agent_avatars)").all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some((c) => c.name === "project_root")) {
    db.exec("DROP TABLE agent_avatars");
  }
}

function isValidLayers(value: unknown): value is AvatarLayers {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const categoriesOk = AVATAR_CATEGORIES.every((cat: AvatarCategory) => {
    const id = v[cat];
    if (id === null) return true;
    if (typeof id !== "string") return false;
    return AVATAR_PARTS[cat].some((opt) => opt.id === id);
  });
  if (!categoriesOk) return false;
  return isValidColor(v.eyesColor) && isValidColor(v.hairColor);
}

function isValidColor(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  return typeof value === "string" && HEX_COLOR_RE.test(value);
}

/**
 * The stored avatar for `agentName`, or null when nothing has been saved for it yet.
 *
 * Omit `projectRoot` for the GLOBAL row alone — what `agent-fork.ts`'s read side wants: a fork
 * always copies FROM a global-tier template. Pass it to prefer `projectRoot`'s own row over the
 * global one when both exist.
 */
export function getAvatar(
  agentName: string,
  dbPath: string = DEFAULT_AVATAR_DB_PATH,
  projectRoot?: string
): AvatarLayers | null {
  const db = openDb(dbPath);
  try {
    const row = db
      .prepare(
        "SELECT layers FROM agent_avatars WHERE agent_name = ? AND (project_root = '' OR project_root = ?)" +
          " ORDER BY project_root DESC LIMIT 1"
      )
      .get(agentName, projectRoot ?? "") as { layers: string } | undefined;
    if (!row) return null;
    const parsed: unknown = JSON.parse(row.layers);
    return isValidLayers(parsed) ? parsed : null;
  } finally {
    db.close();
  }
}

/**
 * Every stored avatar, keyed by agent name — the /agents list renders one thumb per row, and a
 * `getAvatar` per row would be one sqlite open per agent on every render. Same shape and same
 * reason as `readAllAgentTypes` / `readAllAgentProjectTags`.
 *
 * Omit `projectRoot` for the GLOBAL view alone (`/templates`). Pass it to additionally overlay
 * `projectRoot`'s own project-tier rows on top of the global ones, which is the merged view
 * `/agents` needs.
 *
 * A row whose JSON no longer validates (a part removed from `AVATAR_PARTS` since it was saved) is
 * SKIPPED rather than failing the whole read: one stale agent must not blank the list.
 */
export function readAllAvatars(
  dbPath: string = DEFAULT_AVATAR_DB_PATH,
  projectRoot?: string
): Record<string, AvatarLayers> {
  const db = openDb(dbPath);
  try {
    // `''` (global) sorts before any real path, so a later row for the same agent name — this
    // project's own override — simply overwrites the global one as the map is built.
    const rows = db
      .prepare(
        "SELECT agent_name, layers FROM agent_avatars" +
          " WHERE project_root = '' OR project_root = ?" +
          " ORDER BY project_root ASC"
      )
      .all(projectRoot ?? "") as Array<{
      agent_name: string;
      layers: string;
    }>;
    const out: Record<string, AvatarLayers> = {};
    for (const row of rows) {
      try {
        const parsed: unknown = JSON.parse(row.layers);
        if (isValidLayers(parsed)) out[row.agent_name] = parsed;
      } catch {
        // Unparseable JSON — same treatment as an invalid one.
      }
    }
    return out;
  } finally {
    db.close();
  }
}

/**
 * Rejects (throws) on an invalid category id — same discipline as `setAgentType`, checked before
 * write.
 *
 * Omit `projectRoot` to write the GLOBAL row (a `user`/`maestro`/plugin-tier agent, or
 * `/templates`/`create-subagent`'s marketplace target). Pass it for a `project`-tier agent, so this
 * project's row cannot be read back from, or overwritten by, any other project.
 */
export function setAvatar(
  agentName: string,
  layers: AvatarLayers,
  dbPath: string = DEFAULT_AVATAR_DB_PATH,
  projectRoot?: string
): AvatarLayers {
  if (!isValidLayers(layers)) throw new Error("Invalid avatar layers.");
  const db = openDb(dbPath);
  try {
    db.prepare(
      "INSERT INTO agent_avatars (project_root, agent_name, layers) VALUES (?, ?, ?) " +
        "ON CONFLICT(project_root, agent_name) DO UPDATE SET layers = excluded.layers"
    ).run(projectRoot ?? "", agentName, JSON.stringify(layers));
    return layers;
  } finally {
    db.close();
  }
}
