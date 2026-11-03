// `090`: the plugin's real maestro-stale-refs.cjs, spawned against temp projects. Contract: one JSON
// line, exit 0 under every input (it is advice, never a failure), and it agrees with
// `findStaleSkillRefs` because both run the same bundled lib.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(here, "../../../../plugins/maestro/scripts/maestro-stale-refs.cjs");
const DESIGN = "code-graph:use-code-architecture-design-check";
const CODE_GRAPH_DESIGN = DESIGN;

let tmp: string;
let home: string;
let n = 0;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stale-refs-script-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function project(files: Record<string, string | object>): string {
  const root = path.join(tmp, `p${n++}`);
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  for (const [rel, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(root, ".claude", rel), typeof body === "string" ? body : JSON.stringify(body));
  }
  return root;
}

function run(args: string[], env: NodeJS.ProcessEnv = {}, cwd?: string) {
  const res = spawnSync("node", [SCRIPT, ...args], {
    encoding: "utf8",
    env: pinnedEnv(home, env),
    cwd,
  });
  return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
}

function parse(res: { code: number; stdout: string; stderr: string }) {
  expect(res.code).toBe(0);
  expect(res.stderr).toBe("");
  expect(res.stdout.trimEnd().split("\n")).toHaveLength(1);
  return JSON.parse(res.stdout) as {
    checked: boolean;
    dangling: { id: string; reason: string; where: string[] }[];
    suggestions: string[];
  };
}

describe("maestro-stale-refs.cjs", () => {
  it("reports a dangling namespaced skill with its reason and where", () => {
    const root = project({
      "maestro.json": {
        version: 3,
        skills_available: [DESIGN],
        start_skills: { maestro: [], to_maestro_tasks: [DESIGN] },
      },
    });
    const out = parse(run([root]));
    expect(out.checked).toBe(true);
    expect(out.dangling).toEqual([
      { id: DESIGN, reason: "plugin-not-installed", where: ["skills_available", "start_skills.to_maestro_tasks"] },
    ]);
    expect(out.suggestions[0]).toContain(DESIGN);
  });

  it("a clean config reports nothing dangling", () => {
    const root = project({ "maestro.json": { version: 3, skills_available: [] } });
    expect(parse(run([root]))).toEqual({ checked: true, dangling: [], suggestions: [] });
  });

  it("with the plugin enabled for the project, the namespaced id no longer dangles", () => {
    const root = project({
      "maestro.json": { version: 3, skills_available: [DESIGN] },
      "settings.json": { enabledPlugins: { "code-graph@code-graph": true } },
    });
    expect(parse(run([root])).dangling).toEqual([]);
  });

  it("uses CLAUDE_PROJECT_DIR when no argument is given, and cwd after that", () => {
    const root = project({ "maestro.json": { version: 3, skills_available: ["ghost"] } });
    expect(parse(run([], { CLAUDE_PROJECT_DIR: root })).dangling.map((d) => d.id)).toEqual(["ghost"]);
    const env = { ...process.env, HOME: home };
    delete env.CLAUDE_PROJECT_DIR;
    delete env.CLAUDE_CODE_SESSION_ID;
    const res = spawnSync("node", [SCRIPT], { encoding: "utf8", env, cwd: root });
    expect(JSON.parse(res.stdout).dangling.map((d: { id: string }) => d.id)).toEqual(["ghost"]);
  });

  it("no maestro.json: checked false, exit 0", () => {
    const root = project({});
    expect(parse(run([root]))).toEqual({ checked: false, dangling: [], suggestions: [] });
  });

  it("corrupt maestro.json: checked false, exit 0, no stderr", () => {
    const root = project({ "maestro.json": "{ not json" });
    expect(parse(run([root])).checked).toBe(false);
  });

  it("maestro.json that is JSON but not an object: checked false", () => {
    const root = project({ "maestro.json": "42" });
    expect(parse(run([root])).checked).toBe(false);
  });

  it("a project directory that does not exist still exits 0", () => {
    expect(parse(run([path.join(tmp, "nope")])).checked).toBe(false);
  });

  it("still suggests migrating via /code-graph-install with no maestro.json when concept-skills.json exists and code-graph is off", () => {
    const root = project({ "concept-skills.json": { version: "1.0", last_update: "x" } });
    const out = parse(run([root]));
    expect(out.checked).toBe(false);
    expect(out.suggestions.join("\n")).toContain("/code-graph-install");
    expect(out.suggestions.join("\n")).not.toContain("@maestro");
  });

  it("suggests it alongside dangling refs when maestro.json exists", () => {
    const root = project({
      "maestro.json": { version: 3, skills_available: ["ghost"] },
      "concept-skills.json": { version: "1.0", last_update: "x" },
    });
    const out = parse(run([root]));
    expect(out.dangling).toHaveLength(1);
    expect(out.suggestions.some((s) => s.includes("/code-graph-install"))).toBe(true);
  });

  it("suggests enabling code-graph for a root scribe.config.json with no maestro.json; absent once enabled", () => {
    const root = project({});
    fs.writeFileSync(path.join(root, "scribe.config.json"), "{}");
    const out = parse(run([root]));
    expect(out.checked).toBe(false);
    expect(out.suggestions).toHaveLength(1);
    expect(out.suggestions[0]).toContain("scribe.config.json");

    fs.writeFileSync(
      path.join(root, ".claude", "settings.json"),
      JSON.stringify({ enabledPlugins: { "code-graph@code-graph": true } })
    );
    expect(parse(run([root])).suggestions).toEqual([]);
  });

  it("a code-graph: id dangles as plugin-not-installed when code-graph is absent, and not once it is enabled", () => {
    const cfg = { version: 3, skills_available: [CODE_GRAPH_DESIGN] };
    const off = project({ "maestro.json": cfg });
    expect(parse(run([off])).dangling.map((d) => [d.id, d.reason])).toEqual([
      [CODE_GRAPH_DESIGN, "plugin-not-installed"],
    ]);

    const on = project({
      "maestro.json": cfg,
      "settings.json": { enabledPlugins: { "code-graph@code-graph": true } },
    });
    expect(parse(run([on])).dangling).toEqual([]);
  });
});
