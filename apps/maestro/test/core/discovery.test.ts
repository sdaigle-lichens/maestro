// Where the bundled subagents come from.
//
// This resolution is the kind that only breaks in a launched app. It used to start from
// `import.meta.dirname`, which is `apps/maestro/src/core` under vitest, `apps/maestro/out/main`
// once electron-vite has bundled the main process — which it does for `dev` as well as `build` —
// and a path inside `app.asar` when packaged. Three different trees, so any fixed number of `../`
// hops is right in at most one of them and silently returns null in the rest, showing up only as
// an agent picker that has quietly lost the Maestro subagents.
//
// So `findUpBundledAgents` now takes its starting point from the caller, and the caller is
// `src/main/bundled-assets.ts` passing `app.getAppPath()` — the app's own location in every mode.
// These tests drive it from each of the depths that resolution has to survive.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  BUNDLED_AGENTS_REL,
  discoverAgents,
  discoverProjectSkillsTree,
  discoverSkills,
  findUpBundledAgents,
} from "../../src/core/discovery.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../..");
const appRoot = path.join(repoRoot, "apps", "maestro");
const realAgentsDir = path.join(repoRoot, "plugins", "maestro", "agents");

describe("findUpBundledAgents", () => {
  it("finds the plugin's agents directory from the app path this repo gives Electron", () => {
    // `app.getAppPath()` is apps/maestro when the app is started from this checkout — under
    // `dev`, `build` + `start`, and a bare `electron .` alike. Two levels below the repo root.
    expect(findUpBundledAgents(appRoot)).toBe(realAgentsDir);
  });

  it("resolves from the depth electron-vite bundles the main process to", () => {
    // Not how main resolves it any more, but the walk still has to be depth-independent: nothing
    // guarantees the app path and the repo root stay two levels apart.
    expect(findUpBundledAgents(path.join(appRoot, "out", "main"))).toBe(realAgentsDir);
  });

  it("resolves from the source depth too", () => {
    expect(findUpBundledAgents(path.join(appRoot, "src", "core"))).toBe(realAgentsDir);
  });

  it("returns null outside any tree containing the plugin", () => {
    // What a packaged app's asar path looks like to this function — which is why
    // `bundled-assets.ts` checks `process.resourcesPath` before falling back to the walk.
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-nowhere-"));
    try {
      expect(findUpBundledAgents(tmp)).toBeNull();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("names the directory main looks for under a packaged resources path", () => {
    // `bundled-assets.ts` joins this onto `process.resourcesPath`; it needs Electron to run, so
    // what is pinned here is the shared constant the two sides agree on.
    expect(path.join(repoRoot, BUNDLED_AGENTS_REL)).toBe(realAgentsDir);
  });
});

describe("discoverAgents", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-discover-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("tags the plugin's bundled agents and actually returns some", async () => {
    const agents = await discoverAgents(tmp, findUpBundledAgents(appRoot));
    const bundled = agents.filter((a) => a.source === "maestro");
    expect(bundled.length).toBeGreaterThan(0);
  });
});

function writeSkill(dir: string, id: string, description = "") {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), `---\nname: ${id}\ndescription: ${description}\n---\nbody\n`);
}

describe("discoverProjectSkillsTree", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-skill-tree-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("finds a skill under a nested .claude/skills, not only the root's", async () => {
    writeSkill(path.join(tmp, "apps", "web", ".claude", "skills", "web-thing"), "web-thing");
    const { skills, collisions } = await discoverProjectSkillsTree(tmp);
    expect(skills.map((s) => s.name)).toContain("web-thing");
    expect(collisions).toEqual([]);
  });

  it("keeps the root's copy on an id collision, and reports it", async () => {
    writeSkill(path.join(tmp, ".claude", "skills", "shared"), "shared", "root version");
    writeSkill(path.join(tmp, "apps", "web", ".claude", "skills", "shared"), "shared", "nested version");
    const { skills, collisions } = await discoverProjectSkillsTree(tmp);
    const shared = skills.filter((s) => s.name === "shared");
    expect(shared).toHaveLength(1);
    expect(shared[0].description).toBe("root version");
    expect(collisions).toHaveLength(1);
    expect(collisions[0].id).toBe("shared");
    expect(collisions[0].dirs[0]).toBe(path.join(".claude", "skills", "shared"));
  });

  it("does not walk past the same depth/ignore list as the rest of the tree", async () => {
    writeSkill(path.join(tmp, "node_modules", "pkg", ".claude", "skills", "ignored"), "ignored");
    const { skills } = await discoverProjectSkillsTree(tmp);
    expect(skills.map((s) => s.name)).not.toContain("ignored");
  });
});

describe("discoverSkills (project component)", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-discover-skills-"));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("sees a skill living beside the code it documents, not only the project root's", async () => {
    writeSkill(path.join(tmp, "apps", "web", ".claude", "skills", "web-thing"), "web-thing");
    const skills = await discoverSkills(tmp);
    expect(skills.some((s) => s.id === "web-thing" && s.source === "project")).toBe(true);
  });
});
