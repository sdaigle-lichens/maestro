// Agent types — the developer|planner|reviewer|annotator|tester classification. Mirrors
// agent-project-tags.test.ts's shape: a fresh db path per test, isolated from the real
// ~/.claude/maestro-agent-types.sqlite.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { readAllAgentTypes, setAgentType } from "../../src/core/agent-types.js";

describe("readAllAgentTypes", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-types-"));
    dbPath = path.join(dir, "agent-types.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("seeds the eight bundled agents on first read against a fresh db path", () => {
    expect(readAllAgentTypes(dbPath)).toEqual({
      backend: "developer",
      frontend: "developer",
      mobile: "developer",
      infra: "developer",
      refactor: "planner",
      reviewer: "reviewer",
      scribe: "annotator",
      test: "tester",
    });
  });

  it("seeding is idempotent across repeated opens of the same db file", () => {
    const first = readAllAgentTypes(dbPath);
    const second = readAllAgentTypes(dbPath);
    expect(second).toEqual(first);
  });

  it("creates the db's parent directory when it doesn't exist yet", () => {
    const nested = path.join(dir, "does", "not", "exist", "agent-types.sqlite");
    expect(readAllAgentTypes(nested)).not.toEqual({});
    expect(fs.existsSync(nested)).toBe(true);
  });
});

describe("setAgentType", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-types-set-"));
    dbPath = path.join(dir, "agent-types.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("replaces, not appends — an agent has exactly one type", () => {
    expect(setAgentType("backend", "planner", dbPath)).toBe("planner");
    expect(setAgentType("backend", "tester", dbPath)).toBe("tester");
    expect(readAllAgentTypes(dbPath).backend).toBe("tester");
  });

  it("rejects a tag outside the closed vocabulary", () => {
    // @ts-expect-error deliberately not a real AgentType, to exercise the runtime guard
    expect(() => setAgentType("backend", "not-a-real-type", dbPath)).toThrow(/Not a known agent type/);
  });

  it("assigns a type to a project-local agent with no prior row", () => {
    expect(setAgentType("my-custom-agent", "reviewer", dbPath)).toBe("reviewer");
    expect(readAllAgentTypes(dbPath)["my-custom-agent"]).toBe("reviewer");
  });
});

// The keying change 030 exists for: a project-tier agent's classification must not collide with a
// same-named agent in another project, and a user/maestro/plugin-tier one must still resolve to
// one shared row from any project.
describe("project scoping (030)", () => {
  let dir: string;
  let dbPath: string;
  let projectA: string;
  let projectB: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-types-scope-"));
    dbPath = path.join(dir, "agent-types.sqlite");
    projectA = path.join(dir, "project-a");
    projectB = path.join(dir, "project-b");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("two projects with a same-named project agent hold independent types", () => {
    setAgentType("reviewer", "planner", dbPath, projectA);
    setAgentType("reviewer", "tester", dbPath, projectB);

    expect(readAllAgentTypes(dbPath, projectA).reviewer).toBe("planner");
    expect(readAllAgentTypes(dbPath, projectB).reviewer).toBe("tester");
  });

  it("a global write is visible from every project that hasn't overridden it", () => {
    setAgentType("backend", "tester", dbPath);
    expect(readAllAgentTypes(dbPath, projectA).backend).toBe("tester");
    expect(readAllAgentTypes(dbPath, projectB).backend).toBe("tester");
  });

  it("a project's own row overrides the global one for that project only", () => {
    setAgentType("backend", "developer", dbPath);
    setAgentType("backend", "tester", dbPath, projectA);

    expect(readAllAgentTypes(dbPath, projectA).backend).toBe("tester");
    expect(readAllAgentTypes(dbPath, projectB).backend).toBe("developer");
    expect(readAllAgentTypes(dbPath).backend).toBe("developer");
  });

  it("omitting projectRoot reads and writes only the global row, regardless of any project-scoped rows", () => {
    setAgentType("reviewer", "planner", dbPath, projectA);
    expect(readAllAgentTypes(dbPath).reviewer).toBe("reviewer"); // untouched seed value
    setAgentType("reviewer", "annotator", dbPath);
    expect(readAllAgentTypes(dbPath).reviewer).toBe("annotator");
    expect(readAllAgentTypes(dbPath, projectA).reviewer).toBe("planner");
  });

  it("drops a pre-030 table (no project_root column) and reseeds, rather than erroring", () => {
    fs.mkdirSync(dir, { recursive: true });
    const db = new DatabaseSync(dbPath);
    db.exec("CREATE TABLE agent_types (agent_name TEXT PRIMARY KEY, tag TEXT NOT NULL)");
    db.prepare("INSERT INTO agent_types (agent_name, tag) VALUES (?, ?)").run("backend", "reviewer");
    db.close();

    expect(readAllAgentTypes(dbPath)).toEqual({
      backend: "developer",
      frontend: "developer",
      mobile: "developer",
      infra: "developer",
      refactor: "planner",
      reviewer: "reviewer",
      scribe: "annotator",
      test: "tester",
    });
  });
});
