// Agent types: a global, one-per-agent classification (developer|planner|reviewer|annotator|tester)
// — mirrors skill-tags.ts's ~/.claude/maestro-skill-tags.sqlite in mechanism (node:sqlite, one
// store for every project on the machine), but singular where that one is a set: an agent has
// exactly one type, not a list of tags, so this is a plain key→value table rather than a
// (skill_id, tag) pair table.
//
// SEEDED ON FIRST READ, not by a one-off script — same discipline as report-defaults.ts. A fresh
// machine sees the eight built-in agents pre-classified: backend/frontend/mobile/infra → developer
// (the four implementation stacks), refactor → planner, reviewer → reviewer, scribe → annotator,
// test → tester.
//
// The `/templates` page's Agent Types tab is the UI that writes here.
//
// KEYED BY (project_root, agent_name), not agent_name alone (030). A `user`/`maestro`/plugin-tier
// agent is the same agent in every project, so it keys on `agent_name` with `project_root = ''`
// (global) — exactly the old behaviour. A `project`-tier agent is one project's own file and
// nobody else's, so it keys on its own project's root instead; two projects that each happen to
// define a `.claude/agents/reviewer.md` no longer share a row. Callers that omit `projectRoot`
// (every `/templates` call, the plugin's install-time reader) see the global row only — that is
// what keeps `/templates` a machine-wide editor rather than a silently project-scoped one. A
// merged read (global row, then this project's own override) is a SINGLE query: global rows sort
// first (`''` collates before any real path) and a later row for the same agent name simply
// overwrites the earlier one in the map being built.
//
// NO MIGRATION (030): a db file still in the pre-030 shape (`agent_name TEXT PRIMARY KEY`, no
// `project_root` column) is dropped and reseeded rather than rewritten in place — see that ticket's
// "No migration" section for why losing any hand-set classification on the one machine this has
// ever run on is an acceptable, one-time cost.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { AGENT_TYPES, type AgentType } from "./contracts.js";

export type { AgentType };

/** `~/.claude/maestro-agent-types.sqlite` — one store, every project on this machine. */
export const DEFAULT_AGENT_TYPES_DB_PATH = path.join(os.homedir(), ".claude", "maestro-agent-types.sqlite");

/** The eight built-in agents' starting classification — see the module header for the mapping. */
const SEED_AGENT_TYPES: Record<string, AgentType> = {
  backend: "developer",
  frontend: "developer",
  mobile: "developer",
  infra: "developer",
  refactor: "planner",
  reviewer: "reviewer",
  scribe: "annotator",
  test: "tester",
};

function openDb(dbPath: string): DatabaseSync {
  // Can be opened on a machine where `~/.claude` itself doesn't exist yet — `DatabaseSync` doesn't
  // create parent directories, so this makes the store as robust as the file it's meant to
  // complement.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  dropLegacySchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_types (
      project_root TEXT NOT NULL DEFAULT '',
      agent_name   TEXT NOT NULL,
      tag          TEXT NOT NULL,
      PRIMARY KEY (project_root, agent_name)
    )
  `);
  seedIfEmpty(db);
  return db;
}

/** See the module header's "NO MIGRATION" note: a pre-030 table has no `project_root` column. */
function dropLegacySchema(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(agent_types)").all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some((c) => c.name === "project_root")) {
    db.exec("DROP TABLE agent_types");
  }
}

/** Idempotent: only runs when `agent_types` has never been written to, on THIS db file. */
function seedIfEmpty(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) AS n FROM agent_types").get() as { n: number };
  if (row.n > 0) return;
  db.exec("BEGIN");
  try {
    const insert = db.prepare("INSERT INTO agent_types (project_root, agent_name, tag) VALUES ('', ?, ?)");
    for (const [agentName, tag] of Object.entries(SEED_AGENT_TYPES)) insert.run(agentName, tag);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Every agent's type, keyed by agent name — what the Agent Types tab lists.
 *
 * Omit `projectRoot` for the GLOBAL view alone — what `/templates` and the plugin's install-time
 * reader both want. Pass it to additionally overlay `projectRoot`'s own project-tier rows on top of
 * the global ones, which is the merged view `/agents` needs: a project-tier agent named the same as
 * one in another project must not see that other project's classification.
 */
export function readAllAgentTypes(
  dbPath: string = DEFAULT_AGENT_TYPES_DB_PATH,
  projectRoot?: string
): Record<string, AgentType> {
  const db = openDb(dbPath);
  try {
    // `''` (global) sorts before any real path, so a later row for the same agent name — this
    // project's own override — simply overwrites the global one as the map is built.
    const rows = db
      .prepare(
        "SELECT agent_name AS agentName, tag FROM agent_types" +
          " WHERE project_root = '' OR project_root = ?" +
          " ORDER BY project_root ASC, agent_name ASC"
      )
      .all(projectRoot ?? "") as Array<{ agentName: string; tag: AgentType }>;
    const out: Record<string, AgentType> = {};
    for (const row of rows) out[row.agentName] = row.tag;
    return out;
  } finally {
    db.close();
  }
}

/**
 * Set `agentName`'s type to exactly `tag` — a replace, not an append, since an agent has one type.
 *
 * Omit `projectRoot` to write the GLOBAL row (a `user`/`maestro`/plugin-tier agent, or `/templates`
 * editing the machine-wide fallback). Pass it for a `project`-tier agent, so this project's row
 * cannot be read back from, or overwritten by, any other project.
 */
export function setAgentType(
  agentName: string,
  tag: AgentType,
  dbPath: string = DEFAULT_AGENT_TYPES_DB_PATH,
  projectRoot?: string
): AgentType {
  if (!AGENT_TYPES.includes(tag)) throw new Error(`Not a known agent type: ${tag}`);
  const db = openDb(dbPath);
  try {
    db.prepare("INSERT OR REPLACE INTO agent_types (project_root, agent_name, tag) VALUES (?, ?, ?)").run(
      projectRoot ?? "",
      agentName,
      tag
    );
    return tag;
  } finally {
    db.close();
  }
}
