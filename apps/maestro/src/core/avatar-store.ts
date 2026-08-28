// Agent avatars: a purely cosmetic pixel-art appearance, stored once per agent NAME and shared
// across every project — same discipline as `skill-tags.ts`, applied to a different key.
//
// Global, not per-project — confirmed with the user: an agent named the same thing is the same
// agent wherever it's used, so its look should follow the name rather than being re-picked in
// every project that happens to have an agent of that name.
//
// Backed by `node:sqlite` for the same reason `skill-tags.ts` is: no native module, no
// Electron-rebuild step. See that file's header comment for the fuller argument.

import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AVATAR_CATEGORIES, AVATAR_PARTS, type AvatarCategory, type AvatarLayers } from "./contracts.js";

/** `~/.claude/maestro-avatars.sqlite` — one store, every project on this machine. */
export const DEFAULT_AVATAR_DB_PATH = path.join(os.homedir(), ".claude", "maestro-avatars.sqlite");

function openDb(dbPath: string): DatabaseSync {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_avatars (
      agent_name TEXT PRIMARY KEY,
      layers     TEXT NOT NULL
    )
  `);
  return db;
}

function isValidLayers(value: unknown): value is AvatarLayers {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return AVATAR_CATEGORIES.every((cat: AvatarCategory) => {
    const id = v[cat];
    if (id === null) return true;
    if (typeof id !== "string") return false;
    return AVATAR_PARTS[cat].some((opt) => opt.id === id);
  });
}

/** The stored avatar for `agentName`, or null when nothing has been saved for it yet. */
export function getAvatar(agentName: string, dbPath: string = DEFAULT_AVATAR_DB_PATH): AvatarLayers | null {
  const db = openDb(dbPath);
  try {
    const row = db.prepare("SELECT layers FROM agent_avatars WHERE agent_name = ?").get(agentName) as
      | { layers: string }
      | undefined;
    if (!row) return null;
    const parsed: unknown = JSON.parse(row.layers);
    return isValidLayers(parsed) ? parsed : null;
  } finally {
    db.close();
  }
}

/** Rejects (throws) on an invalid category id — same discipline as `setAgentType`, checked before write. */
export function setAvatar(
  agentName: string,
  layers: AvatarLayers,
  dbPath: string = DEFAULT_AVATAR_DB_PATH
): AvatarLayers {
  if (!isValidLayers(layers)) throw new Error("Invalid avatar layers.");
  const db = openDb(dbPath);
  try {
    db.prepare(
      "INSERT INTO agent_avatars (agent_name, layers) VALUES (?, ?) " +
        "ON CONFLICT(agent_name) DO UPDATE SET layers = excluded.layers"
    ).run(agentName, JSON.stringify(layers));
    return layers;
  } finally {
    db.close();
  }
}
