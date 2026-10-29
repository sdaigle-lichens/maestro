// `139`: install merges the allow rule `Write(/.claude/channels/**)` into the project's
// .claude/settings.json `permissions.allow` (so the auto-mode classifier stops judging subagents'
// channel writes), idempotently, and uninstall removes exactly that rule. Both implementations: the
// TS core (installRuntime / uninstallRuntime) and the plugin scripts (maestro-install.js /
// maestro-uninstall.js), run for real in temp projects.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  installRuntime,
  findUpPluginRoot,
  addChannelAllowRule,
  removeChannelAllowRule,
  CHANNEL_WRITE_ALLOW_RULE,
} from "../../src/core/install.js";
import { uninstallRuntime } from "../../src/core/uninstall.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const SCRIPTS = path.join(PLUGIN_ROOT, "scripts");
const RULE = "Write(/.claude/channels/**)";

vi.setConfig({ testTimeout: 30_000 });

let tmp: string;
let n = 0;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-139-allow-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function project(initialSettings?: unknown | string): string {
  const root = path.join(tmp, `p${n++}`);
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  if (initialSettings !== undefined)
    fs.writeFileSync(
      path.join(root, ".claude", "settings.json"),
      typeof initialSettings === "string" ? initialSettings : JSON.stringify(initialSettings, null, 2)
    );
  return root;
}
const settingsPath = (root: string) => path.join(root, ".claude", "settings.json");
const settingsText = (root: string) => fs.readFileSync(settingsPath(root), "utf8");
const settingsOf = (root: string) => JSON.parse(settingsText(root));

const DBS = () => [
  path.join(tmp, "report-defaults.sqlite"),
  path.join(tmp, "project-tags.sqlite"),
  path.join(tmp, "handoff-defaults.sqlite"),
];
const appInstall = (root: string) => installRuntime(root, PLUGIN_ROOT, ...(DBS() as [string, string, string]));
const scriptInstall = (root: string) =>
  JSON.parse(
    execFileSync("node", [path.join(SCRIPTS, "maestro-install.js"), root], {
      encoding: "utf8",
      env: pinnedEnv(tmp),
    })
  );
const scriptUninstall = (root: string, ...args: string[]) =>
  JSON.parse(
    execFileSync("node", [path.join(SCRIPTS, "maestro-uninstall.js"), root, ...args], {
      encoding: "utf8",
      env: pinnedEnv(tmp),
    })
  );

describe("the rule constant", () => {
  it("is exactly the anchored channels write rule", () => {
    expect(CHANNEL_WRITE_ALLOW_RULE).toBe(RULE);
  });
});

describe("addChannelAllowRule / removeChannelAllowRule (pure)", () => {
  it("adds to empty settings, creating permissions.allow", () => {
    const s: any = {};
    expect(addChannelAllowRule(s)).toEqual([RULE]);
    expect(s).toEqual({ permissions: { allow: [RULE] } });
  });

  it("is a no-op when present, and appends after existing rules otherwise", () => {
    const s: any = { permissions: { allow: ["Bash(ls)"] } };
    expect(addChannelAllowRule(s)).toEqual([RULE]);
    expect(s.permissions.allow).toEqual(["Bash(ls)", RULE]);
    expect(addChannelAllowRule(s)).toEqual([]);
    expect(s.permissions.allow).toEqual(["Bash(ls)", RULE]);
  });

  it.each([
    ["permissions null", { permissions: null }],
    ["permissions a string", { permissions: "nope" }],
    ["permissions an array", { permissions: [] }],
    ["allow a string", { permissions: { allow: "Bash(ls)" } }],
    ["allow an object", { permissions: { allow: {} } }],
    ["allow null", { permissions: { allow: null } }],
  ])("leaves malformed settings alone: %s", (_n, input) => {
    const s: any = structuredClone(input);
    expect(addChannelAllowRule(s)).toEqual([]);
    expect(s).toEqual(input);
  });

  it("remove: only the exact rule; drops allow then permissions only when emptied", () => {
    const only: any = { permissions: { allow: [RULE] } };
    expect(removeChannelAllowRule(only)).toBe(true);
    expect(only).toEqual({});

    const withKey: any = { permissions: { allow: [RULE], deny: ["Bash(rm)"] } };
    expect(removeChannelAllowRule(withKey)).toBe(true);
    expect(withKey).toEqual({ permissions: { deny: ["Bash(rm)"] } });

    const mixed: any = { permissions: { allow: ["A", RULE, "Write(/.claude/channels/x)"] } };
    expect(removeChannelAllowRule(mixed)).toBe(true);
    expect(mixed.permissions.allow).toEqual(["A", "Write(/.claude/channels/x)"]);

    const none: any = { permissions: { allow: ["A"] } };
    expect(removeChannelAllowRule(none)).toBe(false);
    expect(removeChannelAllowRule({} as any)).toBe(false);
    expect(removeChannelAllowRule({ permissions: null } as any)).toBe(false);
  });
});

describe.each([
  ["TS core (installRuntime)", async (root: string) => (await appInstall(root)).permissionsAdded as string[]],
  ["plugin script (maestro-install.js)", async (root: string) => scriptInstall(root).permissionsAdded as string[]],
])("install merges the allow rule: %s", (_name, install) => {
  it("fresh project: adds exactly the rule", async () => {
    const root = project();
    expect(await install(root)).toEqual([RULE]);
    expect(settingsOf(root).permissions).toEqual({ allow: [RULE] });
  });

  it("second run leaves settings.json byte-identical and reports nothing added", async () => {
    const root = project();
    await install(root);
    const first = settingsText(root);
    expect(await install(root)).toEqual([]);
    expect(settingsText(root)).toBe(first);
    expect(settingsOf(root).permissions.allow.filter((r: string) => r === RULE)).toHaveLength(1);
  });

  it("preserves other allow entries, other permissions keys and top-level keys", async () => {
    const root = project({
      model: "opus",
      env: { A: "1" },
      permissions: { allow: ["Bash(git status)"], deny: ["Bash(rm -rf *)"], defaultMode: "acceptEdits" },
    });
    expect(await install(root)).toEqual([RULE]);
    const s = settingsOf(root);
    expect(s.model).toBe("opus");
    expect(s.env).toEqual({ A: "1" });
    expect(s.permissions).toEqual({
      allow: ["Bash(git status)", RULE],
      deny: ["Bash(rm -rf *)"],
      defaultMode: "acceptEdits",
    });
  });

  it("an existing rule written by the user is not duplicated", async () => {
    const root = project({ permissions: { allow: [RULE, "Bash(ls)"] } });
    expect(await install(root)).toEqual([]);
    expect(settingsOf(root).permissions.allow).toEqual([RULE, "Bash(ls)"]);
  });

  it.each([
    ["permissions null", { permissions: null }],
    ["permissions an array", { permissions: ["x"] }],
    ["allow a string", { permissions: { allow: "Bash(ls)" } }],
    ["allow an object", { permissions: { allow: { a: 1 } } }],
  ])("malformed %s is left untouched (install still succeeds)", async (_n, bad) => {
    const root = project(bad);
    expect(await install(root)).toEqual([]);
    const s = settingsOf(root);
    expect(s.permissions).toEqual((bad as any).permissions);
    expect(s.hooks).toBeDefined(); // hooks still registered
  });
});

describe("uninstall removes exactly that rule", () => {
  describe.each([
    ["TS core", (root: string, purge = false) => uninstallRuntime(root, { purge, pluginRoot: PLUGIN_ROOT })],
    ["plugin script", async (root: string, purge = false) => scriptUninstall(root, ...(purge ? ["--purge"] : []))],
  ])("%s", (_name, uninstall) => {
    it("keeps the user's other allow entries and keys", async () => {
      const root = project({ model: "opus", permissions: { allow: ["Bash(git status)"], deny: ["X"] } });
      await appInstall(root);
      expect(settingsOf(root).permissions.allow).toContain(RULE);
      await uninstall(root);
      const s = settingsOf(root);
      expect(s.model).toBe("opus");
      expect(s.permissions).toEqual({ allow: ["Bash(git status)"], deny: ["X"] });
    });

    it("drops allow and permissions when we emptied them (purge also removes a settings.json only ours)", async () => {
      const root = project();
      await appInstall(root);
      await uninstall(root, true);
      if (fs.existsSync(settingsPath(root))) {
        const s = settingsOf(root);
        expect(s.permissions).toBeUndefined();
      }
    });

    it("removes the rule even with no hooks left to remove (rule only)", async () => {
      const root = project({ permissions: { allow: [RULE, "A"] } });
      await uninstall(root);
      expect(settingsOf(root).permissions).toEqual({ allow: ["A"] });
    });

    it("leaves a similar-but-different rule alone", async () => {
      const root = project({
        permissions: { allow: ["Write(/.claude/channels/backend/**)", "Write(.claude/channels/**)"] },
      });
      await uninstall(root);
      expect(settingsOf(root).permissions.allow).toEqual([
        "Write(/.claude/channels/backend/**)",
        "Write(.claude/channels/**)",
      ]);
    });

    it("a permissions block that already had an empty allow key is not ours to tidy: untouched when rule absent", async () => {
      const root = project({ permissions: { allow: [] } });
      const before = settingsText(root);
      await uninstall(root);
      expect(settingsText(root)).toBe(before);
    });
  });

  it("round trip: user settings after install then uninstall equal what they started with", async () => {
    const start = { model: "opus", permissions: { allow: ["Bash(git status)"] } };
    const root = project(start);
    await appInstall(root);
    await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT });
    expect(settingsOf(root)).toEqual(start);
  });
});
