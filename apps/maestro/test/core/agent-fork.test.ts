// Forking a global-tier agent into the open project — the /agents card's "Fork into this project"
// button, and /create-subagent's template field's real counterpart. What's worth pinning: a
// same-name fork is byte-for-byte, a renamed one rewrites only the `name:` line and copies the
// three global attribute rows, every fork writes a provenance sidecar, and the baseline hash
// normalises out the description line the way the module header claims.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { setAvatar } from "../../src/core/avatar-store.js";
import { setAgentType } from "../../src/core/agent-types.js";
import { setAgentProjectTag } from "../../src/core/agent-project-tags.js";
import { AVATAR_CATEGORIES, AVATAR_PARTS, type AvatarLayers } from "../../src/core/contracts.js";
import {
  agentForksPath,
  bodyForHashing,
  forkAgent,
  hashAgentBody,
  readAgentForks,
} from "../../src/core/agent-fork.js";

const BODY = "\n# Scribe Agent\n\nYou are the documentation steward.\n\n- one\n- two\n";

function file(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n${BODY}`;
}

function fullLayers(): AvatarLayers {
  const layers = {} as AvatarLayers;
  for (const cat of AVATAR_CATEGORIES) layers[cat] = AVATAR_PARTS[cat][0].id;
  return layers;
}

describe("bodyForHashing / hashAgentBody", () => {
  it("strips the description line so editing it doesn't change the hash", () => {
    const a = file("name: scribe\ndescription: Old text.\ntools: Read");
    const b = file("name: scribe\ndescription: A totally different sentence.\ntools: Read");
    expect(hashAgentBody(a)).toBe(hashAgentBody(b));
    expect(bodyForHashing(a)).toBe(bodyForHashing(b));
  });

  it("still changes the hash when the body (not the description) changes", () => {
    const a = file("name: scribe\ndescription: Same.");
    const b = `---\nname: scribe\ndescription: Same.\n---\n\nDifferent body entirely.\n`;
    expect(hashAgentBody(a)).not.toBe(hashAgentBody(b));
  });

  it("strips a continued description line too, not just its first line", () => {
    const a = file("name: scribe\ndescription:\n  continued elsewhere\ntools: Read");
    const b = file("name: scribe\ndescription: One line now.\ntools: Read");
    expect(hashAgentBody(a)).toBe(hashAgentBody(b));
  });

  it("hashes the whole file unchanged when there's no frontmatter block", () => {
    const text = "# Just a heading\nNo frontmatter here.\n";
    expect(bodyForHashing(text)).toBe(text);
  });
});

describe("forkAgent", () => {
  let root: string;
  let storeDir: string;
  let dbPaths: { avatar: string; agentTypes: string; agentProjectTags: string };

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-fork-"));
    fs.mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
    storeDir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-fork-stores-"));
    dbPaths = {
      avatar: path.join(storeDir, "avatars.sqlite"),
      agentTypes: path.join(storeDir, "agent-types.sqlite"),
      agentProjectTags: path.join(storeDir, "agent-project-tags.sqlite"),
    };
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(storeDir, { recursive: true, force: true });
  });

  it("copies a same-name fork byte-for-byte, including the description line", async () => {
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    const template = file("name: scribe\ndescription: Documents things.\ntools: Read, Write");
    fs.writeFileSync(path.join(bundled, "scribe.md"), template, "utf8");

    const result = await forkAgent(root, bundled, "1.2.3", "scribe");

    const forkedPath = path.join(root, ".claude", "agents", "scribe.md");
    expect(result).toEqual({ name: "scribe", file: forkedPath });
    expect(fs.readFileSync(forkedPath, "utf8")).toBe(template);
  });

  it("shadows the template — the fork lands under the SAME name it was forked from", async () => {
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    fs.writeFileSync(path.join(bundled, "reviewer.md"), file("name: reviewer\ndescription: Reviews."), "utf8");

    const result = await forkAgent(root, bundled, null, "reviewer");
    expect(result.name).toBe("reviewer");
  });

  it("rewrites only the name: line on a renamed fork, leaving the description untouched", async () => {
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    fs.writeFileSync(path.join(bundled, "reviewer.md"), file("name: reviewer\ndescription: Reviews PRs."), "utf8");

    const result = await forkAgent(root, bundled, null, "reviewer", "strict-reviewer", dbPaths);

    const forkedPath = path.join(root, ".claude", "agents", "strict-reviewer.md");
    expect(result).toEqual({ name: "strict-reviewer", file: forkedPath });
    expect(fs.readFileSync(forkedPath, "utf8")).toBe(file("name: strict-reviewer\ndescription: Reviews PRs."));
  });

  it("copies the template's avatar, type and project tag rows under the new name on a rename, scoped to the fork's own project (030)", async () => {
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    fs.writeFileSync(path.join(bundled, "reviewer.md"), file("name: reviewer\ndescription: Reviews."), "utf8");

    const layers = fullLayers();
    setAvatar("reviewer", layers, dbPaths.avatar);
    setAgentType("reviewer", "reviewer", dbPaths.agentTypes);
    setAgentProjectTag("reviewer", "backend", dbPaths.agentProjectTags);

    await forkAgent(root, bundled, null, "reviewer", "strict-reviewer", dbPaths);

    const { readAllAvatars } = await import("../../src/core/avatar-store.js");
    const { readAllAgentTypes } = await import("../../src/core/agent-types.js");
    const { readAllAgentProjectTags } = await import("../../src/core/agent-project-tags.js");
    // The copy lands on the FORK's own project-tier row, not the global one — reading with no
    // project scope (what the template's own global row would show) must find nothing here.
    expect(readAllAvatars(dbPaths.avatar)["strict-reviewer"]).toBeUndefined();
    expect(readAllAgentTypes(dbPaths.agentTypes)["strict-reviewer"]).toBeUndefined();
    expect(readAllAgentProjectTags(dbPaths.agentProjectTags)["strict-reviewer"]).toBeUndefined();
    expect(readAllAvatars(dbPaths.avatar, root)["strict-reviewer"]).toEqual(layers);
    expect(readAllAgentTypes(dbPaths.agentTypes, root)["strict-reviewer"]).toBe("reviewer");
    expect(readAllAgentProjectTags(dbPaths.agentProjectTags, root)["strict-reviewer"]).toBe("backend");
  });

  it("does NOT touch the attribute stores on a same-name fork — the rows are inherited for free", async () => {
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    fs.writeFileSync(path.join(bundled, "reviewer.md"), file("name: reviewer\ndescription: Reviews."), "utf8");

    await forkAgent(root, bundled, null, "reviewer", undefined, dbPaths);

    // Nothing was ever written for "reviewer" under these override paths, and forking same-name
    // must not have written anything either — the sqlite files shouldn't even exist.
    expect(fs.existsSync(dbPaths.avatar)).toBe(false);
    expect(fs.existsSync(dbPaths.agentTypes)).toBe(false);
    expect(fs.existsSync(dbPaths.agentProjectTags)).toBe(false);
  });

  it("writes a provenance sidecar record — tier, plugin, version, hash, and the template body", async () => {
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    const template = file("name: reviewer\ndescription: Reviews PRs.");
    fs.writeFileSync(path.join(bundled, "reviewer.md"), template, "utf8");

    await forkAgent(root, bundled, "2.0.0", "reviewer");

    expect(fs.existsSync(agentForksPath(root))).toBe(true);
    const forks = readAgentForks(root);
    expect(forks.reviewer).toEqual({
      agentName: "reviewer",
      sourceTier: "plugin",
      sourcePlugin: "maestro",
      pluginVersion: "2.0.0",
      templateBodyHash: hashAgentBody(template),
      templateBody: template,
      forkedAt: forks.reviewer.forkedAt,
    });
    expect(typeof forks.reviewer.forkedAt).toBe("string");
  });

  it("records a null pluginVersion when the caller has none to give — e.g. no plugin.json found", async () => {
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    fs.writeFileSync(path.join(bundled, "scribe.md"), file("name: scribe\ndescription: Docs."), "utf8");

    await forkAgent(root, bundled, null, "scribe");
    const forks = readAgentForks(root);
    expect(forks.scribe.sourceTier).toBe("plugin");
    expect(forks.scribe.sourcePlugin).toBe("maestro");
    expect(forks.scribe.pluginVersion).toBeNull();
  });

  it("refuses to fork an agent that's already project-tier", async () => {
    fs.writeFileSync(
      path.join(root, ".claude", "agents", "scribe.md"),
      file("name: scribe\ndescription: Already here."),
      "utf8"
    );
    await expect(forkAgent(root, null, null, "scribe")).rejects.toThrow(/already a project agent/);
  });

  it("refuses an agent that resolves nowhere", async () => {
    await expect(forkAgent(root, null, null, "ghost")).rejects.toThrow(/No definition file/);
  });

  it("refuses a non-kebab-case rename", async () => {
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    fs.writeFileSync(path.join(bundled, "scribe.md"), file("name: scribe\ndescription: Docs."), "utf8");
    await expect(forkAgent(root, bundled, null, "scribe", "Not Kebab Case")).rejects.toThrow(/kebab-case/);
  });

  it("refuses a rename that collides with an existing project agent", async () => {
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    fs.writeFileSync(path.join(bundled, "scribe.md"), file("name: scribe\ndescription: Docs."), "utf8");
    fs.writeFileSync(
      path.join(root, ".claude", "agents", "taken.md"),
      file("name: taken\ndescription: Already exists."),
      "utf8"
    );
    await expect(forkAgent(root, bundled, null, "scribe", "taken")).rejects.toThrow(/already exists/);
  });

  it("rejects when no project is open", async () => {
    await expect(forkAgent("", null, null, "scribe")).rejects.toThrow(/No project is open/);
  });
});
