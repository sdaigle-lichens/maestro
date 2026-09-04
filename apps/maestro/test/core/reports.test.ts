// The /agents page's data access: getResolvedReport (read) and saveProjectReportOverride (write).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { getResolvedReport, saveProjectReportOverride } from "../../src/core/reports.js";
import { readAgentReportDefault } from "../../src/core/report-defaults.js";
import { isValidReportId } from "../../src/core/report-resolution.js";
import { syncProjectReports } from "../../src/core/report-sync.js";
import { defaultish } from "./fixtures/configs.js";
import { readConfig, writeConfig, blankConfig } from "../../src/core/config.js";

describe("getResolvedReport / saveProjectReportOverride", () => {
  let dir: string;
  let dbPath: string;
  let projectRoot: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-reports-"));
    dbPath = path.join(dir, "reports.sqlite");
    projectRoot = path.join(dir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("resolves to the global default when the project has no override", () => {
    const global = readAgentReportDefault("backend", dbPath)!;
    const res = getResolvedReport(projectRoot, "backend", dbPath);
    expect(res.source).toBe("global");
    expect(res.content).toBe(global.content);
  });

  it("resolves to none for an agent with no global default and no project", () => {
    expect(getResolvedReport(projectRoot, "refactor", dbPath)).toEqual({ source: "none", content: "" });
  });

  it("resolves to none against no open project (empty projectRoot) when there's no global default", () => {
    expect(getResolvedReport("", "refactor", dbPath)).toEqual({ source: "none", content: "" });
  });

  it("still resolves the global tier against no open project", () => {
    const global = readAgentReportDefault("test", dbPath)!;
    expect(getResolvedReport("", "test", dbPath)).toEqual({ source: "global", content: global.content });
  });

  it("save always writes a project override keyed by the agent's own name", () => {
    const res = saveProjectReportOverride(projectRoot, "backend", "my custom report");
    expect(res).toEqual({ source: "project", content: "my custom report" });
    expect(fs.readFileSync(path.join(projectRoot, ".claude", "reports", "backend.md"), "utf8")).toBe(
      "my custom report"
    );
    const cfg = readConfig(projectRoot)!;
    expect(cfg.reports).toEqual({ backend: { id: "backend" } });
  });

  it("editing one agent never changes what another agent resolves to, even sharing a global id", () => {
    saveProjectReportOverride(projectRoot, "backend", "backend's own words");
    const frontendResolved = getResolvedReport(projectRoot, "frontend", dbPath);
    // frontend has its own seeded global default, untouched by backend's project override.
    expect(frontendResolved.source).toBe("global");
    expect(frontendResolved.content).not.toBe("backend's own words");
  });

  it("a save drops any inherited syncedFrom — it's a hand-authored override now", () => {
    const cfg = { ...blankConfig(), reports: { backend: { id: "backend", syncedFrom: { version: 1, hash: "x" } } } };
    writeConfig(projectRoot, cfg);
    saveProjectReportOverride(projectRoot, "backend", "overwritten by hand");
    expect(readConfig(projectRoot)!.reports).toEqual({ backend: { id: "backend" } });
  });

  it("a saved override is what resolves afterward", () => {
    saveProjectReportOverride(projectRoot, "backend", "the project's own words");
    expect(getResolvedReport(projectRoot, "backend", dbPath)).toEqual({
      source: "project",
      content: "the project's own words",
    });
  });
});

// The report id becomes `.claude/reports/<id>.md`, and it arrives from a hand-editable
// maestro.json (or straight off the renderer on a save). `033` added the equivalent guard to the
// handoff path and fixed this one at the same time — it had none at all.
describe("report id path safety", () => {
  let dir: string;
  let dbPath: string;
  let projectRoot: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-report-ids-"));
    dbPath = path.join(dir, "reports.sqlite");
    projectRoot = path.join(dir, "project");
    fs.mkdirSync(projectRoot, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("accepts a bare name and rejects anything that could escape the reports directory", () => {
    expect(isValidReportId("backend")).toBe(true);
    expect(isValidReportId("my-agent_2")).toBe(true);
    for (const bad of ["../../etc/passwd", "a/b", "a\\b", ".", "..", "", "a.b", 3 as unknown]) {
      expect(isValidReportId(bad)).toBe(false);
    }
  });

  it("refuses to resolve or save through a malformed id", () => {
    expect(() => getResolvedReport(projectRoot, "../../etc/passwd", dbPath)).toThrow(/Invalid report id/);
    expect(() => saveProjectReportOverride(projectRoot, "../evil", "x")).toThrow(/Invalid report id/);
  });

  it("the sync skips a malformed entry instead of throwing the whole install away", () => {
    writeConfig(projectRoot, {
      ...defaultish,
      reports: { backend: { id: "../../escape" }, "../../also-bad": { id: "fine" } },
    });
    const summary = syncProjectReports(projectRoot, dbPath);
    expect(summary.materialized).toEqual(expect.arrayContaining(["scribe", "test"]));
    for (const bucket of Object.values(summary)) {
      expect(bucket).not.toContain("backend");
      expect(bucket).not.toContain("../../also-bad");
    }
    expect(fs.existsSync(path.join(dir, "escape.md"))).toBe(false);
  });
});
