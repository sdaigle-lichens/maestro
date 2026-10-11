// Task 081: the two plugin CLIs, spawned for real against temp projects.
//   - maestro-rules.cjs   (list | move | unassign)  vs. core rule-move.ts / saveConfig / applyRules
//   - maestro-agent-fork.cjs (<agent> [--as name])  vs. core forkAgent / computeAgentSync
//
// HOME is pinned to a temp dir and CLAUDE_CODE_SESSION_ID is pinned per spawn, never inherited (`064`).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { findUpPluginRoot } from "../../src/core/install.js";
import { moveRule, unassignRule } from "../../src/core/rule-move.js";
import { forkAgent, readAgentForks } from "../../src/core/agent-fork.js";
import { computeAgentSync } from "../../src/core/agent-sync.js";
import { pinnedEnv } from "../helpers/env.js";

const PLUGIN_ROOT = findUpPluginRoot(path.dirname(new URL(import.meta.url).pathname))!;
const SCRIPTS = path.join(PLUGIN_ROOT, "scripts");
const AGENTS_DIR = path.join(PLUGIN_ROOT, "agents");
const PLUGIN_VERSION: string = JSON.parse(
  fs.readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8")
).version;
const SESSION = "sess-cli-081";

let tmp: string; // HOME + parent of every project
let projA: string;
let projB: string;

const mk = (p: string) => fs.realpathSync(fs.mkdirSync(p, { recursive: true }) ?? p);

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-cli081-")));
  projA = mk(path.join(tmp, "projA"));
  projB = mk(path.join(tmp, "projB"));
  // In-process core calls use the vitest-isolated HOME (test/setup-isolation.ts), a temp dir too.
  fs.mkdirSync(path.join(os.homedir(), ".claude"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function run(script: string, args: string[], root: string) {
  const env = pinnedEnv(path.join(tmp, "home"), { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: SESSION });
  // ~/.claude must exist: avatar-store.ts (unlike agent-types.ts) does not mkdir its db dir (reported as a product gap).
  fs.mkdirSync(path.join(env.HOME!, ".claude"), { recursive: true });
  const r = spawnSync("node", [path.join(SCRIPTS, script), ...args], { encoding: "utf8", env });
  const line = (r.stdout ?? "").trim();
  let json: any = null;
  try {
    json = JSON.parse(line);
  } catch {
    // leave null; the assertion on json will show stdout/stderr
  }
  return { code: r.status ?? -1, json, stdout: r.stdout ?? "", stderr: r.stderr ?? "", lines: line.split("\n").length };
}
const rules = (root: string, args: string[]) => run("maestro-rules.cjs", [...args, root], root);
const fork = (root: string, args: string[]) => run("maestro-agent-fork.cjs", [...args, root], root);

const BASE_CONFIG = {
  version: 3,
  agents_available: ["backend", "test"],
  skills_available: ["expressjs"],
  workflow_instances: [
    { name: "backend", agent: "backend", loaded_skills: ["expressjs"], referenced_skills: [] },
    { name: "test", agent: "test", loaded_skills: [], referenced_skills: ["x"] },
  ],
  workflows: [
    {
      name: "build",
      nodes: [{ id: "backend", type: "agent", instance: "backend", position: { x: 0, y: 100 } }],
      edges: [{ from: "main-session", to: "backend", kind: "success", sourceHandle: "bottom", targetHandle: "top" }],
    },
  ],
  gates: [{ id: "g1", name: "gate one" }],
  rules: [],
  reports: { custom: { a: 1 } },
  handoffs: { b: [2, 3] },
};

function setupProject(root: string, cfg: unknown = BASE_CONFIG) {
  fs.mkdirSync(path.join(root, ".claude", "rules"), { recursive: true });
  fs.mkdirSync(path.join(root, "pkg", "web"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".claude", "rules", "style.md"),
    "---\nname: style\ndescription: s\n---\nUse tabs.\n"
  );
  if (cfg !== null) {
    fs.writeFileSync(
      path.join(root, ".claude", "maestro.json"),
      typeof cfg === "string" ? cfg : JSON.stringify(cfg, null, 2) + "\n"
    );
  }
}
const cfgOf = (root: string) => JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8"));
const cfgRaw = (root: string) => fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8");
const ruleFile = (root: string, dir = "") => path.join(root, dir, ".claude", "rules", "style.md");

function otherSlices(c: Record<string, unknown>) {
  const { rules: _r, ...rest } = c;
  return JSON.stringify(rest);
}

describe("maestro-rules.cjs", () => {
  it("list reports every rule with its dir and assignment (one JSON line)", () => {
    setupProject(projA);
    const r = rules(projA, ["list"]);
    expect(r.code).toBe(0);
    expect(r.lines).toBe(1);
    expect(r.json).toEqual({ ok: true, rules: [{ id: "style", dir: "", assignment: null }] });
  });

  it("move to a directory places the file and writes {id, paths, source}; other slices preserved", () => {
    setupProject(projA);
    const before = otherSlices(cfgOf(projA));
    const r = rules(projA, ["move", "style", "--to", "pkg/web"]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.lines).toBe(1);
    expect(r.json).toMatchObject({ ok: true, id: "style", to: "pkg/web", placement: "move" });

    expect(fs.existsSync(ruleFile(projA, "pkg/web"))).toBe(true);
    expect(fs.existsSync(ruleFile(projA))).toBe(false);
    expect(cfgOf(projA).rules).toEqual([{ id: "style", paths: ["pkg/web/**"], source: "project" }]);
    expect(otherSlices(cfgOf(projA))).toBe(before);
  });

  it("move back to root ('.') writes {id, scope:project} and returns the file", () => {
    setupProject(projA);
    expect(rules(projA, ["move", "style", "--to", "pkg/web"]).code).toBe(0);
    const before = otherSlices(cfgOf(projA));
    const r = rules(projA, ["move", "style", "--to", "."]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(fs.existsSync(ruleFile(projA))).toBe(true);
    expect(fs.existsSync(ruleFile(projA, "pkg/web"))).toBe(false);
    expect(cfgOf(projA).rules).toEqual([{ id: "style", scope: "project", source: "project" }]);
    expect(otherSlices(cfgOf(projA))).toBe(before);
  });

  it("accepts a trailing slash, ./ prefix and /** suffix on the destination", () => {
    setupProject(projA);
    for (const to of ["pkg/web/", "./pkg/web", "pkg/web/**"]) {
      const r = rules(projA, ["move", "style", "--to", to]);
      expect(r.code, `${to}: ${r.stdout}`).toBe(0);
      expect(cfgOf(projA).rules[0].paths).toEqual(["pkg/web/**"]);
    }
  });

  it("parity: CLI and core moveRule give the same rules slice and file placement", async () => {
    setupProject(projA);
    setupProject(projB);
    for (const [to, scopeOnly] of [
      ["pkg/web", false],
      [".", false],
      ["pkg", true],
    ] as const) {
      const cli = rules(projA, ["move", "style", "--to", to, ...(scopeOnly ? ["--scope-only"] : [])]);
      expect(cli.code, cli.stdout).toBe(0);
      const core = await moveRule(projB, "style", to, { scopeOnly });
      expect(core.ok).toBe(true);
      expect(cfgOf(projA).rules).toEqual(cfgOf(projB).rules);
      expect(fs.existsSync(ruleFile(projA, "pkg/web"))).toBe(fs.existsSync(ruleFile(projB, "pkg/web")));
      expect(fs.existsSync(ruleFile(projA))).toBe(fs.existsSync(ruleFile(projB)));
      expect(cfgRaw(projA)).toBe(cfgRaw(projB));
      expect(rules(projA, ["list"]).json.rules).toEqual(rules(projB, ["list"]).json.rules);
    }
  });

  it("--scope-only scopes without moving the file", () => {
    setupProject(projA);
    const r = rules(projA, ["move", "style", "--to", "pkg/web", "--scope-only"]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json.placement).toBe("scope-only");
    expect(fs.existsSync(ruleFile(projA))).toBe(true);
    expect(fs.existsSync(ruleFile(projA, "pkg/web"))).toBe(false);
    expect(cfgOf(projA).rules).toEqual([
      { id: "style", paths: ["pkg/web/**"], placement: "scope-only", source: "project" },
    ]);
  });

  it("unassign removes only the assignment and keeps the file", () => {
    setupProject(projA);
    expect(rules(projA, ["move", "style", "--to", "pkg/web"]).code).toBe(0);
    const before = otherSlices(cfgOf(projA));
    const r = rules(projA, ["unassign", "style"]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json).toMatchObject({ ok: true, id: "style" });
    expect(cfgOf(projA).rules).toEqual([]);
    expect(fs.existsSync(ruleFile(projA, "pkg/web"))).toBe(true);
    expect(otherSlices(cfgOf(projA))).toBe(before);
  });

  it("unassign of an unassigned rule is refused", async () => {
    setupProject(projA);
    const r = rules(projA, ["unassign", "style"]);
    expect(r.code).toBe(1);
    expect(r.json.ok).toBe(false);
    setupProject(projB);
    expect((await unassignRule(projB, "style")).ok).toBe(false);
  });

  describe("refusals (exit 1, ok:false, config untouched)", () => {
    it.each([
      ["unknown rule", ["move", "nope", "--to", "pkg/web"]],
      ["absolute destination", ["move", "style", "--to", "/etc"]],
      ["parent destination", ["move", "style", "--to", ".."]],
      ["embedded .. destination", ["move", "style", "--to", "pkg/../../x"]],
      [".claude destination", ["move", "style", "--to", ".claude"]],
      ["nonexistent destination", ["move", "style", "--to", "does/not/exist"]],
      ["file (not dir) destination", ["move", "style", "--to", ".claude/maestro.json"]],
      ["missing --to", ["move", "style"]],
      ["missing rule id", ["move"]],
      ["unknown command", ["frobnicate"]],
      ["unknown option", ["move", "style", "--to", "pkg", "--bogus"]],
    ])("%s", (_n, args) => {
      setupProject(projA);
      const before = cfgRaw(projA);
      const r = rules(projA, args);
      expect(r.code, r.stdout + r.stderr).toBe(1);
      expect(r.json.ok).toBe(false);
      expect(typeof r.json.reason).toBe("string");
      expect(cfgRaw(projA)).toBe(before);
      expect(fs.existsSync(ruleFile(projA))).toBe(true);
    });

    it("missing maestro.json", () => {
      setupProject(projA, null);
      const r = rules(projA, ["move", "style", "--to", "pkg/web"]);
      expect(r.code).toBe(1);
      expect(r.json.ok).toBe(false);
      expect(fs.existsSync(path.join(projA, ".claude", "maestro.json"))).toBe(false);
      expect(fs.existsSync(ruleFile(projA))).toBe(true);
    });

    it.each([
      ["corrupt JSON", "{ not json"],
      ["non-v3 version", JSON.stringify({ version: 2, rules: [], workflows: [] })],
      ["no version", JSON.stringify({ rules: [] })],
    ])("%s is left byte-identical (move and unassign)", (_n, content) => {
      setupProject(projA, content);
      for (const args of [
        ["move", "style", "--to", "pkg/web"],
        ["unassign", "style"],
      ]) {
        const r = rules(projA, args);
        expect(r.code, r.stdout + r.stderr).toBe(1);
        expect(r.json.ok).toBe(false);
        expect(cfgRaw(projA)).toBe(content);
        expect(fs.existsSync(ruleFile(projA))).toBe(true);
      }
    });

    it("nonexistent project directory", () => {
      const r = run("maestro-rules.cjs", ["list", path.join(tmp, "nope")], projA);
      expect(r.code).toBe(1);
      expect(r.json.ok).toBe(false);
    });
  });
});

describe("maestro-agent-fork.cjs", () => {
  const strip = (m: Record<string, any>) =>
    Object.fromEntries(Object.entries(m).map(([k, v]) => [k, { ...v, forkedAt: "<t>" }]));
  const bundled = { agentsDir: AGENTS_DIR, version: PLUGIN_VERSION };

  it("forking a plugin agent matches core forkAgent: record, file, and sync verdict", async () => {
    const r = fork(projA, ["backend"]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.lines).toBe(1);
    expect(r.json).toMatchObject({
      ok: true,
      name: "backend",
      file: path.join(".claude", "agents", "backend.md"),
      template: "backend",
    });

    const core = await forkAgent(projB, AGENTS_DIR, PLUGIN_VERSION, "backend");
    expect(core.name).toBe("backend");

    expect(fs.readFileSync(path.join(projA, ".claude", "agents", "backend.md"), "utf8")).toBe(
      fs.readFileSync(path.join(projB, ".claude", "agents", "backend.md"), "utf8")
    );
    const recA = readAgentForks(projA);
    const recB = readAgentForks(projB);
    expect(strip(recA)).toEqual(strip(recB));
    expect(recA.backend.sourceTier).toBe("plugin");
    expect(recA.backend.sourcePlugin).toBe("maestro");
    expect(recA.backend.pluginVersion).toBe(PLUGIN_VERSION);
    expect(recA.backend.templateBodyHash).toMatch(/\S/);
    expect(r.json).toMatchObject({ sourceTier: "plugin", sourcePlugin: "maestro", pluginVersion: PLUGIN_VERSION });

    const syncA = await computeAgentSync(projA, { bundled, userAgentsDir: path.join(tmp, "ua") });
    const syncB = await computeAgentSync(projB, { bundled, userAgentsDir: path.join(tmp, "ua") });
    const norm = (s: any, root: string) => JSON.parse(JSON.stringify(s).split(root).join("<proj>"));
    expect(norm(syncA, projA)).toEqual(norm(syncB, projB));
    expect(syncA.unchanged).toEqual(["backend"]);
    expect(syncA.refreshed).toEqual([]);
  });

  it("accepts a plugin-qualified name (maestro:backend)", () => {
    const r = fork(projA, ["maestro:backend"]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json.name).toBe("backend");
  });

  it("--as renames the file and its name: line, and matches core forkAgent with the same rename", async () => {
    const r = fork(projA, ["backend", "--as", "backend-web"]);
    expect(r.code, r.stdout + r.stderr).toBe(0);
    expect(r.json).toMatchObject({ ok: true, name: "backend-web", template: "backend" });
    const file = path.join(projA, ".claude", "agents", "backend-web.md");
    expect(fs.existsSync(file)).toBe(true);
    expect(fs.existsSync(path.join(projA, ".claude", "agents", "backend.md"))).toBe(false);
    expect(fs.readFileSync(file, "utf8")).toMatch(/^name:\s*"?backend-web"?\s*$/m);

    await forkAgent(projB, AGENTS_DIR, PLUGIN_VERSION, "backend", "backend-web");
    expect(strip(readAgentForks(projA))).toEqual(strip(readAgentForks(projB)));
    expect(fs.readFileSync(file, "utf8")).toBe(
      fs.readFileSync(path.join(projB, ".claude", "agents", "backend-web.md"), "utf8")
    );
    const syncA = await computeAgentSync(projA, { bundled });
    const syncB = await computeAgentSync(projB, { bundled });
    const norm = (s: any, root: string) => JSON.parse(JSON.stringify(s).split(root).join("<proj>"));
    expect(norm(syncA, projA)).toEqual(norm(syncB, projB));
    expect(syncA.unchanged).toEqual(["backend-web"]);
  });

  describe("refusals (exit 1, ok:false)", () => {
    it("unknown agent", () => {
      const r = fork(projA, ["no-such-agent"]);
      expect(r.code).toBe(1);
      expect(r.json.ok).toBe(false);
      expect(fs.existsSync(path.join(projA, ".claude", "agents", "no-such-agent.md"))).toBe(false);
    });

    it("already a project agent", () => {
      fs.mkdirSync(path.join(projA, ".claude", "agents"), { recursive: true });
      const own = "---\nname: custom\ndescription: mine\n---\nbody\n";
      fs.writeFileSync(path.join(projA, ".claude", "agents", "custom.md"), own);
      const r = fork(projA, ["custom"]);
      expect(r.code).toBe(1);
      expect(r.json.ok).toBe(false);
      expect(fs.readFileSync(path.join(projA, ".claude", "agents", "custom.md"), "utf8")).toBe(own);
    });

    it.each(["Bad Name", "UPPER", "-lead", "a_b"])("bad name %j", (bad) => {
      const r = fork(projA, ["backend", "--as", bad]);
      expect(r.code).toBe(1);
      expect(r.json.ok).toBe(false);
      expect(fs.existsSync(path.join(projA, ".claude", "agents", `${bad}.md`))).toBe(false);
      expect(fs.existsSync(path.join(projA, ".claude", "agents-forks.json"))).toBe(false);
    });

    it("name taken", () => {
      fs.mkdirSync(path.join(projA, ".claude", "agents"), { recursive: true });
      const own = "---\nname: taken\ndescription: mine\n---\nbody\n";
      fs.writeFileSync(path.join(projA, ".claude", "agents", "taken.md"), own);
      const r = fork(projA, ["backend", "--as", "taken"]);
      expect(r.code).toBe(1);
      expect(r.json.ok).toBe(false);
      expect(fs.readFileSync(path.join(projA, ".claude", "agents", "taken.md"), "utf8")).toBe(own);
      expect(Object.keys(readAgentForks(projA))).toEqual([]);
    });

    it("missing agent argument and unknown option", () => {
      expect(run("maestro-agent-fork.cjs", [], projA).code).toBe(1);
      const r = fork(projA, ["backend", "--bogus"]);
      expect(r.code).toBe(1);
      expect(r.json.ok).toBe(false);
    });
  });
});
