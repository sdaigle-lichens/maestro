// Agent types: a global, one-per-agent classification (developer|planner|reviewer|annotator|tester)
// — mirrors skill-tags.ts's ~/.claude/maestro-skill-tags.sqlite in mechanism (node:sqlite, one
// store for every project on the machine), but singular where that one is a set: an agent has
// exactly one type, not a list of tags, so this is a plain key→value table rather than a
// (skill_id, tag) pair table.
//
// SEEDED ON FIRST READ, not by a one-off script — same discipline as report-defaults.ts. A fresh
// machine sees the seven built-in agents pre-classified: backend/frontend/mobile → developer (the
// three implementation stacks), refactor → planner, reviewer → reviewer, scribe → annotator, test →
// tester.
//
// The `/templates` page's Agent Types tab is the UI that writes here.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_TYPES, type AgentType } from "./contracts.js";

export type { AgentType };

/** `~/.claude/maestro-agent-types.sqlite` — one store, every project on this machine. */
export const DEFAULT_AGENT_TYPES_DB_PATH = path.join(os.homedir(), ".claude", "maestro-agent-types.sqlite");

/** The seven built-in agents' starting classification — see the module header for the mapping. */
const SEED_AGENT_TYPES: Record<string, AgentType> = {
  backend: "developer",
  frontend: "developer",
  mobile: "developer",
  refactor: "planner",
  reviewer: "reviewer",
  scribe: "annotator",
  test: "tester",
};

function openDb(dbPath: string): DatabaseSync {
  // Unlike skill-tags.ts's store, this can be opened on a machine where `~/.claude` itself doesn't
  // exist yet — `DatabaseSync` doesn't create parent directories, so this makes the store as
  // robust as the file it's meant to complement.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_types (
      agent_name TEXT PRIMARY KEY,
      tag        TEXT NOT NULL
    )
  `);
  seedIfEmpty(db);
  return db;
}

/** Idempotent: only runs when `agent_types` has never been written to, on THIS db file. */
function seedIfEmpty(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) AS n FROM agent_types").get() as { n: number };
  if (row.n > 0) return;
  db.exec("BEGIN");
  try {
    const insert = db.prepare("INSERT INTO agent_types (agent_name, tag) VALUES (?, ?)");
    for (const [agentName, tag] of Object.entries(SEED_AGENT_TYPES)) insert.run(agentName, tag);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Every agent's type, keyed by agent name — what the Agent Types tab lists. */
export function readAllAgentTypes(dbPath: string = DEFAULT_AGENT_TYPES_DB_PATH): Record<string, AgentType> {
  const db = openDb(dbPath);
  try {
    const rows = db.prepare("SELECT agent_name AS agentName, tag FROM agent_types ORDER BY agent_name").all() as Array<{
      agentName: string;
      tag: AgentType;
    }>;
    const out: Record<string, AgentType> = {};
    for (const row of rows) out[row.agentName] = row.tag;
    return out;
  } finally {
    db.close();
  }
}

/** Set `agentName`'s type to exactly `tag` — a replace, not an append, since an agent has one type. */
export function setAgentType(
  agentName: string,
  tag: AgentType,
  dbPath: string = DEFAULT_AGENT_TYPES_DB_PATH
): AgentType {
  if (!AGENT_TYPES.includes(tag)) throw new Error(`Not a known agent type: ${tag}`);
  const db = openDb(dbPath);
  try {
    db.prepare("INSERT OR REPLACE INTO agent_types (agent_name, tag) VALUES (?, ?)").run(agentName, tag);
    return tag;
  } finally {
    db.close();
  }
}
