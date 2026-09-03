// Agent project tags: a global, one-per-agent assignment of which Project Tags catalog entry an
// agent belongs to — the other half of the project ↔ agent mapping (see project-tags.ts for the
// project side). Mirrors agent-types.ts in mechanism (node:sqlite, one store for every project on
// the machine, an agent has exactly one value) but is deliberately a distinct store: this field is
// called a "project tag" (agent-types.ts's "type" name is taken by the unrelated
// developer/planner/reviewer/annotator/tester classification on the same /templates page).
//
// SEEDED ON FIRST READ, not by a one-off script — same discipline as agent-types.ts. A fresh
// machine sees the seven built-in agents pre-classified: backend/frontend/mobile → their own name
// (the three implementation stacks match the seeded Project Tags catalog one-for-one), and
// refactor/reviewer/scribe/test → "global", since those four apply to every project regardless of
// category.
//
// Unlike agent-types.ts's AgentType, the value here isn't a fixed TS union — it's whatever the
// live Project Tags catalog contains, plus the literal "global". So validation on write is just
// "non-empty string"; the /templates UI is what constrains the dropdown to real catalog values.
//
// The `/templates` page's Project Tags tab is the UI that writes here, in a second section below
// the existing catalog editor.

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

/** The seven built-in agents' starting project tag — see the module header for the mapping. */
const SEED_AGENT_PROJECT_TAGS: Record<string, string> = {
  backend: "backend",
  frontend: "frontend",
  mobile: "mobile",
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_project_tags (
      agent_name  TEXT PRIMARY KEY,
      project_tag TEXT NOT NULL
    )
  `);
  seedIfEmpty(db);
  return db;
}

/** Idempotent: only runs when `agent_project_tags` has never been written to, on THIS db file. */
function seedIfEmpty(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) AS n FROM agent_project_tags").get() as { n: number };
  if (row.n > 0) return;
  db.exec("BEGIN");
  try {
    const insert = db.prepare("INSERT INTO agent_project_tags (agent_name, project_tag) VALUES (?, ?)");
    for (const [agentName, tag] of Object.entries(SEED_AGENT_PROJECT_TAGS)) insert.run(agentName, tag);
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** Every agent's project tag, keyed by agent name — what the Project Tags tab's second section lists. */
export function readAllAgentProjectTags(dbPath: string = DEFAULT_AGENT_PROJECT_TAGS_DB_PATH): Record<string, string> {
  const db = openDb(dbPath);
  try {
    const rows = db
      .prepare("SELECT agent_name AS agentName, project_tag AS projectTag FROM agent_project_tags ORDER BY agent_name")
      .all() as Array<{ agentName: string; projectTag: string }>;
    const out: Record<string, string> = {};
    for (const row of rows) out[row.agentName] = row.projectTag;
    return out;
  } finally {
    db.close();
  }
}

/** Set `agentName`'s project tag to exactly `tag` — a replace, not an append, since an agent has one. */
export function setAgentProjectTag(
  agentName: string,
  tag: string,
  dbPath: string = DEFAULT_AGENT_PROJECT_TAGS_DB_PATH
): string {
  const clean = tag.trim();
  if (!clean) throw new Error("An agent's project tag can't be empty.");
  const db = openDb(dbPath);
  try {
    db.prepare("INSERT OR REPLACE INTO agent_project_tags (agent_name, project_tag) VALUES (?, ?)").run(
      agentName,
      clean
    );
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
 */
export function agentsForProjectTags(tags: string[], dbPath: string = DEFAULT_AGENT_PROJECT_TAGS_DB_PATH): string[] {
  const all = readAllAgentProjectTags(dbPath);
  const wanted = new Set(tags);
  return Object.keys(all)
    .filter((agentName) => wanted.has(all[agentName]))
    .sort();
}
