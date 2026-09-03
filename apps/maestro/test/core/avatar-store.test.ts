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
    const bad = { ...fullLayers(), body: "not-a-real-id" };
    expect(() => setAvatar("reviewer", bad as AvatarLayers, dbPath)).toThrow();
  });

  it("rejects a payload missing a category entirely", () => {
    const bad = fullLayers();
    delete (bad as Partial<AvatarLayers>).eyes;
    expect(() => setAvatar("reviewer", bad, dbPath)).toThrow();
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
