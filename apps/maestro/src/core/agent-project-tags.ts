// Agent project tags: a global, one-per-agent assignment of which Project Tags catalog entry an
// agent belongs to — the other half of the project ↔ agent mapping (see project-tags.ts for the
// project side). Mirrors agent-types.ts in mechanism (node:sqlite, one store for every project on
// the machine, an agent has exactly one value) but is deliberately a distinct store: this field is
// called a "project tag" (agent-types.ts's "type" name is taken by the unrelated
// developer/planner/reviewer/annotator/tester classification on the same /templates page).
//
// SEEDED ON FIRST READ, not by a one-off script — same discipline as agent-types.ts. A fresh
// machine sees the eight built-in agents pre-classified: backend/frontend/mobile/infra → their own
// name (the four implementation stacks match the seeded Project Tags catalog one-for-one), and
// refactor/reviewer/scribe/test → "global", since those four apply to every project regardless of
// category.
//
// Unlike agent-types.ts's AgentType, the value here isn't a fixed TS union — it's whatever the
// live Project Tags catalog contains, plus the literal "global". So validation on write is just
// "non-empty string"; the /templates UI is what constrains the dropdown to real catalog values.
//
// The `/templates` page's Project Tags tab is the UI that writes here, in a second section below
// the existing catalog editor.
//
// KEYED BY (project_root, agent_name), not agent_name alone (030) — same reasoning and same merged-
// read shape as agent-types.ts: omit `projectRoot` for the global row alone (`/templates`, the
// plugin's install-time reader), pass it to overlay a project-tier agent's own row on top of the
// global ones. NO MIGRATION: a pre-030 db is dropped and reseeded, not rewritten in place — see
// that ticket's "No migration" section.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/** `~/.claude/maestro-agent-project-tags.sqlite` — one store, every project on this machine. */
export const DEFAULT_AGENT_PROJECT_TAGS_DB_PATH = path.join(
  os.homedir(),
  ".claude",
  "maestro-agent-project-tags.sqlite"
);

/** The eight built-in agents' starting project tag — see the module header for the mapping. */
const SEED_AGENT_PROJECT_TAGS: Record<string, string> = {
  backend: "backend",
  frontend: "frontend",
  mobile: "mobile",
  infra: "infra",
  refactor: "global",
  reviewer: "global",
  scribe: "global",
  test: "global",
};

function openDb(dbPath: string): DatabaseSync {
  // Can be opened on a machine where `~/.claude` itself doesn't exist yet — same as
  // agent-types.ts / project-tags.ts.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  dropLegacySchema(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_project_tags (
      project_root TEXT NOT NULL DEFAULT '',
      agent_name   TEXT NOT NULL,
      project_tag  TEXT NOT NULL,
      PRIMARY KEY (project_root, agent_name)
    )
  `);
  seedIfEmpty(db);
  return db;
}

/** See the module header's "NO MIGRATION" note: a pre-030 table has no `project_root` column. */
function dropLegacySchema(db: DatabaseSync): void {
  const cols = db.prepare("PRAGMA table_info(agent_project_tags)").all() as Array<{ name: string }>;
  if (cols.length > 0 && !cols.some((c) => c.name === "project_root")) {
    db.exec("DROP TABLE agent_project_tags");
  }
}

/** Idempotent: only runs when `agent_project_tags` has never been written to, on THIS db file. */
function seedIfEmpty(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) AS n FROM agent_project_tags").get() as { n: number };
  if (row.n > 0) return;
  db.exec("BEGIN");
  try {
    const insert = db.prepare(
      "INSERT INTO agent_project_tags (project_root, agent_name, project_tag) VALUES ('', ?, ?)"
    );
    for (const [agentName, tag] of Object.entries(SEED_AGENT_PROJECT_TAGS)) insert.run(agentName, tag);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Every agent's project tag, keyed by agent name — what the Project Tags tab's second section
 * lists.
 *
 * Omit `projectRoot` for the GLOBAL view alone — what `/templates` and the plugin's install-time
 * reader both want. Pass it to additionally overlay `projectRoot`'s own project-tier rows on top
 * of the global ones, which is the merged view `/agents` needs.
 */
export function readAllAgentProjectTags(
  dbPath: string = DEFAULT_AGENT_PROJECT_TAGS_DB_PATH,
  projectRoot?: string
): Record<string, string> {
  const db = openDb(dbPath);
  try {
    // `''` (global) sorts before any real path, so a later row for the same agent name — this
    // project's own override — simply overwrites the global one as the map is built.
    const rows = db
      .prepare(
        "SELECT agent_name AS agentName, project_tag AS projectTag FROM agent_project_tags" +
          " WHERE project_root = '' OR project_root = ?" +
          " ORDER BY project_root ASC, agent_name ASC"
      )
      .all(projectRoot ?? "") as Array<{ agentName: string; projectTag: string }>;
    const out: Record<string, string> = {};
    for (const row of rows) out[row.agentName] = row.projectTag;
    return out;
  } finally {
    db.close();
  }
}

/**
 * Set `agentName`'s project tag to exactly `tag` — a replace, not an append, since an agent has one.
 *
 * Omit `projectRoot` to write the GLOBAL row (a `user`/`maestro`/plugin-tier agent, or `/templates`
 * editing the machine-wide fallback). Pass it for a `project`-tier agent, so this project's row
 * cannot be read back from, or overwritten by, any other project.
 */
export function setAgentProjectTag(
  agentName: string,
  tag: string,
  dbPath: string = DEFAULT_AGENT_PROJECT_TAGS_DB_PATH,
  projectRoot?: string
): string {
  const clean = tag.trim();
  if (!clean) throw new Error("An agent's project tag can't be empty.");
  const db = openDb(dbPath);
  try {
    db.prepare(
      "INSERT OR REPLACE INTO agent_project_tags (project_root, agent_name, project_tag) VALUES (?, ?, ?)"
    ).run(projectRoot ?? "", agentName, clean);
    return clean;
  } finally {
    db.close();
  }
}

/**
 * Agent names whose stored project tag is in `tags` — what a project-tags toggle on `/maestro`
 * uses to find which bundled agents newly match. A plain membership lookup, no special-casing of
 * `"global"`: the caller (`project:tags:set`) only ever passes tags a project actually selected —
 * real project-tags catalog entries — so `"global"` never appears in `tags` in practice, even
 * though an agent tagged `"global"` would match it like any other value if it did.
 *
 * `projectRoot`, when given, scopes the read the same way `readAllAgentProjectTags` does — so a
 * project-tier agent belonging to some OTHER project, sharing both this agent's name and its tag,
 * is never returned for a project it has nothing to do with.
 */
export function agentsForProjectTags(
  tags: string[],
  dbPath: string = DEFAULT_AGENT_PROJECT_TAGS_DB_PATH,
  projectRoot?: string
): string[] {
  const all = readAllAgentProjectTags(dbPath, projectRoot);
  const wanted = new Set(tags);
  return Object.keys(all)
    .filter((agentName) => wanted.has(all[agentName]))
    .sort();
}
