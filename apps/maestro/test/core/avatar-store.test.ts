// Agent avatars: the global (per agent name, not per project) SQLite store.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { getAvatar, readAllAvatars, setAvatar } from "../../src/core/avatar-store.js";
import { AVATAR_CATEGORIES, AVATAR_PARTS, type AvatarLayers } from "../../src/core/contracts.js";

function fullLayers(): AvatarLayers {
  const layers = {} as AvatarLayers;
  for (const cat of AVATAR_CATEGORIES) layers[cat] = AVATAR_PARTS[cat][0].id;
  return layers;
}

describe("getAvatar / setAvatar", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-avatars-"));
    dbPath = path.join(dir, "avatars.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("returns null for an agent with no saved avatar", () => {
    expect(getAvatar("nobody", dbPath)).toBeNull();
  });

  it("round-trips a full set of layers", () => {
    const layers = fullLayers();
    setAvatar("reviewer", layers, dbPath);
    expect(getAvatar("reviewer", dbPath)).toEqual(layers);
  });

  it("round-trips null in an optional category", () => {
    const layers = { ...fullLayers(), hat: null };
    setAvatar("reviewer", layers, dbPath);
    expect(getAvatar("reviewer", dbPath)).toEqual(layers);
  });

  it("a second save replaces the first (upsert, not append)", () => {
    setAvatar("reviewer", fullLayers(), dbPath);
    const changed = { ...fullLayers(), hair: null };
    setAvatar("reviewer", changed, dbPath);
    expect(getAvatar("reviewer", dbPath)).toEqual(changed);
  });

  it("rejects a category id that isn't a real option", () => {
    const bad = { ...fullLayers(), sex: "not-a-real-id" };
    expect(() => setAvatar("reviewer", bad as AvatarLayers, dbPath)).toThrow();
  });

  it("rejects a payload missing a category entirely", () => {
    const bad = fullLayers();
    delete (bad as Partial<AvatarLayers>).eyes;
    expect(() => setAvatar("reviewer", bad, dbPath)).toThrow();
  });

  it("round-trips a hex eyesColor", () => {
    const layers = { ...fullLayers(), eyes: "brows", eyesColor: "#a0522d" };
    setAvatar("reviewer", layers, dbPath);
    expect(getAvatar("reviewer", dbPath)).toEqual(layers);
  });

  it("round-trips a null eyesColor (the upstream color, unrecolored)", () => {
    const layers = { ...fullLayers(), eyes: "brows", eyesColor: null };
    setAvatar("reviewer", layers, dbPath);
    expect(getAvatar("reviewer", dbPath)).toEqual(layers);
  });

  it("rejects an eyesColor that isn't a #rrggbb hex string", () => {
    const bad = { ...fullLayers(), eyesColor: "chartreuse" };
    expect(() => setAvatar("reviewer", bad as AvatarLayers, dbPath)).toThrow();
  });

  it("round-trips a hex hairColor", () => {
    const layers = { ...fullLayers(), hair: "bob", hairColor: "#8b5fbf" };
    setAvatar("reviewer", layers, dbPath);
    expect(getAvatar("reviewer", dbPath)).toEqual(layers);
  });

  it("round-trips a null hairColor (the upstream color, unrecolored)", () => {
    const layers = { ...fullLayers(), hair: "bob", hairColor: null };
    setAvatar("reviewer", layers, dbPath);
    expect(getAvatar("reviewer", dbPath)).toEqual(layers);
  });

  it("rejects a hairColor that isn't a #rrggbb hex string", () => {
    const bad = { ...fullLayers(), hairColor: "chartreuse" };
    expect(() => setAvatar("reviewer", bad as AvatarLayers, dbPath)).toThrow();
  });
});

// The /agents list draws a thumb per row, so it reads the whole store in one call rather than
// opening it once per agent.
describe("readAllAvatars", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-avatars-all-"));
    dbPath = path.join(dir, "avatars.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("is empty on a store nothing has been written to", () => {
    expect(readAllAvatars(dbPath)).toEqual({});
  });

  it("returns every saved avatar keyed by agent name", () => {
    const reviewer = fullLayers();
    const scribe = { ...fullLayers(), hat: null };
    setAvatar("reviewer", reviewer, dbPath);
    setAvatar("scribe", scribe, dbPath);
    expect(readAllAvatars(dbPath)).toEqual({ reviewer, scribe });
  });

  it("skips a row that no longer validates instead of failing the whole read", () => {
    setAvatar("reviewer", fullLayers(), dbPath);
    const db = new DatabaseSync(dbPath);
    try {
      db.prepare("INSERT INTO agent_avatars (agent_name, layers) VALUES (?, ?)").run("stale", '{"body":"gone"}');
      db.prepare("INSERT INTO agent_avatars (agent_name, layers) VALUES (?, ?)").run("broken", "not json");
    } finally {
      db.close();
    }
    expect(Object.keys(readAllAvatars(dbPath))).toEqual(["reviewer"]);
  });
});

// The keying change 030 exists for: a project-tier agent's avatar must not collide with a
// same-named agent in another project, and a user/maestro/plugin-tier one must still resolve to
// one shared row from any project.
describe("project scoping (030)", () => {
  let dir: string;
  let dbPath: string;
  let projectA: string;
  let projectB: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-avatars-scope-"));
    dbPath = path.join(dir, "avatars.sqlite");
    projectA = path.join(dir, "project-a");
    projectB = path.join(dir, "project-b");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("two projects with a same-named project agent hold independent avatars", () => {
    const hatted = { ...fullLayers(), hat: "bandana" };
    const bare = { ...fullLayers(), hat: null };
    setAvatar("reviewer", hatted, dbPath, projectA);
    setAvatar("reviewer", bare, dbPath, projectB);

    expect(getAvatar("reviewer", dbPath, projectA)).toEqual(hatted);
    expect(getAvatar("reviewer", dbPath, projectB)).toEqual(bare);
    expect(readAllAvatars(dbPath, projectA).reviewer).toEqual(hatted);
    expect(readAllAvatars(dbPath, projectB).reviewer).toEqual(bare);
  });

  it("a project's own row overrides the global one for that project only", () => {
    const global = fullLayers();
    const overridden = { ...fullLayers(), hat: "bandana" };
    setAvatar("reviewer", global, dbPath);
    setAvatar("reviewer", overridden, dbPath, projectA);

    expect(getAvatar("reviewer", dbPath, projectA)).toEqual(overridden);
    expect(getAvatar("reviewer", dbPath, projectB)).toEqual(global);
    expect(readAllAvatars(dbPath, projectB).reviewer).toEqual(global);
    expect(readAllAvatars(dbPath).reviewer).toEqual(global);
  });

  it("omitting projectRoot reads and writes only the global row, regardless of any project-scoped rows", () => {
    const scoped = { ...fullLayers(), hat: "bandana" };
    setAvatar("reviewer", scoped, dbPath, projectA);
    expect(getAvatar("reviewer", dbPath)).toBeNull();
    const global = fullLayers();
    setAvatar("reviewer", global, dbPath);
    expect(getAvatar("reviewer", dbPath)).toEqual(global);
    expect(getAvatar("reviewer", dbPath, projectA)).toEqual(scoped);
  });
});
