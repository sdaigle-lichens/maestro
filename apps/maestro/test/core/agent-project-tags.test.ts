// Agent project tags — the other half of the project ↔ agent mapping (see project-tags.ts for the
// catalog side). Mirrors report-defaults.test.ts's shape: a fresh db path per test, isolated from
// the real ~/.claude/maestro-agent-project-tags.sqlite.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  readAllAgentProjectTags,
  setAgentProjectTag,
  agentsForProjectTags,
} from "../../src/core/agent-project-tags.js";

describe("readAllAgentProjectTags", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-project-tags-"));
    dbPath = path.join(dir, "agent-project-tags.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("seeds the eight bundled agents on first read against a fresh db path", () => {
    expect(readAllAgentProjectTags(dbPath)).toEqual({
      backend: "backend",
      frontend: "frontend",
      mobile: "mobile",
      infra: "infra",
      refactor: "global",
      reviewer: "global",
      scribe: "global",
      test: "global",
    });
  });

  it("seeding is idempotent across repeated opens of the same db file", () => {
    const first = readAllAgentProjectTags(dbPath);
    const second = readAllAgentProjectTags(dbPath);
    expect(second).toEqual(first);
  });

  it("creates the db's parent directory when it doesn't exist yet", () => {
    const nested = path.join(dir, "does", "not", "exist", "agent-project-tags.sqlite");
    expect(readAllAgentProjectTags(nested)).not.toEqual({});
    expect(fs.existsSync(nested)).toBe(true);
  });
});

describe("setAgentProjectTag", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-project-tags-set-"));
    dbPath = path.join(dir, "agent-project-tags.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("replaces, not appends — an agent has exactly one project tag", () => {
    expect(setAgentProjectTag("backend", "frontend", dbPath)).toBe("frontend");
    expect(setAgentProjectTag("backend", "mobile", dbPath)).toBe("mobile");
    const all = readAllAgentProjectTags(dbPath);
    expect(all.backend).toBe("mobile");
  });

  it("accepts an arbitrary catalog value, not a fixed union — no AgentType-style validation", () => {
    expect(setAgentProjectTag("backend", "some-new-catalog-tag", dbPath)).toBe("some-new-catalog-tag");
    expect(readAllAgentProjectTags(dbPath).backend).toBe("some-new-catalog-tag");
  });

  it("assigns a project tag to a project-local agent with no prior row", () => {
    expect(setAgentProjectTag("my-custom-agent", "backend", dbPath)).toBe("backend");
    expect(readAllAgentProjectTags(dbPath)["my-custom-agent"]).toBe("backend");
  });

  it("trims, and rejects an empty tag", () => {
    expect(setAgentProjectTag("backend", "  frontend  ", dbPath)).toBe("frontend");
    expect(() => setAgentProjectTag("backend", "   ", dbPath)).toThrow(/can't be empty/);
  });
});

describe("agentsForProjectTags", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-project-tags-lookup-"));
    dbPath = path.join(dir, "agent-project-tags.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns the bundled agents matching the given tags, sorted", () => {
    expect(agentsForProjectTags(["backend", "mobile"], dbPath)).toEqual(["backend", "mobile"]);
  });

  it("matches 'global' like any other value — it's a real stored tag, just not a project-tags catalog entry", () => {
    expect(agentsForProjectTags(["global"], dbPath)).toEqual(["refactor", "reviewer", "scribe", "test"]);
  });

  it("reflects a reassignment immediately", () => {
    setAgentProjectTag("test", "frontend", dbPath);
    expect(agentsForProjectTags(["frontend"], dbPath)).toEqual(["frontend", "test"]);
    expect(agentsForProjectTags(["global"], dbPath)).toEqual(["refactor", "reviewer", "scribe"]);
  });

  it("returns an empty list for a tag nothing is assigned to", () => {
    expect(agentsForProjectTags(["some-unused-tag"], dbPath)).toEqual([]);
  });
});

// The keying change 030 exists for: a project-tier agent's project tag must not collide with a
// same-named agent in another project, and a user/maestro/plugin-tier one must still resolve to
// one shared row from any project.
describe("project scoping (030)", () => {
  let dir: string;
  let dbPath: string;
  let projectA: string;
  let projectB: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-project-tags-scope-"));
    dbPath = path.join(dir, "agent-project-tags.sqlite");
    projectA = path.join(dir, "project-a");
    projectB = path.join(dir, "project-b");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("two projects with a same-named project agent hold independent project tags", () => {
    setAgentProjectTag("reviewer", "frontend", dbPath, projectA);
    setAgentProjectTag("reviewer", "mobile", dbPath, projectB);

    expect(readAllAgentProjectTags(dbPath, projectA).reviewer).toBe("frontend");
    expect(readAllAgentProjectTags(dbPath, projectB).reviewer).toBe("mobile");
  });

  it("a project's own row overrides the global one for that project only", () => {
    setAgentProjectTag("backend", "backend", dbPath);
    setAgentProjectTag("backend", "mobile", dbPath, projectA);

    expect(readAllAgentProjectTags(dbPath, projectA).backend).toBe("mobile");
    expect(readAllAgentProjectTags(dbPath, projectB).backend).toBe("backend");
    expect(readAllAgentProjectTags(dbPath).backend).toBe("backend");
  });

  it("omitting projectRoot reads and writes only the global row, regardless of any project-scoped rows", () => {
    setAgentProjectTag("reviewer", "frontend", dbPath, projectA);
    expect(readAllAgentProjectTags(dbPath).reviewer).toBe("global"); // untouched seed value
    setAgentProjectTag("reviewer", "backend", dbPath);
    expect(readAllAgentProjectTags(dbPath).reviewer).toBe("backend");
    expect(readAllAgentProjectTags(dbPath, projectA).reviewer).toBe("frontend");
  });

  it("agentsForProjectTags scoped to a project doesn't return another project's same-named, same-tagged agent", () => {
    setAgentProjectTag("reviewer", "frontend", dbPath, projectA);
    setAgentProjectTag("reviewer", "frontend", dbPath, projectB);

    expect(agentsForProjectTags(["frontend"], dbPath, projectA)).toEqual(["frontend", "reviewer"]);
    expect(agentsForProjectTags(["frontend"], dbPath, projectB)).toEqual(["frontend", "reviewer"]);
    // Unscoped, both projects' rows collapse into the same key — which is exactly why a caller
    // that cares about a single project must pass its root.
    expect(agentsForProjectTags(["frontend"], dbPath)).toEqual(["frontend"]);
  });

  it("drops a pre-030 table (no project_root column) and reseeds, rather than erroring", () => {
    fs.mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE agent_project_tags (agent_name TEXT PRIMARY KEY, project_tag TEXT NOT NULL)");
    db.prepare("INSERT INTO agent_project_tags (agent_name, project_tag) VALUES (?, ?)").run("backend", "global");
    db.close();

    expect(readAllAgentProjectTags(dbPath)).toEqual({
      backend: "backend",
      frontend: "frontend",
      mobile: "mobile",
      infra: "infra",
      refactor: "global",
      reviewer: "global",
      scribe: "global",
      test: "global",
    });
  });
});
