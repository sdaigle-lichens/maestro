// Agent project tags — the other half of the project ↔ agent mapping (see project-tags.ts for the
// catalog side). Mirrors report-defaults.test.ts's shape: a fresh db path per test, isolated from
// the real ~/.claude/maestro-agent-project-tags.sqlite.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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

  it("seeds the seven bundled agents on first read against a fresh db path", () => {
    expect(readAllAgentProjectTags(dbPath)).toEqual({
      backend: "backend",
      frontend: "frontend",
      mobile: "mobile",
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
