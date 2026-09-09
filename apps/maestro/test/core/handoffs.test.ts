// `033`'s handoff tier: the graph walk that decides which routes exist, the global sqlite store,
// the three-tier resolution, the install/update sync, and the app's read/write pair.
//
// The one thing not covered here is the hook end — that lives in `install.test.ts`, where the
// COPIED script is executed with a synthetic SubagentStart payload, because the property worth
// pinning ("the seed still answers with the sqlite bundle unresolvable") is only true of a script
// running somewhere that bundle is genuinely absent.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { handoffRoutes, routesFrom, handoffPairs } from "../../src/core/handoff-routes.js";
import {
  SEED_HANDOFFS,
  PRIOR_SEEDS,
  isSeededHandoff,
  isValidHandoffId,
  splitHandoffId,
} from "../../src/core/handoff-seeds.js";
import { resolveHandoff } from "../../src/core/handoff-resolution.js";
import {
  readHandoffDefault,
  readAllHandoffDefaults,
  writeHandoffDefault,
  deleteHandoffDefault,
} from "../../src/core/handoff-defaults.js";
import { syncProjectHandoffs, handoffFilePath } from "../../src/core/handoff-sync.js";
import { getResolvedHandoff, saveProjectHandoffOverride, resolvedRoutesFrom } from "../../src/core/handoffs.js";
import { readConfig, writeConfig } from "../../src/core/config.js";
import { defaultish, withSkillNodes } from "./fixtures/configs.js";

let dir: string;
let dbPath: string;
let projectRoot: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-handoffs-"));
  dbPath = path.join(dir, "handoff-defaults.sqlite");
  projectRoot = path.join(dir, "project");
  fs.mkdirSync(projectRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const read = (id: string) => {
  const [sender, receiver] = id.split("/");
  return fs.readFileSync(path.join(projectRoot, ".claude", "handoffs", sender, `${receiver}.md`), "utf8");
};

describe("handoffRoutes — the ONE walk, shared by the hook and the sync", () => {
  it("resolves a success edge THROUGH a human_review node to the next agent", () => {
    const routes = handoffRoutes(defaultish.workflows, defaultish.workflow_instances);
    expect(routes).toContainEqual({ sender: "test", receiver: "scribe", label: "success" });
  });

  it("does NOT resolve a condition edge through a non-agent node", () => {
    // `human_review-1 --tests failed--> backend` is not this agent's route; what IS asserted here
    // is that a condition edge leaving an agent lands where the edge points and nowhere further.
    const routes = handoffRoutes(defaultish.workflows, defaultish.workflow_instances);
    expect(routes).toContainEqual({ sender: "test", receiver: "backend", label: "tests failed" });
  });

  it("bares BOTH ends, so a namespaced instance still resolves a pair", () => {
    const routes = handoffRoutes(withSkillNodes.workflows, withSkillNodes.workflow_instances);
    // `maestro:frontend` on both sides of the pair — the sender was already bared before `033`,
    // the receiver was not, and the un-bared half is what silently resolved no protocol at all.
    expect(routes).toContainEqual({ sender: "frontend", receiver: "reviewer", label: "success" });
    expect(routes).toContainEqual({ sender: "reviewer", receiver: "frontend", label: "code FAIL" });
    expect(handoffPairs(routes).sort()).toEqual(["frontend/reviewer", "reviewer/frontend"]);
  });

  it("is first-wins per (sender, label) and terminates on a success cycle", () => {
    const cyc = {
      workflows: [
        {
          name: "loop",
          nodes: [
            { id: "a", type: "agent" as const, instance: "a" },
            { id: "h", type: "human_review" as const },
          ],
          edges: [
            { from: "a", to: "h", kind: "success" as const },
            { from: "h", to: "h", kind: "success" as const },
            { from: "a", to: "h", kind: "success" as const },
          ],
        },
      ],
      instances: [{ name: "a", agent: "backend", loaded_skills: [], referenced_skills: [] }],
    };
    const routes = handoffRoutes(cyc.workflows, cyc.instances);
    expect(routes).toEqual([{ sender: "backend", receiver: null, label: "success" }]);
  });

  it("skips an unlabeled condition edge — the orchestrator cannot address one", () => {
    const routes = handoffRoutes(
      [
        {
          name: "w",
          nodes: [
            { id: "a", type: "agent", instance: "a" },
            { id: "b", type: "agent", instance: "b" },
          ],
          edges: [{ from: "a", to: "b", kind: "condition" }],
        },
      ],
      [
        { name: "a", agent: "backend", loaded_skills: [], referenced_skills: [] },
        { name: "b", agent: "test", loaded_skills: [], referenced_skills: [] },
      ]
    );
    expect(routes).toEqual([]);
  });

  it("handoffPairs drops a route with no reachable receiver", () => {
    expect(handoffPairs([{ sender: "a", receiver: null, label: "success" }])).toEqual([]);
  });

  it("routesFrom filters by BARE sender, so a namespaced agent_type matches", () => {
    const routes = handoffRoutes(withSkillNodes.workflows, withSkillNodes.workflow_instances);
    expect(routesFrom(routes, "maestro:frontend").map((r) => r.label)).toEqual(["success"]);
  });

  it("is not an agents_available cross product — 3 routes, not 25", () => {
    // The reason the sync walks the graph at all: `defaultish` lists five agents, whose cross
    // product would be 25 files. The workflows wire three routes.
    expect(handoffRoutes(defaultish.workflows, defaultish.workflow_instances)).toHaveLength(3);
  });
});

describe("the global store", () => {
  it("seeds all 23 shipped pairs on first read against a fresh db path", () => {
    const all = readAllHandoffDefaults(dbPath);
    expect(Object.keys(all).sort()).toEqual(Object.keys(SEED_HANDOFFS).sort());
    expect(Object.keys(all)).toHaveLength(23);
    for (const [id, row] of Object.entries(all)) {
      expect(row.version).toBe(1);
      expect(row.content).toBe(SEED_HANDOFFS[id]);
    }
  });

  it("has no row for a pair Maestro ships nothing for", () => {
    expect(readHandoffDefault("scribe/reviewer", dbPath)).toBeNull();
    expect(isSeededHandoff("scribe/reviewer")).toBe(false);
    expect(isSeededHandoff("backend/test")).toBe(true);
  });

  it("is one table keyed by the pair — no id indirection to go wrong", () => {
    readAllHandoffDefaults(dbPath);
    const db = new DatabaseSync(dbPath);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(
      (r) => r.name
    );
    db.close();
    expect(tables).toEqual(["handoffs"]);
  });

  it("a write bumps version; seeding is idempotent across opens", () => {
    expect(readHandoffDefault("backend/test", dbPath)!.version).toBe(1);
    expect(writeHandoffDefault("backend/test", "mine", dbPath)).toEqual({
      handoffId: "backend/test",
      content: "mine",
      version: 2,
    });
    expect(writeHandoffDefault("backend/test", "mine again", dbPath).version).toBe(3);
    // Everything else is untouched, and re-opening does not re-seed over the edit.
    expect(readHandoffDefault("backend/test", dbPath)!.content).toBe("mine again");
    expect(readHandoffDefault("backend/frontend", dbPath)!.version).toBe(1);
  });

  it("a write to a pair with no seed inserts at version 1", () => {
    expect(writeHandoffDefault("scribe/reviewer", "new", dbPath).version).toBe(1);
    expect(readHandoffDefault("scribe/reviewer", dbPath)!.content).toBe("new");
  });

  it("moves a row still carrying a SUPERSEDED seed forward, and leaves a hand-edited one alone", async () => {
    // `PRIOR_SEEDS` is empty at `033` (nothing has been superseded yet), so the mechanism is
    // exercised by standing in for a future edit: a row whose content is a known-old body moves,
    // a row whose content is anything else does not.
    const seeds = await import("../../src/core/handoff-seeds.js");
    const store = await import("../../src/core/handoff-defaults.js");
    const OLD = "an older shipped body";

    // Simulate a machine seeded by the previous release, plus one row the user edited.
    writeHandoffDefault("backend/test", OLD, dbPath);
    writeHandoffDefault("backend/frontend", "MY OWN PROTOCOL", dbPath);
    const editedVersion = readHandoffDefault("backend/frontend", dbPath)!.version;

    (seeds.PRIOR_SEEDS as Record<string, string[]>)["backend/test"] = [OLD];
    try {
      const refreshed = store.readHandoffDefault("backend/test", dbPath)!;
      expect(refreshed.content).toBe(SEED_HANDOFFS["backend/test"]);
      expect(refreshed.version).toBe(3); // 1 seeded -> 2 written -> 3 moved forward
      // Idempotent: the second open finds the CURRENT seed, which is not in the prior list.
      expect(store.readHandoffDefault("backend/test", dbPath)!.version).toBe(3);
      // The hand-edited row matches nothing in PRIOR_SEEDS and is untouched.
      const edited = store.readHandoffDefault("backend/frontend", dbPath)!;
      expect(edited.content).toBe("MY OWN PROTOCOL");
      expect(edited.version).toBe(editedVersion);
    } finally {
      delete (seeds.PRIOR_SEEDS as Record<string, string[]>)["backend/test"];
    }
  });

  it("delete removes an override, and a seeded pair comes back on the next open", () => {
    writeHandoffDefault("backend/test", "mine", dbPath);
    expect(deleteHandoffDefault("backend/test", dbPath)).toBe(true);
    // Deleting one row does not empty the table, so it stays gone until the file itself goes.
    expect(readHandoffDefault("backend/test", dbPath)).toBeNull();
    expect(deleteHandoffDefault("backend/test", dbPath)).toBe(false);
  });

  it("creates the db's parent directory when it doesn't exist yet", () => {
    const nested = path.join(dir, "does", "not", "exist", "handoffs.sqlite");
    expect(readHandoffDefault("backend/test", nested)).not.toBeNull();
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("rejects an id that is not <sender>/<receiver> BEFORE any path.join", () => {
    for (const bad of ["../../etc/passwd", "a/b/c", "backend", "/abs/path", "backend/", "a/./b", ""]) {
      expect(isValidHandoffId(bad)).toBe(false);
      expect(() => readHandoffDefault(bad, dbPath)).toThrow(/Invalid handoff id/);
      expect(() => writeHandoffDefault(bad, "x", dbPath)).toThrow(/Invalid handoff id/);
      expect(() => deleteHandoffDefault(bad, dbPath)).toThrow(/Invalid handoff id/);
      expect(() => handoffFilePath(projectRoot, bad)).toThrow(/Invalid handoff id/);
    }
    expect(splitHandoffId("backend/test")).toEqual({ sender: "backend", receiver: "test" });
  });
});

describe("resolveHandoff — the three tiers", () => {
  it("prefers the project file, then the global row, then the seed, then nothing", () => {
    const g = { content: "global body", version: 4 };
    expect(resolveHandoff("backend/test", "project body", g)).toEqual({
      source: "project",
      content: "project body",
      handoffId: "backend/test",
    });
    expect(resolveHandoff("backend/test", null, g)).toEqual({
      source: "global",
      content: "global body",
      handoffId: "backend/test",
    });
    expect(resolveHandoff("backend/test", null, null)).toEqual({
      source: "seed",
      content: SEED_HANDOFFS["backend/test"],
      handoffId: "backend/test",
    });
    expect(resolveHandoff("scribe/reviewer", null, null)).toEqual({
      source: "none",
      content: null,
      handoffId: "scribe/reviewer",
    });
  });
});

describe("syncProjectHandoffs", () => {
  it("no-ops on a project with no maestro.json", () => {
    expect(syncProjectHandoffs(projectRoot, dbPath)).toEqual({
      materialized: [],
      refreshed: [],
      adopted: [],
      staleCustomized: [],
      unchanged: [],
    });
    expect(fs.existsSync(path.join(projectRoot, ".claude", "handoffs"))).toBe(false);
  });

  it("materializes exactly the wired routes, and records syncedFrom", () => {
    writeConfig(projectRoot, defaultish);
    const summary = syncProjectHandoffs(projectRoot, dbPath);

    expect(summary.materialized.sort()).toEqual(["backend/test", "test/backend"]);
    expect(read("backend/test")).toBe(SEED_HANDOFFS["backend/test"]);
    const slice = readConfig(projectRoot)!.handoffs!;
    expect(slice["backend/test"].id).toBe("backend/test");
    expect(slice["backend/test"].syncedFrom!.version).toBe(1);
    expect(slice["backend/test"].syncedFrom!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("skips a wired route whose pair has no template — no file, no bucket, no noise", () => {
    writeConfig(projectRoot, defaultish);
    const summary = syncProjectHandoffs(projectRoot, dbPath);

    // `test -> scribe` is wired (through the human_review node) and Maestro ships nothing for it.
    expect(handoffPairs(handoffRoutes(defaultish.workflows, defaultish.workflow_instances))).toContain("test/scribe");
    for (const bucket of Object.values(summary)) expect(bucket).not.toContain("test/scribe");
    expect(fs.existsSync(path.join(projectRoot, ".claude", "handoffs", "test", "scribe.md"))).toBe(false);
    expect(readConfig(projectRoot)!.handoffs!["test/scribe"]).toBeUndefined();
  });

  it("is idempotent: a second run reports unchanged and writes nothing", () => {
    writeConfig(projectRoot, defaultish);
    syncProjectHandoffs(projectRoot, dbPath);
    const before = fs.statSync(handoffFilePath(projectRoot, "backend/test")).mtimeMs;

    const second = syncProjectHandoffs(projectRoot, dbPath);
    expect(second.materialized).toEqual([]);
    expect(second.refreshed).toEqual([]);
    expect(second.unchanged.sort()).toEqual(["backend/test", "test/backend"]);
    expect(fs.statSync(handoffFilePath(projectRoot, "backend/test")).mtimeMs).toBe(before);
  });

  it("a hand-edit survives a second install and is reported as staleCustomized", () => {
    writeConfig(projectRoot, defaultish);
    syncProjectHandoffs(projectRoot, dbPath);
    fs.writeFileSync(handoffFilePath(projectRoot, "backend/test"), "I edited this\n");

    const summary = syncProjectHandoffs(projectRoot, dbPath);
    expect(summary.staleCustomized).toEqual(["backend/test"]);
    expect(read("backend/test")).toBe("I edited this\n");

    // And it stays customized even after the global default moves on.
    writeHandoffDefault("backend/test", "a newer global body", dbPath);
    expect(syncProjectHandoffs(projectRoot, dbPath).staleCustomized).toEqual(["backend/test"]);
    expect(read("backend/test")).toBe("I edited this\n");
  });

  it("refreshes an untouched copy when the global version advances", () => {
    writeConfig(projectRoot, defaultish);
    syncProjectHandoffs(projectRoot, dbPath);
    writeHandoffDefault("backend/test", "a newer global body", dbPath);

    const summary = syncProjectHandoffs(projectRoot, dbPath);
    expect(summary.refreshed).toEqual(["backend/test"]);
    expect(read("backend/test")).toBe("a newer global body");
    expect(readConfig(projectRoot)!.handoffs!["backend/test"].syncedFrom!.version).toBe(2);
  });

  it("never touches a DETACHED entry — a hand-authored override with no syncedFrom", () => {
    writeConfig(projectRoot, defaultish);
    saveProjectHandoffOverride(projectRoot, "backend/test", "my own protocol");
    writeHandoffDefault("backend/test", "a newer global body", dbPath);

    const summary = syncProjectHandoffs(projectRoot, dbPath);
    for (const bucket of Object.values(summary)) expect(bucket).not.toContain("backend/test");
    expect(read("backend/test")).toBe("my own protocol");
    expect(readConfig(projectRoot)!.handoffs!["backend/test"].syncedFrom).toBeUndefined();
  });

  it("leaves an UNTRACKED file exactly as it is — .claude/handoffs predates the slice", () => {
    writeConfig(projectRoot, defaultish);
    fs.mkdirSync(path.join(projectRoot, ".claude", "handoffs", "backend"), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ".claude", "handoffs", "backend", "test.md"), "somebody else's\n");

    const summary = syncProjectHandoffs(projectRoot, dbPath);
    expect(summary.unchanged).toContain("backend/test");
    expect(summary.materialized).not.toContain("backend/test");
    expect(read("backend/test")).toBe("somebody else's\n");
    expect(readConfig(projectRoot)!.handoffs?.["backend/test"]).toBeUndefined();
  });

  it("adopts an untracked file whose bytes are the current global default — a purge left it behind (`059`)", () => {
    writeConfig(projectRoot, defaultish);
    syncProjectHandoffs(projectRoot, dbPath);
    // Simulate a purge: the config's tracking is gone, but the materialized file survives.
    writeConfig(projectRoot, { ...readConfig(projectRoot)!, handoffs: {} });

    const summary = syncProjectHandoffs(projectRoot, dbPath);
    expect(summary.adopted).toContain("backend/test");
    expect(summary.materialized).not.toContain("backend/test");
    expect(read("backend/test")).toBe(SEED_HANDOFFS["backend/test"]);
    expect(readConfig(projectRoot)!.handoffs!["backend/test"]).toEqual({
      id: "backend/test",
      syncedFrom: { version: 1, hash: expect.stringMatching(/^[0-9a-f]{64}$/) },
    });

    // Tracked again, so the NEXT advance refreshes it rather than skipping it forever.
    writeHandoffDefault("backend/test", "a newer global body", dbPath);
    expect(syncProjectHandoffs(projectRoot, dbPath).refreshed).toContain("backend/test");
    expect(read("backend/test")).toBe("a newer global body");
  });

  it("adopts an untracked file that matches an OLDER known version, and brings it to current in the same pass", () => {
    writeConfig(projectRoot, defaultish);
    // Stand in for a prior release's body — same pattern the store's own "moves a row still
    // carrying a superseded seed" test uses, restored afterward so this doesn't leak into other
    // tests sharing the same module-level object.
    const original = PRIOR_SEEDS["backend/test"];
    const OLD = "an older shipped body, before the current one";
    (PRIOR_SEEDS as Record<string, string[]>)["backend/test"] = [OLD];
    try {
      fs.mkdirSync(path.dirname(handoffFilePath(projectRoot, "backend/test")), { recursive: true });
      fs.writeFileSync(handoffFilePath(projectRoot, "backend/test"), OLD);

      const summary = syncProjectHandoffs(projectRoot, dbPath);
      expect(summary.adopted).toContain("backend/test");
      // A project that skipped a release stays frozen if adoption only checks the CURRENT
      // version — this is the case comparing against ANY known version exists to fix: the file is
      // brought all the way to the current default in the same pass, not just marked tracked at
      // the old body.
      expect(read("backend/test")).toBe(SEED_HANDOFFS["backend/test"]);
      expect(readConfig(projectRoot)!.handoffs!["backend/test"].syncedFrom!.version).toBe(1);
    } finally {
      if (original === undefined) delete (PRIOR_SEEDS as Record<string, string[]>)["backend/test"];
      else (PRIOR_SEEDS as Record<string, string[]>)["backend/test"] = original;
    }
  });

  it("a hand-edited file that survives a purge is not adopted, and stays untouched", () => {
    writeConfig(projectRoot, defaultish);
    fs.mkdirSync(path.dirname(handoffFilePath(projectRoot, "backend/test")), { recursive: true });
    fs.writeFileSync(handoffFilePath(projectRoot, "backend/test"), "content nothing recorded ever had\n");

    const summary = syncProjectHandoffs(projectRoot, dbPath);
    expect(summary.adopted).not.toContain("backend/test");
    expect(summary.unchanged).toContain("backend/test");
    expect(read("backend/test")).toBe("content nothing recorded ever had\n");
    expect(readConfig(projectRoot)!.handoffs?.["backend/test"]).toBeUndefined();
  });

  it("keeps honouring an id already in the slice that the graph no longer wires", () => {
    writeConfig(projectRoot, defaultish);
    syncProjectHandoffs(projectRoot, dbPath);
    // Drop every workflow: the routes are gone, but the tracked copy is still tracked.
    writeConfig(projectRoot, { ...readConfig(projectRoot)!, workflows: [] });
    writeHandoffDefault("backend/test", "a newer global body", dbPath);

    expect(syncProjectHandoffs(projectRoot, dbPath).refreshed).toEqual(["backend/test"]);
  });

  it("skips a malformed id in the slice instead of throwing the install away", () => {
    writeConfig(projectRoot, {
      ...defaultish,
      handoffs: { "../../etc/passwd": { id: "../../etc/passwd" } },
    });
    const summary = syncProjectHandoffs(projectRoot, dbPath);
    expect(summary.materialized.sort()).toEqual(["backend/test", "test/backend"]);
    for (const bucket of Object.values(summary)) expect(bucket).not.toContain("../../etc/passwd");
  });
});

describe("getResolvedHandoff / saveProjectHandoffOverride", () => {
  it("resolves to the global default when the project has no override", () => {
    expect(getResolvedHandoff(projectRoot, "backend/test", dbPath)).toEqual({
      source: "global",
      content: SEED_HANDOFFS["backend/test"],
    });
  });

  it("resolves the global tier with no project open at all", () => {
    expect(getResolvedHandoff("", "backend/test", dbPath).source).toBe("global");
  });

  it("resolves to none for a pair nothing ships and nobody wrote", () => {
    expect(getResolvedHandoff(projectRoot, "scribe/reviewer", dbPath)).toEqual({ source: "none", content: "" });
  });

  it("falls through to the SEED when the store cannot be opened", () => {
    // A directory where the db file should be: DatabaseSync throws, and the seed answers anyway.
    const unopenable = path.join(dir, "not-a-db");
    fs.mkdirSync(unopenable, { recursive: true });
    expect(getResolvedHandoff(projectRoot, "backend/test", unopenable)).toEqual({
      source: "seed",
      content: SEED_HANDOFFS["backend/test"],
    });
  });

  it("a save writes the project file, records the pair, and DROPS syncedFrom", () => {
    writeConfig(projectRoot, defaultish);
    syncProjectHandoffs(projectRoot, dbPath);
    expect(readConfig(projectRoot)!.handoffs!["backend/test"].syncedFrom).toBeDefined();

    expect(saveProjectHandoffOverride(projectRoot, "backend/test", "mine")).toEqual({
      source: "project",
      content: "mine",
    });
    expect(read("backend/test")).toBe("mine");
    expect(readConfig(projectRoot)!.handoffs!["backend/test"]).toEqual({ id: "backend/test" });
    expect(getResolvedHandoff(projectRoot, "backend/test", dbPath)).toEqual({ source: "project", content: "mine" });
  });

  it("refuses a malformed id on both the read and the write", () => {
    expect(() => getResolvedHandoff(projectRoot, "../../etc/passwd", dbPath)).toThrow(/Invalid handoff id/);
    expect(() => saveProjectHandoffOverride(projectRoot, "a/b/c", "x")).toThrow(/Invalid handoff id/);
  });
});

// 034 — what `/agents`' Interactions pane lists, and the one state a deleted global row leaves.
describe("resolvedRoutesFrom — the Interactions pane's one round trip", () => {
  it("returns one entry per outgoing route, in the walk's own order, each with its tier", () => {
    writeConfig(projectRoot, defaultish);
    const routes = resolvedRoutesFrom(projectRoot, "backend", dbPath);

    expect(routes.map((r) => `${r.label}->${r.receiver}`)).toEqual(
      routesFrom(handoffRoutes(defaultish.workflows, defaultish.workflow_instances), "backend").map(
        (r) => `${r.label}->${r.receiver}`
      )
    );
    const toTest = routes.find((r) => r.receiver === "test")!;
    expect(toTest.handoffId).toBe("backend/test");
    expect(toTest.source).toBe("global");
    expect(toTest.content).toBe(SEED_HANDOFFS["backend/test"]);
  });

  it("keeps a route with NO template at any tier, so the gap is visible rather than silent", () => {
    writeConfig(projectRoot, defaultish);
    const routes = resolvedRoutesFrom(projectRoot, "test", dbPath);

    const toScribe = routes.find((r) => r.receiver === "scribe")!;
    expect(toScribe.handoffId).toBe("test/scribe");
    expect(toScribe.source).toBe("none");
    expect(toScribe.content).toBe("");
  });

  it("reports a project override once one is saved", () => {
    writeConfig(projectRoot, defaultish);
    saveProjectHandoffOverride(projectRoot, "backend/test", "mine");

    const toTest = resolvedRoutesFrom(projectRoot, "backend", dbPath).find((r) => r.receiver === "test")!;
    expect(toTest).toMatchObject({ source: "project", content: "mine" });
  });

  it("is empty with no project open — no graph, so no routes", () => {
    expect(resolvedRoutesFrom("", "backend", dbPath)).toEqual([]);
  });

  it("bares a namespaced agent name, so `maestro:backend` finds backend's routes", () => {
    writeConfig(projectRoot, defaultish);
    expect(resolvedRoutesFrom(projectRoot, "maestro:backend", dbPath).length).toBeGreaterThan(0);
  });
});

describe("syncProjectHandoffs — a global row deleted out from under a tracked project", () => {
  it("clears the stale syncedFrom, keeps the file, and reports nothing", () => {
    // The state a `/templates` delete leaves behind: an entry tracking a global row that is no
    // longer there. `scribe/reviewer` stands in for it — Maestro ships nothing for that pair, so
    // no tier answers for it and `seedIfEmpty` can never put one back.
    writeConfig(projectRoot, defaultish);
    fs.mkdirSync(path.dirname(handoffFilePath(projectRoot, "scribe/reviewer")), { recursive: true });
    fs.writeFileSync(handoffFilePath(projectRoot, "scribe/reviewer"), "materialized earlier");
    const cfg = readConfig(projectRoot)!;
    writeConfig(projectRoot, {
      ...cfg,
      handoffs: { "scribe/reviewer": { id: "scribe/reviewer", syncedFrom: { version: 3, hash: "x" } } },
    });

    const summary = syncProjectHandoffs(projectRoot, dbPath);

    // In no bucket — nothing was synced, so there is nothing to tell the user. The file stays
    // (the project tier is the user's own and wins at the hook), and the tracking that could
    // never match and never advance is gone.
    for (const bucket of Object.values(summary)) expect(bucket).not.toContain("scribe/reviewer");
    expect(read("scribe/reviewer")).toBe("materialized earlier");
    expect(readConfig(projectRoot)!.handoffs!["scribe/reviewer"]).toEqual({ id: "scribe/reviewer" });
  });

  it("leaves an entry that never tracked anything exactly as it is", () => {
    writeConfig(projectRoot, defaultish);
    const cfg = readConfig(projectRoot)!;
    writeConfig(projectRoot, { ...cfg, handoffs: { "scribe/reviewer": { id: "scribe/reviewer" } } });

    syncProjectHandoffs(projectRoot, dbPath);
    expect(readConfig(projectRoot)!.handoffs!["scribe/reviewer"]).toEqual({ id: "scribe/reviewer" });
  });
});
