// `113`: the maestro-session-name hook's five registrations, held equal across the three places
// they are declared — the app's HOOK_REGISTRATIONS (installRuntime), the plugin's maestro-install.js,
// and the plugin's hooks/hooks.json — and shown to install idempotently and to be removed by both
// uninstallers. Both installers really run against temp projects; HOME pinned, CLAUDE_CODE_SESSION_ID
// deleted.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  installRuntime,
  findUpPluginRoot,
  HOOK_REGISTRATIONS,
  SESSION_NAME_EXPANSION_MATCHER,
} from "../../src/core/install.js";
import { uninstallRuntime } from "../../src/core/uninstall.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const INSTALLER = path.join(PLUGIN_ROOT, "scripts", "maestro-install.js");
const UNINSTALLER = path.join(PLUGIN_ROOT, "scripts", "maestro-uninstall.js");
const SCRIPT = "maestro-session-name";

/** The registrations the task names, as [event, matcher]. */
const EXPECTED: Array<[string, string]> = [
  ["UserPromptExpansion", "^(maestro|(maestro:)?maestro-manager)$"],
  ["PreToolUse", "Skill"],
  ["UserPromptSubmit", ""],
  ["SessionStart", ""],
];

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-113-install-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function project(name: string): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeConfig(root, defaultish);
  return root;
}

const appInstall = (root: string) =>
  installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
const pluginInstall = (root: string) =>
  execFileSync("node", [INSTALLER, root], { encoding: "utf8", env: pinnedEnv(tmp) });

/** Every [event, matcher, command] in settings.json whose command runs the session-name script. */
function sessionNameEntries(root: string): Array<[string, string, string]> {
  const settings = JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"));
  const out: Array<[string, string, string]> = [];
  for (const [event, list] of Object.entries(settings.hooks ?? {}) as Array<[string, any[]]>) {
    for (const entry of list ?? []) {
      for (const h of entry.hooks ?? []) {
        if (String(h.command).includes(SCRIPT)) out.push([event, entry.matcher ?? "", h.command]);
      }
    }
  }
  return out.sort();
}

const expectedEntries = () =>
  EXPECTED.map(
    ([e, m]) => [e, m, `node "$CLAUDE_PROJECT_DIR/.claude/scripts/${SCRIPT}.cjs"`] as [string, string, string]
  ).sort();

describe("session-name hook registrations (113)", () => {
  it("HOOK_REGISTRATIONS declares exactly the four project-local registrations", () => {
    const mine = HOOK_REGISTRATIONS.filter((h) => h.script === `${SCRIPT}.cjs`).map((h) => [h.event, h.matcher]);
    expect(mine.sort()).toEqual([...EXPECTED].sort());
    expect(SESSION_NAME_EXPANSION_MATCHER).toBe(EXPECTED[0]![1]);
  });

  it("the UserPromptExpansion matcher takes both entrances and nothing else", () => {
    const re = new RegExp(SESSION_NAME_EXPANSION_MATCHER);
    for (const name of ["maestro", "maestro-manager", "maestro:maestro-manager"])
      expect(re.test(name), name).toBe(true);
    for (const name of [
      "maestro-tasks",
      "maestro-post-mortem",
      "maestro-manager-x",
      "xmaestro",
      "maestro:maestro-help",
      "",
    ]) {
      expect(re.test(name), name).toBe(false);
    }
  });

  it("the app installer and the plugin installer write identical registrations", async () => {
    const mine = project("mine");
    const theirs = project("theirs");
    await appInstall(mine);
    pluginInstall(theirs);
    expect(sessionNameEntries(mine)).toEqual(expectedEntries());
    expect(sessionNameEntries(theirs)).toEqual(sessionNameEntries(mine));
    for (const root of [mine, theirs]) {
      expect(fs.existsSync(path.join(root, ".claude", "scripts", `${SCRIPT}.cjs`)), root).toBe(true);
    }
  });

  it("hooks.json registers the plugin's copy for the same events and matchers", () => {
    const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8")).hooks;
    const found: Array<[string, string]> = [];
    for (const [event, list] of Object.entries(hooks) as Array<[string, any[]]>) {
      for (const entry of list) {
        for (const h of entry.hooks ?? []) {
          if ((h.args ?? []).some((a: string) => a === `\${CLAUDE_PLUGIN_ROOT}/scripts/${SCRIPT}.js`)) {
            expect(h).toMatchObject({ type: "command", command: "node" });
            found.push([event, entry.matcher ?? ""]);
          }
        }
      }
    }
    expect(found.sort()).toEqual([...EXPECTED].sort());
    expect(fs.existsSync(path.join(PLUGIN_ROOT, "scripts", `${SCRIPT}.js`))).toBe(true);
  });

  it("re-installing (either installer, either order) never duplicates a registration", async () => {
    const root = project("twice");
    await appInstall(root);
    await appInstall(root);
    pluginInstall(root);
    pluginInstall(root);
    await appInstall(root);
    expect(sessionNameEntries(root)).toEqual(expectedEntries());
  });

  it("the app's uninstall removes every session-name registration", async () => {
    const root = project("un-app");
    await appInstall(root);
    const report = await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT });
    expect(report.hooksRemoved).toEqual(expect.arrayContaining(EXPECTED.map(([e]) => `${e}:${SCRIPT}.cjs`)));
    expect(sessionNameEntries(root)).toEqual([]);
  });

  it("the plugin's uninstall removes them too, and --purge removes the script", () => {
    const root = project("un-plugin");
    pluginInstall(root);
    execFileSync("node", [UNINSTALLER, root], { encoding: "utf8", env: pinnedEnv(tmp) });
    expect(sessionNameEntries(root)).toEqual([]);

    pluginInstall(root);
    execFileSync("node", [UNINSTALLER, root, "--purge"], { encoding: "utf8", env: pinnedEnv(tmp) });
    expect(fs.existsSync(path.join(root, ".claude", "scripts", `${SCRIPT}.cjs`))).toBe(false);
  });
});
