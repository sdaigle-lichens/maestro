// Report defaults: the GLOBAL (per machine, every project) fallback tier for a per-agent
// "Mandatory Output Format" report, backed by `node:sqlite` — mirrors skill-tags.ts's
// ~/.claude/maestro-skill-tags.sqlite in mechanism (see that file's header for why `node:sqlite`
// over another JSON blob or a native module), but global for a DIFFERENT reason: a skill tag is
// global because "a skill is the same skill everywhere"; a report default is global because it's
// the fallback tier a project falls back to when it has no opinion of its own, and it's what
// install/update syncs a project's `.claude/reports/*.md` FROM.
//
// Two tables, exactly as specified: `agent_reports` (agent_name -> report_id) and `reports`
// (report_id -> content + version). The indirection through `report_id` — rather than keying
// content directly by agent name — is what lets a future global-editing UI point two agents at
// one shared report id without a schema change; nothing in this slice creates that sharing itself
// (the migration below seeds one row per agent, deliberately not collapsing the near-identical
// backend/frontend/mobile shapes into one id — see the migration task's header for why).
//
// SEEDED ON FIRST READ, not by a one-off script: `reports` starts empty on a fresh machine, and
// every read function seeds it (backend/frontend/mobile/scribe/test, version 1) the first time
// the table is empty. This is what makes a fresh install of the plugin — with no maintainer
// having run a migration script — still see the same five defaults the bundled agent files used
// to carry inline, before their `## Mandatory Output Format` sections were stripped out.
//
// The `/templates` page's Reports tab is the UI that writes here — `writeAgentReportDefault`
// below. Every write it makes is one agent -> one report, keyed by the agent's own name; it never
// creates the id-sharing indirection the schema allows for (see the header note above).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ReportDefault } from "./contracts.js";

export type { ReportDefault };

/** `~/.claude/maestro-report-defaults.sqlite` — one store, every project on this machine. */
export const DEFAULT_REPORT_DEFAULTS_DB_PATH = path.join(os.homedir(), ".claude", "maestro-report-defaults.sqlite");

function backendLikeReport(subagent: string): string {
  return (
    "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
    "\n" +
    "```json\n" +
    "{\n" +
    `  "subagent": "${subagent}",\n` +
    '  "verdict": "SUCCESS | FAIL",\n' +
    '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
    '  "filesChanged": ["<file1>", "<file2>"],\n' +
    '  "description": "<summary of what was implemented>"\n' +
    "}\n" +
    "```"
  );
}

const SCRIBE_REPORT =
  "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
  "\n" +
  "```json\n" +
  "{\n" +
  '  "subagent": "scribe",\n' +
  '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
  '  "agentsMdUpdated": 0,\n' +
  '  "docsUpdated": 0,\n' +
  '  "claudeFilesUpdated": 0,\n' +
  '  "changelogUpdated": false,\n' +
  '  "description": "<summary of what was updated>"\n' +
  "}\n" +
  "```\n" +
  "\n" +
  '"Claude files" covers any file under `.claude/agents/`, `.claude/rules/`, or `.claude/skills/`. ' +
  "Use the counts to keep the handoff message small — do not list individual file names unless the caller asks.";

const TEST_REPORT =
  "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
  "\n" +
  "```json\n" +
  "{\n" +
  '  "subagent": "test",\n' +
  '  "verdict": "SUCCESS | FAIL",\n' +
  '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
  '  "testResult": "<N passed, N failed>",\n' +
  '  "filesChanged": ["<file1>", "<file2>"],\n' +
  '  "description": "<summary of what was tested>"\n' +
  "}\n" +
  "```";

/**
 * The exact bodies stripped from `plugins/maestro/agents/{backend,frontend,mobile,scribe,test}.md`
 * — one row per agent, `report_id` equal to the agent's own name. `refactor`/`reviewer` are
 * deliberately absent: they never had a `## Mandatory Output Format` section (their own
 * `## Mandatory Output` sections are a different heading and untouched by this migration), so they
 * get no seed row and resolve to `"none"`, exactly as before.
 */
const SEED_REPORTS: Record<string, string> = {
  backend: backendLikeReport("backend"),
  frontend: backendLikeReport("frontend"),
  mobile: backendLikeReport("mobile"),
  scribe: SCRIBE_REPORT,
  test: TEST_REPORT,
};

function openDb(dbPath: string): DatabaseSync {
  // Can be opened on a machine where `~/.claude` itself doesn't exist yet (no Claude Code session
  // has ever run there) — `DatabaseSync` doesn't create parent directories, so this makes the
  // store as robust as the file it's meant to complement.
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      report_id TEXT PRIMARY KEY,
      content   TEXT NOT NULL,
      version   INTEGER NOT NULL
    )
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_reports (
      agent_name TEXT PRIMARY KEY,
      report_id  TEXT NOT NULL
    )
  `);
  seedIfEmpty(db);
  return db;
}

/** Idempotent: only runs when `reports` has never been written to, on THIS db file. */
function seedIfEmpty(db: DatabaseSync): void {
  const row = db.prepare("SELECT COUNT(*) AS n FROM reports").get() as { n: number };
  if (row.n > 0) return;
  db.exec("BEGIN");
  try {
    const insertReport = db.prepare("INSERT INTO reports (report_id, content, version) VALUES (?, ?, 1)");
    const insertAgent = db.prepare("INSERT OR REPLACE INTO agent_reports (agent_name, report_id) VALUES (?, ?)");
    for (const [agentName, content] of Object.entries(SEED_REPORTS)) {
      insertReport.run(agentName, content);
      insertAgent.run(agentName, agentName);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** The global default report for one agent, or null when it has none. */
export function readAgentReportDefault(
  agentName: string,
  dbPath: string = DEFAULT_REPORT_DEFAULTS_DB_PATH
): ReportDefault | null {
  const db = openDb(dbPath);
  try {
    const row = db
      .prepare(
        `SELECT r.report_id AS reportId, r.content AS content, r.version AS version
         FROM agent_reports a JOIN reports r ON r.report_id = a.report_id
         WHERE a.agent_name = ?`
      )
      .get(agentName) as { reportId: string; content: string; version: number } | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

/** One report row by its own id — for a sync step re-checking a version it already recorded. */
export function readReportById(
  reportId: string,
  dbPath: string = DEFAULT_REPORT_DEFAULTS_DB_PATH
): { content: string; version: number } | null {
  const db = openDb(dbPath);
  try {
    const row = db.prepare("SELECT content, version FROM reports WHERE report_id = ?").get(reportId) as
      | { content: string; version: number }
      | undefined;
    return row ?? null;
  } finally {
    db.close();
  }
}

/** Every agent with a global default, keyed by agent name — what install/update sync walks. */
export function readAllAgentReportDefaults(
  dbPath: string = DEFAULT_REPORT_DEFAULTS_DB_PATH
): Record<string, ReportDefault> {
  const db = openDb(dbPath);
  try {
    const rows = db
      .prepare(
        `SELECT a.agent_name AS agentName, r.report_id AS reportId, r.content AS content, r.version AS version
         FROM agent_reports a JOIN reports r ON r.report_id = a.report_id`
      )
      .all() as Array<{ agentName: string; reportId: string; content: string; version: number }>;
    const out: Record<string, ReportDefault> = {};
    for (const row of rows) out[row.agentName] = { reportId: row.reportId, content: row.content, version: row.version };
    return out;
  } finally {
    db.close();
  }
}

/**
 * Upsert `agentName`'s global default. Keyed by the agent's OWN name — same convention the seed
 * established, and the one restriction this UI carries: it never points an agent at a `report_id`
 * shared with another agent, so `report_id` is always `agentName` here.
 *
 * Bumps `version` by 1 when a `reports` row for `agentName` already exists, else inserts at
 * version 1 — this is what makes `report-sync.ts`'s "global version advanced past
 * `syncedFrom.version`" refresh logic fire for a project that already synced the old content.
 * `reports` and `agent_reports` move together in one transaction, same discipline as `seedIfEmpty`.
 */
export function writeAgentReportDefault(
  agentName: string,
  content: string,
  dbPath: string = DEFAULT_REPORT_DEFAULTS_DB_PATH
): ReportDefault {
  const db = openDb(dbPath);
  try {
    db.exec("BEGIN");
    try {
      const existing = db.prepare("SELECT version FROM reports WHERE report_id = ?").get(agentName) as
        | { version: number }
        | undefined;
      const version = existing ? existing.version + 1 : 1;
      db.prepare(
        `INSERT INTO reports (report_id, content, version) VALUES (?, ?, ?)
         ON CONFLICT(report_id) DO UPDATE SET content = excluded.content, version = excluded.version`
      ).run(agentName, content, version);
      db.prepare("INSERT OR REPLACE INTO agent_reports (agent_name, report_id) VALUES (?, ?)").run(agentName, agentName);
      db.exec("COMMIT");
      return { reportId: agentName, content, version };
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  } finally {
    db.close();
  }
}
