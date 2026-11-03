// `092`: re-installing into a project whose maestro.json predates `start_skills` / `end_skills`
// fills in what is missing and drops a leftover `gates` key. Both real installers are run against a
// temp project with a pre-existing config — `installRuntime` (the app) and the plugin's
// `maestro-install.js` (spawned) — and held to the same behaviour.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { findStaleSkillRefs } from "../../src/core/skill-availability.js";
import { seedMissingSkillLists } from "../../src/core/seed.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const INSTALLER = path.join(PLUGIN_ROOT, "scripts", "maestro-install.js");
const DESIGN = "code-graph:use-code-architecture-design-check";

type Seeded = { start_skills: boolean; end_skills: boolean; gatesRemoved: boolean } | null;
interface Result {
  seeded: Seeded;
  /** maestro.json as bytes, after the install. */
  raw: string;
}

let tmp: string;
let home: string;
let n = 0;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-skill-lists-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** A git project holding `configText` verbatim as its maestro.json; `withDesign` enables the plugin. */
function project(configText: string, withDesign = false): string {
  const root = path.join(tmp, `p${n++}`);
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  fs.writeFileSync(path.join(root, ".claude", "maestro.json"), configText);
  if (withDesign) {
    fs.writeFileSync(
      path.join(root, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "code-graph@code-graph": true } })
    );
  }
  return root;
}

const configPath = (root: string) => path.join(root, ".claude", "maestro.json");

const INSTALLERS: Record<string, (root: string) => Promise<Result>> = {
  "installRuntime (app)": async (root) => {
    const prev = process.env.HOME;
    process.env.HOME = home;
    try {
      const report = await installRuntime(
        root,
        PLUGIN_ROOT,
        path.join(tmp, "reports.sqlite"),
        path.join(tmp, "tags.sqlite"),
        path.join(tmp, "handoffs.sqlite")
      );
      return { seeded: report.skillListsSeeded, raw: fs.readFileSync(configPath(root), "utf8") };
    } finally {
      process.env.HOME = prev;
    }
  },
  "maestro-install.js (plugin)": async (root) => {
    const out = execFileSync("node", [INSTALLER, root], { encoding: "utf8", env: pinnedEnv(home) });
    const json = JSON.parse(out.trim().split("\n").pop()!);
    return { seeded: json.skillListsSeeded, raw: fs.readFileSync(configPath(root), "utf8") };
  },
};

/** Everything but runtimeVersion, which the install stamps on its own. */
function body(raw: string): Record<string, unknown> {
  const { runtimeVersion: _v, ...rest } = JSON.parse(raw);
  return rest;
}

const BASE = {
  version: 3,
  agents_available: [],
  skills_available: [],
  workflow_instances: [],
  workflows: [],
  rules: [],
};

describe.each(Object.entries(INSTALLERS))("skill-list seeding via %s", (_name, install) => {
  it("writes the fresh-seed defaults when start_skills and end_skills are missing", async () => {
    const root = project(JSON.stringify(BASE, null, 2));
    const r = await install(root);
    expect(r.seeded).toEqual({ start_skills: true, end_skills: true, gatesRemoved: false });
    expect(body(r.raw)).toEqual({
      ...BASE,
      start_skills: { maestro: [], to_maestro_tasks: ["confidence-check"] },
      end_skills: { maestro: [] },
    });
    expect(r.raw.endsWith("\n")).toBe(false);
    expect(r.raw).toBe(JSON.stringify(JSON.parse(r.raw), null, 2));
  });

  it("adds the design check only when it resolves, in its plugin-qualified form", async () => {
    const withIt = await install(project(JSON.stringify(BASE), true));
    expect((body(withIt.raw).start_skills as { to_maestro_tasks: string[] }).to_maestro_tasks).toEqual([
      "confidence-check",
      DESIGN,
    ]);
    const without = await install(project(JSON.stringify(BASE)));
    expect((body(without.raw).start_skills as { to_maestro_tasks: string[] }).to_maestro_tasks).toEqual([
      "confidence-check",
    ]);
  });

  it("seeds only end_skills when start_skills is already there, leaving it untouched", async () => {
    const start = { maestro: ["alpha"], to_maestro_tasks: [] };
    const r = await install(project(JSON.stringify({ ...BASE, start_skills: start })));
    expect(r.seeded).toEqual({ start_skills: false, end_skills: true, gatesRemoved: false });
    expect(body(r.raw)).toMatchObject({ start_skills: start, end_skills: { maestro: [] } });
  });

  it("seeds only start_skills when end_skills is already there", async () => {
    const end = { maestro: ["wrap-up"] };
    const r = await install(project(JSON.stringify({ ...BASE, end_skills: end })));
    expect(r.seeded).toEqual({ start_skills: true, end_skills: false, gatesRemoved: false });
    expect(body(r.raw)).toMatchObject({ end_skills: end, start_skills: { to_maestro_tasks: ["confidence-check"] } });
  });

  it("leaves present lists byte-for-byte unchanged, including deliberately empty ones", async () => {
    // Hand-formatted so any rewrite (reindent, key order, trailing newline) is visible.
    const version = JSON.parse(
      fs.readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8")
    ).version;
    const text =
      '{"version":3,"agents_available":[],"skills_available":[],"workflow_instances":[],"workflows":[],"rules":[],' +
      `"start_skills":{"maestro":[],"to_maestro_tasks":[]},"end_skills":{"maestro":[]},"runtimeVersion":"${version}"}`;
    const root = project(text);
    const r = await install(root);
    expect(r.seeded).toBeNull();
    // Already stamped with this runtime, so no step has a reason to rewrite the file at all.
    expect(r.raw).toBe(text);
  });

  it("removes a leftover gates key", async () => {
    const gates = { maestro: true, to_maestro_tasks: true };
    const r = await install(project(JSON.stringify({ ...BASE, gates })));
    expect(r.seeded).toEqual({ start_skills: true, end_skills: true, gatesRemoved: true });
    expect("gates" in JSON.parse(r.raw)).toBe(false);
  });

  it("removes gates even when both lists exist", async () => {
    const lists = { start_skills: { maestro: [], to_maestro_tasks: [] }, end_skills: { maestro: [] } };
    const r = await install(project(JSON.stringify({ ...BASE, ...lists, gates: { maestro: true } })));
    expect(r.seeded).toEqual({ start_skills: false, end_skills: false, gatesRemoved: true });
    expect(body(r.raw)).toEqual({ ...BASE, ...lists });
  });

  it("is idempotent: a second run seeds nothing", async () => {
    const root = project(JSON.stringify(BASE));
    await install(root);
    const second = await install(root);
    expect(second.seeded).toBeNull();
  });
});

describe("seedMissingSkillLists", () => {
  it("returns the same object when nothing is missing", () => {
    const cfg = { ...BASE, start_skills: { maestro: [], to_maestro_tasks: [] }, end_skills: { maestro: [] } };
    const out = seedMissingSkillLists(cfg as never);
    expect(out.changed).toBe(false);
    expect(out.config).toBe(cfg);
  });
});

describe("stale-refs check on a config lacking start_skills", () => {
  it("tells the user to re-install", () => {
    const root = project("{}");
    const wf = [{ name: "default", nodes: [], edges: [] }];
    const report = findStaleSkillRefs(root, { ...BASE, workflows: wf }, home);
    expect(report.suggestions.some((s) => s.includes("no start_skills") && s.includes("Re-install"))).toBe(true);
  });

  it("stays quiet once start_skills exists, and for an empty config", () => {
    const root = project("{}");
    const wf = [{ name: "default", nodes: [], edges: [] }];
    const ok = { ...BASE, workflows: wf, start_skills: { maestro: [], to_maestro_tasks: [] } };
    expect(findStaleSkillRefs(root, ok, home).suggestions).toEqual([]);
    expect(findStaleSkillRefs(root, BASE, home).suggestions).toEqual([]);
    expect(findStaleSkillRefs(root, {}, home).suggestions).toEqual([]);
  });
});
