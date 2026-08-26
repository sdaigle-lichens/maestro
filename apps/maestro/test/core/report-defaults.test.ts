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
    expect(Object.keys(all1).sort()).toEqual(["backend", "frontend", "mobile", "scribe", "test"]);
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
