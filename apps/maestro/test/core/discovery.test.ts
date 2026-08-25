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

import { BUNDLED_AGENTS_REL, discoverAgents, findUpBundledAgents } from "../../src/core/discovery.js";

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
