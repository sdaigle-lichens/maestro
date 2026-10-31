// `121`: the channel write guard's project-local registration, held equal across the app's
// HOOK_REGISTRATIONS, the plugin's maestro-install.js and hooks.json; removed by both uninstallers;
// and (122) the plugin copy shown NOT to stand down, end to end (real scripts, temp projects, HOME pinned,
// CLAUDE_CODE_SESSION_ID deleted).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot, HOOK_REGISTRATIONS, CHANNEL_GUARD_MATCHER } from "../../src/core/install.js";
import { uninstallRuntime } from "../../src/core/uninstall.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const INSTALLER = path.join(PLUGIN_ROOT, "scripts", "maestro-install.js");
const UNINSTALLER = path.join(PLUGIN_ROOT, "scripts", "maestro-uninstall.js");
const PLUGIN_GUARD = path.join(PLUGIN_ROOT, "scripts", "maestro-channel-write-guard.js");
const SCRIPT = "maestro-channel-write-guard";
const MATCHER = "Write|Edit|MultiEdit|NotebookEdit";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-121-"));
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

function guardEntries(root: string): Array<[string, string, string]> {
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

const EXPECTED: Array<[string, string, string]> = [
  ["PreToolUse", MATCHER, `node "$CLAUDE_PROJECT_DIR/.claude/scripts/${SCRIPT}.cjs"`],
];

function payload(cwd: string, file: string) {
  return {
    hook_event_name: "PreToolUse",
    cwd,
    agent_type: "reviewer",
    tool_name: "Write",
    tool_input: { file_path: file },
  };
}

function runPluginGuard(cwd: string, file: string): string {
  return execFileSync("node", [PLUGIN_GUARD], {
    input: JSON.stringify(payload(cwd, file)),
    encoding: "utf8",
    env: pinnedEnv(tmp, { CLAUDE_PROJECT_DIR: cwd }),
  });
}

function runProjectGuard(root: string, cwd: string, file: string): string {
  return execFileSync("node", [path.join(root, ".claude", "scripts", `${SCRIPT}.cjs`)], {
    input: JSON.stringify(payload(cwd, file)),
    encoding: "utf8",
    env: pinnedEnv(tmp, { CLAUDE_PROJECT_DIR: root }),
  });
}

const decision = (out: string) => (out ? JSON.parse(out).hookSpecificOutput.permissionDecision : "allow");

describe("channel write guard registration (121)", () => {
  it("HOOK_REGISTRATIONS carries exactly one guard entry, with hooks.json's matcher", () => {
    const mine = HOOK_REGISTRATIONS.filter((h) => h.script === `${SCRIPT}.cjs`).map((h) => [h.event, h.matcher]);
    expect(mine).toEqual([["PreToolUse", MATCHER]]);
    expect(CHANNEL_GUARD_MATCHER).toBe(MATCHER);
    const hooks = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, "hooks", "hooks.json"), "utf8")).hooks;
    const found: Array<[string, string]> = [];
    for (const [event, list] of Object.entries(hooks) as Array<[string, any[]]>) {
      for (const entry of list) {
        for (const h of entry.hooks ?? []) {
          if ((h.args ?? []).some((a: string) => a.endsWith(`/${SCRIPT}.js`))) found.push([event, entry.matcher]);
        }
      }
    }
    expect(found).toEqual([["PreToolUse", MATCHER]]);
  });

  it("the app installer and the terminal installer write identical registrations and the script", async () => {
    const mine = project("mine");
    const theirs = project("theirs");
    await appInstall(mine);
    pluginInstall(theirs);
    expect(guardEntries(mine)).toEqual(EXPECTED);
    expect(guardEntries(theirs)).toEqual(EXPECTED);
    for (const root of [mine, theirs]) {
      expect(fs.existsSync(path.join(root, ".claude", "scripts", `${SCRIPT}.cjs`)), root).toBe(true);
    }
    expect(fs.readFileSync(path.join(theirs, ".claude", "scripts", `${SCRIPT}.cjs`), "utf8")).toBe(
      fs.readFileSync(path.join(mine, ".claude", "scripts", `${SCRIPT}.cjs`), "utf8")
    );
  });

  it("re-installing with either installer, in either order, never duplicates it", async () => {
    const root = project("twice");
    await appInstall(root);
    pluginInstall(root);
    pluginInstall(root);
    await appInstall(root);
    expect(guardEntries(root)).toEqual(EXPECTED);
  });

  it("the app's uninstall removes the registration; the script stays until purge", async () => {
    const root = project("un-app");
    await appInstall(root);
    const report = await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT });
    expect(report.hooksRemoved).toContain(`PreToolUse:${SCRIPT}.cjs`);
    expect(guardEntries(root)).toEqual([]);

    await appInstall(root);
    await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT, purge: true });
    expect(fs.existsSync(path.join(root, ".claude", "scripts", `${SCRIPT}.cjs`))).toBe(false);
  });

  it("the plugin's uninstall removes it, and --purge removes the script", () => {
    const root = project("un-plugin");
    pluginInstall(root);
    execFileSync("node", [UNINSTALLER, root], { encoding: "utf8", env: pinnedEnv(tmp) });
    expect(guardEntries(root)).toEqual([]);
    pluginInstall(root);
    execFileSync("node", [UNINSTALLER, root, "--purge"], { encoding: "utf8", env: pinnedEnv(tmp) });
    expect(fs.existsSync(path.join(root, ".claude", "scripts", `${SCRIPT}.cjs`))).toBe(false);
  });
});

describe("channel write guard is exempt from stand-down (122)", () => {
  it("a terminal-installed intact project: both copies deny, each exactly once, with no side effects", () => {
    const root = project("term");
    pluginInstall(root);
    const target = path.join(root, "src", "app.ts");
    const before = fs.readdirSync(root, { recursive: true }).sort();
    const outs = [runPluginGuard(root, target), runProjectGuard(root, root, target)];
    for (const out of outs) {
      expect(decision(out)).toBe("deny");
      expect(JSON.parse(out).hookSpecificOutput.hookEventName).toBe("PreToolUse");
    }
    expect(fs.readdirSync(root, { recursive: true }).sort()).toEqual(before);
  });

  it("the project script is missing: the project copy cannot run, the plugin copy still denies", () => {
    const root = project("no-script");
    pluginInstall(root);
    fs.rmSync(path.join(root, ".claude", "scripts", `${SCRIPT}.cjs`));
    const target = path.join(root, "src", "app.ts");
    expect(() => runProjectGuard(root, root, target)).toThrow();
    expect(decision(runPluginGuard(root, target))).toBe("deny");
  });

  it("the project lib/ is missing: the project copy cannot run, the plugin copy still denies", () => {
    const root = project("no-lib");
    pluginInstall(root);
    fs.rmSync(path.join(root, ".claude", "scripts", "lib"), { recursive: true, force: true });
    const target = path.join(root, "src", "app.ts");
    expect(() => runProjectGuard(root, root, target)).toThrow();
    expect(decision(runPluginGuard(root, target))).toBe("deny");
  });

  // No session id resolves here (payload carries none, env id deleted), so the scope is
  // `session-none` (`144`) — the one scope this reviewer may write to.
  it("the plugin copy still allows a reviewer payload write under .claude/channels/<own scope>/", () => {
    const root = project("channels");
    pluginInstall(root);
    expect(runPluginGuard(root, path.join(root, ".claude", "channels", "session-none", "scribe", "r.1.md"))).toBe("");
    // ...and denies the legacy unscoped root and another scope (144).
    expect(decision(runPluginGuard(root, path.join(root, ".claude", "channels", "scribe", "r.1.md")))).toBe("deny");
    expect(decision(runPluginGuard(root, path.join(root, ".claude", "channels", "task-001", "scribe", "r.1.md")))).toBe(
      "deny"
    );
  });

  it("a guard registered only in settings.local.json does not silence the plugin copy", () => {
    const root = project("local");
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".claude", "settings.local.json"),
      JSON.stringify({
        hooks: {
          PreToolUse: [
            { matcher: MATCHER, hooks: [{ type: "command", command: `node ".claude/scripts/${SCRIPT}.cjs"` }] },
          ],
        },
      })
    );
    expect(decision(runPluginGuard(root, path.join(root, "src", "app.ts")))).toBe("deny");
  });

  it("an unparseable project settings.json does not silence the plugin copy", () => {
    const root = project("broken");
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), "{ not json");
    expect(decision(runPluginGuard(root, path.join(root, "src", "app.ts")))).toBe("deny");
  });

  it("a symlinked cwd: both copies still enforce", async () => {
    const real = project("real");
    await appInstall(real);
    const link = path.join(tmp, "link");
    fs.symlinkSync(real, link, "dir");
    const viaLink = path.join(link, "src", "app.ts");
    expect(decision(runPluginGuard(link, viaLink))).toBe("deny");
    expect(decision(runProjectGuard(real, link, viaLink))).toBe("deny");
    expect(
      decision(runProjectGuard(real, link, path.join(link, ".claude", "channels", "session-none", "scribe", "r.1.md")))
    ).toBe("allow");
    expect(decision(runProjectGuard(real, link, path.join(link, ".claude", "channels", "scribe", "r.1.md")))).toBe(
      "deny"
    );
  });
});
