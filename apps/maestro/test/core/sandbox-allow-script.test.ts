// The plugin's real maestro-sandbox-allow.cjs, spawned against temp projects. Contract: a dry run
// writes nothing; --apply adds the narrow entries and keeps every other key; it recognises only its
// own entries, so a stale installer path is replaced and a hand-written entry is never touched;
// --remove takes back exactly what it added.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = path.resolve(here, "../../../../plugins/maestro");
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "maestro-sandbox-allow.cjs");
const INSTALLER_ENTRY = `node ${path.join(PLUGIN_ROOT, "scripts", "maestro-install.js")} *`;

let tmp: string;
let home: string;
let n = 0;

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sandbox-allow-script-"));
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
});
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

function project(settings?: object | string): { root: string; settingsPath: string } {
  const root = path.join(tmp, `p${n++}`);
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  const settingsPath = path.join(root, ".claude", "settings.local.json");
  if (settings !== undefined) {
    fs.writeFileSync(settingsPath, typeof settings === "string" ? settings : JSON.stringify(settings));
  }
  return { root, settingsPath };
}

function run(root: string, ...flags: string[]) {
  const res = spawnSync("node", [SCRIPT, root, ...flags], { encoding: "utf8", env: pinnedEnv(home) });
  return { code: res.status ?? -1, out: JSON.parse(res.stdout), stderr: res.stderr };
}

const readSettings = (p: string) => JSON.parse(fs.readFileSync(p, "utf8"));

describe("maestro-sandbox-allow.cjs", () => {
  it("a dry run lists what --apply would add and writes nothing", () => {
    const { root, settingsPath } = project();
    const { code, out } = run(root);
    expect(code).toBe(0);
    expect(out.dryRun).toBe(true);
    expect(out.upToDate).toBe(false);
    expect(out.added.map((a: { value: string }) => a.value)).toContain(INSTALLER_ENTRY);
    expect(out.applyCommand).toBe(`node ${SCRIPT} ${root} --apply`);
    expect(fs.existsSync(settingsPath)).toBe(false);
  });

  it("--apply adds the narrow entries and the script guards, keeping every other key", () => {
    const { root, settingsPath } = project({
      model: "opus",
      sandbox: { enabled: true, excludedCommands: ["gh *"] },
      permissions: { allow: ["Bash(ls)"] },
    });
    expect(run(root, "--apply").code).toBe(0);

    const s = readSettings(settingsPath);
    expect(s.model).toBe("opus");
    expect(s.sandbox.enabled).toBe(true);
    expect(s.permissions.allow).toEqual(["Bash(ls)"]);
    expect(s.sandbox.excludedCommands).toEqual([
      "gh *",
      "node .claude/scripts/maestro-render-orchestrator.cjs",
      "node .claude/scripts/maestro-render-orchestrator.cjs .",
      "node .claude/scripts/maestro-task-status.cjs worktree *",
      "node .claude/scripts/maestro-task-status.cjs freeform-check *",
      "node .claude/scripts/maestro-task-status.cjs merge *",
      INSTALLER_ENTRY,
    ]);
    expect(s.sandbox.filesystem.denyWrite).toEqual([path.join(root, ".claude", "scripts")]);
    expect(s.permissions.deny).toEqual(["Edit(/.claude/scripts/**)"]);

    const again = run(root);
    expect(again.out.upToDate).toBe(true);
    expect(again.out.sandboxEnabled).toBe(true);
  });

  it("replaces an older plugin version's installer entry and reports, but keeps, a broad hand-written one", () => {
    const stale = "node /old/cache/maestro/0.1.0/scripts/maestro-install.js *";
    const broad = "node *maestro-install.js*";
    const { root, settingsPath } = project({ sandbox: { excludedCommands: [broad, stale] } });

    const preview = run(root);
    expect(preview.out.removed).toEqual([{ kind: "excludedCommands", value: stale }]);
    expect(preview.out.broadEntries).toEqual([broad]);

    run(root, "--apply");
    const entries = readSettings(settingsPath).sandbox.excludedCommands;
    expect(entries).toContain(broad);
    expect(entries).toContain(INSTALLER_ENTRY);
    expect(entries).not.toContain(stale);
  });

  it("--remove takes out only its own entries and leaves no empty containers", () => {
    const { root, settingsPath } = project({ model: "opus", sandbox: { excludedCommands: ["gh *"] } });
    run(root, "--apply");

    const preview = run(root, "--remove", "--dry-run");
    expect(preview.out.removed).toHaveLength(8);
    expect(readSettings(settingsPath).permissions.deny).toEqual(["Edit(/.claude/scripts/**)"]);

    expect(run(root, "--remove").code).toBe(0);
    expect(readSettings(settingsPath)).toEqual({ model: "opus", sandbox: { excludedCommands: ["gh *"] } });
  });

  it("refuses a settings.local.json that does not parse, writing nothing", () => {
    const { root, settingsPath } = project("{ not json");
    const { code, out } = run(root, "--apply");
    expect(code).toBe(1);
    expect(out.ok).toBe(false);
    expect(fs.readFileSync(settingsPath, "utf8")).toBe("{ not json");
  });
});
