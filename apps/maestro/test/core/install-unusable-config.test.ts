// `096`: both installers refuse an unusable `.claude/maestro.json` (unparseable, or not version 3),
// leave it byte-for-byte alone, write nothing else, and agree on the outcome. A missing file still
// installs fresh and a valid v3 config keeps the `092` seeding.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { maestroConfigRefusal } from "../../src/core/config-usable.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const INSTALLER = path.join(PLUGIN_ROOT, "scripts", "maestro-install.js");

let tmp: string;
let home: string;
let n = 0;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-unusable-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function project(configText: string | null): string {
  const root = path.join(tmp, `p${n++}`);
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  if (configText !== null) fs.writeFileSync(path.join(root, ".claude", "maestro.json"), configText);
  return root;
}

/** Every file under the project (relative path -> bytes), excluding .git. */
function snapshot(root: string): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out[path.relative(root, full)] = fs.readFileSync(full, "utf8");
    }
  };
  walk(root);
  return out;
}

interface Outcome {
  refused: boolean;
  message: string;
  crashed: boolean;
}

const INSTALLERS: Record<string, (root: string) => Promise<Outcome>> = {
  "installRuntime (app)": async (root) => {
    const prev = process.env.HOME;
    process.env.HOME = home;
    try {
      const r = await installRuntime(
        root,
        PLUGIN_ROOT,
        path.join(tmp, "reports.sqlite"),
        path.join(tmp, "tags.sqlite"),
        path.join(tmp, "handoffs.sqlite")
      );
      return { refused: r.configRefusal !== null, message: r.configRefusal?.message ?? "", crashed: false };
    } finally {
      process.env.HOME = prev;
    }
  },
  "maestro-install.js (plugin)": async (root) => {
    const res = spawnSync("node", [INSTALLER, root], { encoding: "utf8", env: pinnedEnv(home) });
    const lastLine = res.stdout.trim().split("\n").pop() ?? "";
    const json = lastLine ? JSON.parse(lastLine) : {};
    const crashed = /\bat .*\(.*:\d+:\d+\)|SyntaxError|TypeError/.test(res.stderr);
    return {
      refused: json.ok === false && json.refused === "config",
      message: json.reason ?? "",
      crashed,
    };
  },
};

const CORRUPT = '{ "version": 3, "workflows": [ oops ';
const OLD_VERSION = JSON.stringify({ version: 2, workflows: [{ id: "keep-me" }] }, null, 2);
const NO_VERSION = JSON.stringify({ workflows: [{ id: "keep-me" }] });

describe.each(Object.entries(INSTALLERS))("unusable maestro.json via %s", (_name, install) => {
  it.each([
    ["unparseable", CORRUPT, "not valid JSON"],
    ["a version other than 3", OLD_VERSION, "found version 2"],
    ["no version", NO_VERSION, "found no version"],
    ["a non-object", "[1, 2]", "found no version"],
  ])("refuses %s, leaving the whole project untouched", async (_label, text, fragment) => {
    const root = project(text);
    const before = snapshot(root);
    const out = await install(root);
    expect(out.crashed).toBe(false);
    expect(out.refused).toBe(true);
    expect(out.message).toContain(".claude/maestro.json");
    expect(out.message).toContain(fragment);
    expect(out.message).toMatch(/by hand/);
    expect(out.message).toMatch(/move it aside/);
    expect(snapshot(root)).toEqual(before);
  });

  it("carries the parser message (position or surrounding text)", async () => {
    const out = await install(project(CORRUPT));
    expect(out.message).toContain("Unexpected token");
  });

  it("still installs fresh when maestro.json is missing", async () => {
    const root = project(null);
    const out = await install(root);
    expect(out.refused).toBe(false);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8"));
    expect(cfg.version).toBe(3);
    expect(fs.existsSync(path.join(root, ".claude", "scripts"))).toBe(true);
  });

  it("keeps the 092 seeding for a valid v3 config", async () => {
    const root = project(
      JSON.stringify({ version: 3, workflow_instances: [], workflows: [], rules: [], gates: { x: true } })
    );
    const out = await install(root);
    expect(out.refused).toBe(false);
    const cfg = JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8"));
    expect(cfg.start_skills).toBeDefined();
    expect(cfg.gates).toBeUndefined();
  });
});

describe("maestroConfigRefusal", () => {
  it("accepts a version 3 object and rejects everything else with the same wording on both paths", () => {
    expect(maestroConfigRefusal('{"version":3}')).toBeNull();
    expect(maestroConfigRefusal("{")?.kind).toBe("unparseable");
    expect(maestroConfigRefusal('{"version":"3"}')?.problem).toContain('"3"');
    expect(maestroConfigRefusal("null")?.kind).toBe("unsupported-version");
  });
});
