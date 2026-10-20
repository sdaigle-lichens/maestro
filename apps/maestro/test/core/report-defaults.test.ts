// Report defaults (the global tier), the pure resolution order, and the install/update sync step.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { DatabaseSync } from "node:sqlite";
import {
  readAgentReportDefault,
  readAllAgentReportDefaults,
  priorReportSeeds,
} from "../../src/core/report-defaults.js";
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

  // The v1 backend body, verbatim — what a store seeded before the concept-skill feature holds.
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

  // `036`: an ALREADY-SEEDED store (one that opened between the concept-skill feature and this
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

// `090`: the gap note went generic (`skill_gaps`, no "concept skill" wording) and the scribe report
// dropped `conceptSkillsUpdated`. A store already seeded with the pre-090 bodies must upgrade; the
// bodies below are verbatim copies of what shipped before, NOT imported from the source.
describe("superseded seed migration (090: generic skill_gaps)", () => {
  const SHAPE = (subagent: string) =>
    "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
    "\n" +
    "```json\n" +
    "{\n" +
    `  "subagent": "${subagent}",\n` +
    '  "verdict": "SUCCESS | FAIL",\n' +
    '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n';
  const IMPL_TAIL = '  "description": "<summary of what was implemented>"\n' + "}\n" + "```\n" + "\n";
  const OLD_NOTE = (subagent: string) =>
    "If a concept skill you loaded was missing something you had to work out from the code " +
    `yourself, write \`.claude/channels/scribe/${subagent}.1.md\` with a fenced \`json\` block: ` +
    '`{ "concept_skill_gaps": [{ "skill": "<concept-skill-id>", "missing": "<what it did not tell you>" }] }`. ' +
    "Leave it unwritten when nothing was missing — do not write a gap just to fill the file.";
  const HANDOFF_NOTE =
    'Your `"verdict"` and your final `HANDOFF:` line must agree. A real defect must end with the matching ' +
    "condition-edge label when the workflow has one. A verdict of FAIL with `HANDOFF: success` is invalid, " +
    "and so is ending with no `HANDOFF:` line — the orchestrator is told about both and never treats either as success.";

  // What the backend / frontend / mobile / infra rows held immediately before 090.
  const preBackendLike = (subagent: string) => SHAPE(subagent) + IMPL_TAIL + OLD_NOTE(subagent) + "\n\n" + HANDOFF_NOTE;
  const preTest = () =>
    SHAPE("test") +
    '  "testResult": "<N passed, N failed>",\n' +
    '  "description": "<summary of what was tested>"\n' +
    "}\n" +
    "```\n" +
    "\n" +
    OLD_NOTE("test") +
    "\n\n" +
    HANDOFF_NOTE;
  const preScribe =
    "Always return a JSON report at the end of your work. Output it as a fenced `json` code block:\n" +
    "\n" +
    "```json\n" +
    "{\n" +
    '  "subagent": "scribe",\n' +
    '  "skillsTriage": { "loaded": ["<skill-id>"], "skipped": [{ "id": "<skill-id>", "reason": "<why skipped>" }] },\n' +
    '  "agentsMdUpdated": 0,\n' +
    '  "docsUpdated": 0,\n' +
    '  "claudeFilesUpdated": 0,\n' +
    '  "conceptSkillsUpdated": 0,\n' +
    '  "changelogUpdated": false,\n' +
    '  "description": "<summary of what was updated>"\n' +
    "}\n" +
    "```\n" +
    "\n" +
    '"Claude files" covers any file under `.claude/agents/`, `.claude/rules/`, or `.claude/skills/`. ' +
    "Use the counts to keep the handoff message small — do not list individual file names unless the caller asks.\n" +
    "\n" +
    "`conceptSkillsUpdated` counts concept skills you created or revised — it is a subset of " +
    "`claudeFilesUpdated`, broken out because the caller usually wants to know whether the concept " +
    "list moved without reading the whole summary.";

  let dir: string;
  let dbPath: string;

  /** A store that already holds `rows` (agent -> content) at version 5, so seedIfEmpty will not fire. */
  function storeWith(rows: Record<string, string>): void {
    const db = new DatabaseSync(dbPath);
    db.exec(
      "CREATE TABLE reports (report_id TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL);" +
        "CREATE TABLE agent_reports (agent_name TEXT PRIMARY KEY, report_id TEXT NOT NULL);"
    );
    for (const [agent, content] of Object.entries(rows)) {
      db.prepare("INSERT INTO reports VALUES (?, ?, 5)").run(agent, content);
      db.prepare("INSERT INTO agent_reports VALUES (?, ?)").run(agent, agent);
    }
    db.close();
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-seed-090-"));
    dbPath = path.join(dir, "reports.sqlite");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it.each(["backend", "frontend", "mobile", "infra"])(
    "%s: a stored pre-090 body upgrades to the generic skill_gaps note and bumps the version",
    (agent) => {
      storeWith({ [agent]: preBackendLike(agent) });
      const row = readAgentReportDefault(agent, dbPath)!;
      expect(row.version).toBe(6);
      expect(row.content).toContain('"skill_gaps"');
      expect(row.content).not.toContain("concept_skill_gaps");
      expect(row.content).not.toContain("concept skill");
      expect(row.content).toContain(`.claude/channels/scribe/${agent}.1.md`);
      expect(row.content).toContain("`HANDOFF:` line must agree"); // the 083 note survives
      expect(readAgentReportDefault(agent, dbPath)!.version).toBe(6); // idempotent
    }
  );

  it("test: a stored pre-090 body upgrades too", () => {
    storeWith({ test: preTest() });
    const row = readAgentReportDefault("test", dbPath)!;
    expect(row.version).toBe(6);
    expect(row.content).toContain('"skill_gaps"');
    expect(row.content).not.toContain("concept_skill_gaps");
    expect(row.content).toContain("`HANDOFF:` line must agree");
  });

  it("scribe: a stored body that counts conceptSkillsUpdated upgrades to one that does not", () => {
    storeWith({ scribe: preScribe });
    const row = readAgentReportDefault("scribe", dbPath)!;
    expect(row.version).toBe(6);
    expect(row.content).not.toContain("conceptSkillsUpdated");
    expect(row.content).not.toContain("concept");
    expect(row.content).toContain('"claudeFilesUpdated"');
    expect(readAgentReportDefault("scribe", dbPath)!.version).toBe(6);
  });

  it("scribe: the current body is not its own prior (no bump on every open)", () => {
    const fresh = path.join(dir, "fresh.sqlite");
    const first = readAgentReportDefault("scribe", fresh)!;
    expect(readAgentReportDefault("scribe", fresh)!.version).toBe(first.version);
    expect(priorReportSeeds("scribe")).not.toContain(first.content);
    expect(priorReportSeeds("test")).not.toContain(readAgentReportDefault("test", fresh)!.content);
  });

  // `114`: the scribe default gains its ending rule (SKILL_GAPS_HANDLED: then HANDOFF: success). The
  // post-090 body — preScribe minus the conceptSkillsUpdated field and paragraph — must upgrade.
  it("scribe: the post-090 body upgrades to one carrying the ending lines, gap line first", () => {
    const post090 = preScribe
      .replace('  "conceptSkillsUpdated": 0,\n', "")
      .replace(/\n\n`conceptSkillsUpdated`[\s\S]*$/, "");
    expect(priorReportSeeds("scribe")).toContain(post090);
    storeWith({ scribe: post090 });
    const row = readAgentReportDefault("scribe", dbPath)!;
    expect(row.version).toBe(6);
    expect(row.content.startsWith(post090)).toBe(true);
    expect(row.content).toContain("`HANDOFF: success` when the documentation is done");
    expect(row.content).toContain("`HANDOFF: partial`");
    expect(row.content.indexOf("SKILL_GAPS_HANDLED:")).toBeGreaterThan(-1);
    expect(row.content.indexOf("SKILL_GAPS_HANDLED:")).toBeLessThan(row.content.indexOf("`HANDOFF: <label>`"));
    expect(readAgentReportDefault("scribe", dbPath)!.version).toBe(6);
  });

  // `114` (test): a pre-090 store skips straight past V1 — it must land on the body WITH the ending
  // lines, not on the V1 body that is now itself a prior.
  it("scribe: a pre-090 body upgrades straight to the current body, ending lines included", () => {
    storeWith({ scribe: preScribe });
    const row = readAgentReportDefault("scribe", dbPath)!;
    const fresh = readAgentReportDefault("scribe", path.join(dir, "fresh.sqlite"))!;
    expect(row.content).toBe(fresh.content);
    expect(row.content).toContain("`HANDOFF: success` when the documentation is done");
  });

  // `114` (test): a project seeded from scratch gets the ending rule too, and the committed plugin
  // bundle — what the hooks actually run — seeds the same body as the TypeScript source.
  it("scribe: a fresh seed carries the ending lines, and the plugin bundle seeds the same body", async () => {
    const fresh = readAgentReportDefault("scribe", path.join(dir, "fresh.sqlite"))!;
    expect(fresh.content).toMatch(/SKILL_GAPS_HANDLED: <file>[\s\S]*`HANDOFF: <label>` — always last/);
    expect(fresh.content).toContain("`done` or `complete` is not a label");
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    const bundle = require(
      path.resolve(
        path.dirname(new URL(import.meta.url).pathname),
        "../../../../plugins/maestro/scripts/lib/maestro-report-defaults.cjs"
      )
    ) as { readAgentReportDefault: typeof readAgentReportDefault };
    const fromBundle = bundle.readAgentReportDefault("scribe", path.join(dir, "bundle.sqlite"))!;
    expect(fromBundle.content).toBe(fresh.content);
  });

  it("every seeded agent's pre-090 body is among its recorded priors", () => {
    for (const a of ["backend", "frontend", "mobile", "infra"])
      expect(priorReportSeeds(a)).toContain(preBackendLike(a));
    expect(priorReportSeeds("test")).toContain(preTest());
    expect(priorReportSeeds("scribe")).toContain(preScribe);
  });

  it("a hand-edited body that merely extends the pre-090 one is left alone", () => {
    storeWith({ backend: preBackendLike("backend") + "\nMY EXTRA RULE" });
    const row = readAgentReportDefault("backend", dbPath)!;
    expect(row.version).toBe(5);
    expect(row.content).toContain("MY EXTRA RULE");
  });

  it("a project file holding a pre-090 body is adopted and refreshed by the sync", () => {
    const root = path.join(dir, "project");
    fs.mkdirSync(path.join(root, ".claude", "reports"), { recursive: true });
    writeConfig(root, defaultish);
    const file = path.join(root, ".claude", "reports", "backend.md");
    fs.writeFileSync(file, preBackendLike("backend"));
    const summary = syncProjectReports(root, dbPath);
    expect(JSON.stringify(summary)).toContain("backend");
    expect(fs.readFileSync(file, "utf8")).toContain('"skill_gaps"');
  });
});
