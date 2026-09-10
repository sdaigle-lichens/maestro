// Report defaults (the global tier), the pure resolution order, and the install/update sync step.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DatabaseSync } from "node:sqlite";
import { readAgentReportDefault, readAllAgentReportDefaults } from "../../src/core/report-defaults.js";
import { resolveReport } from "../../src/core/report-resolution.js";
import { syncProjectReports } from "../../src/core/report-sync.js";
import { readConfig, writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

describe("readAgentReportDefault", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-report-defaults-"));
    dbPath = path.join(dir, "reports.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("seeds the five bundled agents on first read against a fresh db path", () => {
    for (const agent of ["backend", "frontend", "mobile", "scribe", "test"]) {
      const row = readAgentReportDefault(agent, dbPath);
      expect(row).not.toBeNull();
      expect(row!.reportId).toBe(agent);
      expect(row!.version).toBe(1);
      expect(row!.content).toContain(`"subagent": "${agent}"`);
    }
  });

  it("refactor and reviewer get no seeded row — unchanged behavior, no report section", () => {
    expect(readAgentReportDefault("refactor", dbPath)).toBeNull();
    expect(readAgentReportDefault("reviewer", dbPath)).toBeNull();
  });

  it("an unknown agent gets no row either", () => {
    expect(readAgentReportDefault("not-a-real-agent", dbPath)).toBeNull();
  });

  it("seeding is idempotent across repeated opens of the same db file", () => {
    readAgentReportDefault("backend", dbPath);
    const all1 = readAllAgentReportDefaults(dbPath);
    readAgentReportDefault("backend", dbPath);
    const all2 = readAllAgentReportDefaults(dbPath);
    expect(all2).toEqual(all1);
    expect(Object.keys(all1).sort()).toEqual(["backend", "frontend", "infra", "mobile", "scribe", "test"]);
  });

  it("creates the db's parent directory when it doesn't exist yet", () => {
    const nested = path.join(dir, "does", "not", "exist", "reports.sqlite");
    expect(readAgentReportDefault("backend", nested)).not.toBeNull();
    expect(fs.existsSync(nested)).toBe(true);
  });
});

describe("resolveReport", () => {
  it("prefers a project override when its content was read", () => {
    const res = resolveReport("backend", { backend: { id: "backend" } }, "custom project content", {
      reportId: "backend",
      content: "global content",
    });
    expect(res).toEqual({ source: "project", content: "custom project content", reportId: "backend" });
  });

  it("falls back to the global default when there's no project content", () => {
    const res = resolveReport("backend", undefined, null, { reportId: "backend", content: "global content" });
    expect(res).toEqual({ source: "global", content: "global content", reportId: "backend" });
  });

  it("falls back to the global default when the slice has an entry but the file couldn't be read", () => {
    const res = resolveReport("backend", { backend: { id: "backend" } }, null, {
      reportId: "backend",
      content: "global content",
    });
    expect(res).toEqual({ source: "global", content: "global content", reportId: "backend" });
  });

  it("resolves to none when neither tier has anything", () => {
    expect(resolveReport("refactor", undefined, null, null)).toEqual({ source: "none", content: null, reportId: null });
  });
});

describe("syncProjectReports", () => {
  let dir: string;
  let dbPath: string;
  let projectRoot: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-report-sync-"));
    dbPath = path.join(dir, "reports.sqlite");
    projectRoot = path.join(dir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
    // Seed the store deterministically up front, same version/content every test relies on.
    readAgentReportDefault("backend", dbPath);
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("no-ops against a project with no maestro.json", () => {
    expect(syncProjectReports(projectRoot, dbPath)).toEqual({
      materialized: [],
      refreshed: [],
      adopted: [],
      staleCustomized: [],
      unchanged: [],
    });
  });

  it("materializes a report for every agents_available entry with a global default", () => {
    writeConfig(projectRoot, { ...defaultish });
    const summary = syncProjectReports(projectRoot, dbPath);
    // defaultish's agents_available: ["backend", "test", "reviewer", "refactor", "scribe"] —
    // reviewer/refactor have no global default and are skipped.
    expect(summary.materialized.sort()).toEqual(["backend", "scribe", "test"]);
    expect(fs.existsSync(path.join(projectRoot, ".claude", "reports", "backend.md"))).toBe(true);
    const cfg = readConfig(projectRoot)!;
    expect(cfg.reports!.backend.id).toBe("backend");
    expect(cfg.reports!.backend.syncedFrom).toBeDefined();
  });

  it("is a no-op the second time — nothing to materialize, nothing changed", () => {
    writeConfig(projectRoot, { ...defaultish });
    syncProjectReports(projectRoot, dbPath);
    const second = syncProjectReports(projectRoot, dbPath);
    expect(second.materialized).toEqual([]);
    expect(second.unchanged.sort()).toEqual(["backend", "scribe", "test"]);
  });

  it("never touches a hand-authored override (no syncedFrom)", () => {
    writeConfig(projectRoot, { ...defaultish, reports: { backend: { id: "backend" } } });
    fs.mkdirSync(path.join(projectRoot, ".claude", "reports"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".claude", "reports", "backend.md"), "MY OWN WORDS");
    const summary = syncProjectReports(projectRoot, dbPath);
    expect(summary.materialized).not.toContain("backend");
    expect(summary.refreshed).not.toContain("backend");
    expect(summary.staleCustomized).not.toContain("backend");
    expect(fs.readFileSync(path.join(projectRoot, ".claude", "reports", "backend.md"), "utf8")).toBe("MY OWN WORDS");
  });

  it("flags a synced copy the user edited as stale-but-customized, and leaves it alone", () => {
    writeConfig(projectRoot, { ...defaultish });
    syncProjectReports(projectRoot, dbPath);
    fs.appendFileSync(path.join(projectRoot, ".claude", "reports", "backend.md"), "\nEDITED BY HAND");
    const summary = syncProjectReports(projectRoot, dbPath);
    expect(summary.staleCustomized).toEqual(["backend"]);
    expect(fs.readFileSync(path.join(projectRoot, ".claude", "reports", "backend.md"), "utf8")).toContain(
      "EDITED BY HAND"
    );
  });

  it("refreshes an unmodified copy when the global default's version has advanced", () => {
    writeConfig(projectRoot, { ...defaultish });
    syncProjectReports(projectRoot, dbPath);

    // Bump the global default directly — simulates a future global-editing UI publishing v2.
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE reports SET content = ?, version = 2 WHERE report_id = 'backend'").run("NEW CONTENT v2");
    db.close();

    const summary = syncProjectReports(projectRoot, dbPath);
    expect(summary.refreshed).toEqual(["backend"]);
    expect(fs.readFileSync(path.join(projectRoot, ".claude", "reports", "backend.md"), "utf8")).toBe("NEW CONTENT v2");
    expect(readConfig(projectRoot)!.reports!.backend.syncedFrom).toEqual({
      version: 2,
      hash: expect.any(String),
    });
  });
});

// The seed only fires on a store that has never been written to, so on any machine that already
// has this db, editing SEED_REPORTS does nothing at all — the new field is in the source and the
// agents never see it, with nothing to report the discrepancy. `refreshSupersededSeeds` is what
// closes that, and it has to do so WITHOUT eating an edit the user made from /templates.
describe("superseded seed migration", () => {
  let dir: string;
  let dbPath: string;

  // The v1 backend body, verbatim — what a store seeded before the concept-skills feature holds.
  const BACKEND_V1 =
    "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
    "\n" +
    "```json\n" +
    "{\n" +
    '  "subagent": "backend",\n' +
    '  "verdict": "SUCCESS | FAIL",\n' +
    '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
    '  "filesChanged": ["<file1>", "<file2>"],\n' +
    '  "description": "<summary of what was implemented>"\n' +
    "}\n" +
    "```";

  // The v2 backend body, verbatim — what a store seeded before `036` moved `conceptSkillGaps` and
  // `filesChanged` off the report and onto the agent's channel holds.
  const BACKEND_V2 =
    "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
    "\n" +
    "```json\n" +
    "{\n" +
    '  "subagent": "backend",\n' +
    '  "verdict": "SUCCESS | FAIL",\n' +
    '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
    '  "conceptSkillGaps": [{ "skill": "<concept-skill-id>", "missing": "<what it did not tell you>" }],\n' +
    '  "filesChanged": ["<file1>", "<file2>"],\n' +
    '  "description": "<summary of what was implemented>"\n' +
    "}\n" +
    "```\n" +
    "\n" +
    "`conceptSkillGaps` is how a concept skill gets better: if one of the concept skills you loaded " +
    "was missing something you had to work out from the code yourself, say which skill and what was " +
    "missing, so the main session knows to hand it to the scribe. Leave the array empty when nothing " +
    "was missing — do not invent a gap to fill the field.";

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-seed-migration-"));
    dbPath = path.join(dir, "reports.sqlite");
    // A store that predates the current seed: rows present, so seedIfEmpty will not fire.
    const db = new DatabaseSync(dbPath);
    db.exec(
      "CREATE TABLE reports (report_id TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL);" +
        "CREATE TABLE agent_reports (agent_name TEXT PRIMARY KEY, report_id TEXT NOT NULL);"
    );
    db.prepare("INSERT INTO reports VALUES ('backend', ?, 1)").run(BACKEND_V1);
    db.prepare("INSERT INTO reports VALUES ('scribe', 'I EDITED THIS MYSELF', 4)").run();
    db.exec("INSERT INTO agent_reports VALUES ('backend', 'backend'), ('scribe', 'scribe')");
    db.close();
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("moves a row still carrying a superseded (v1) seed forward, straight to current, and bumps its version", () => {
    const row = readAgentReportDefault("backend", dbPath)!;
    expect(row.content).not.toContain('"conceptSkillGaps"');
    expect(row.content).not.toContain('"filesChanged"');
    expect(row.content).toContain(".claude/channels/scribe/backend.1.md");
    expect(row.version).toBe(2);
  });

  // `036`: an ALREADY-SEEDED store (one that opened between the concept-skills feature and this
  // slice) carries the v2 body — with `conceptSkillGaps` still a report field — and must be carried
  // forward too. This is the assertion `036`'s own acceptance criteria calls for: against a store
  // seeded with the OLD bodies, not a fresh one.
  it("moves a row still carrying a superseded (v2, pre-036) seed forward too", () => {
    const db = new DatabaseSync(dbPath);
    db.prepare("UPDATE reports SET content = ?, version = 1 WHERE report_id = 'backend'").run(BACKEND_V2);
    db.close();

    const row = readAgentReportDefault("backend", dbPath)!;
    expect(row.content).not.toContain('"conceptSkillGaps"');
    expect(row.content).not.toContain('"filesChanged"');
    expect(row.content).toContain(".claude/channels/scribe/backend.1.md");
    expect(row.version).toBe(2);
  });

  it("leaves a row the user edited exactly as it is", () => {
    const row = readAgentReportDefault("scribe", dbPath)!;
    expect(row.content).toBe("I EDITED THIS MYSELF");
    expect(row.version).toBe(4);
  });

  it("is idempotent — a second open does not bump again", () => {
    readAgentReportDefault("backend", dbPath);
    const row = readAgentReportDefault("backend", dbPath)!;
    expect(row.version).toBe(2);
  });
});
