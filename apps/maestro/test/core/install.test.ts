// Tests for the in-app installer that replaces `node maestro-install.js` run from a Claude
// session — including the part the legacy script never did: registering the runtime hooks in the
// PROJECT's own settings.json.
//
// The whole install path is exercised here without a Claude session ever running. What a session
// would add is the hook *dispatch*, so the closest thing to it is done directly: the copied hook
// scripts are executed with a synthetic payload and their side effects asserted. If those pass and
// the commands in settings.json point at those files, a real session has nothing left to get
// wrong but the dispatch itself.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  installRuntime,
  installStatus,
  runtimeAssets,
  findUpPluginRoot,
  HOOK_REGISTRATIONS,
} from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Snapshotted as .cjs, not .js: this package is "type": "module", so node would refuse to run the
// legacy script's `require`. Verbatim otherwise — see test/parity.test.ts on why the baseline is
// a snapshot rather than the live plugin file.
const LEGACY_INSTALL = path.join(here, "fixtures", "legacy", "maestro-install.cjs");

const PLUGIN_ROOT = findUpPluginRoot(here)!;

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-install-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A git repo, because the .gitignore step resolves the repo root with `git rev-parse`. */
function makeProject(name: string): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

/**
 * A plugin root the snapshotted installer can run from.
 *
 * It resolves its own root as `path.resolve(__dirname, "..")`, so the snapshot has to sit inside
 * a directory shaped like the plugin. Symlinking the real files (rather than copying) keeps the
 * snapshot the only thing that differs, and keeps it byte-identical to the script it replaced.
 */
function legacyPluginRoot(): string {
  const root = path.join(tmp, "legacy-plugin");
  fs.mkdirSync(path.join(root, "scripts", "lib"), { recursive: true });
  fs.symlinkSync(path.join(PLUGIN_ROOT, "templates"), path.join(root, "templates"));
  for (const rel of ["scripts", path.join("scripts", "lib")]) {
    for (const entry of fs.readdirSync(path.join(PLUGIN_ROOT, rel), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      fs.symlinkSync(path.join(PLUGIN_ROOT, rel, entry.name), path.join(root, rel, entry.name));
    }
  }
  fs.copyFileSync(LEGACY_INSTALL, path.join(root, "scripts", "maestro-install.cjs"));
  return root;
}

/** Every file under `dir`, project-relative, sorted. */
function filesUnder(dir: string, base = dir): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? filesUnder(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]
    )
    .sort();
}

function readSettings(root: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"));
}

/** Every hook command string registered under `event`. */
function commandsFor(settings: Record<string, any>, event: string): string[] {
  return (settings.hooks?.[event] ?? []).flatMap((e: any) => (e.hooks ?? []).map((h: any) => h.command));
}

describe("differential against the legacy installer", () => {
  it("produces the same files, byte for byte, for everything the legacy script wrote", async () => {
    const mine = makeProject("mine");
    const theirs = makeProject("theirs");

    await installRuntime(mine, PLUGIN_ROOT);
    execFileSync("node", [path.join(legacyPluginRoot(), "scripts", "maestro-install.cjs"), theirs], {
      encoding: "utf8",
    });

    // The port copies strictly more (the hook scripts the plugin used to run from its own root),
    // so the legacy tree must be a SUBSET of ours — with identical bytes for every shared file.
    const legacyFiles = filesUnder(path.join(theirs, ".claude")).filter((f) => f !== "settings.json");
    expect(legacyFiles.length).toBeGreaterThan(5);
    for (const rel of legacyFiles) {
      const a = fs.readFileSync(path.join(mine, ".claude", rel));
      const b = fs.readFileSync(path.join(theirs, ".claude", rel));
      expect(a.equals(b), `${rel} differs from the legacy installer's copy`).toBe(true);
    }

    expect(fs.readFileSync(path.join(mine, ".gitignore"), "utf8")).toBe(
      fs.readFileSync(path.join(theirs, ".gitignore"), "utf8")
    );

    // settings.json is where the port deliberately does more. The legacy entry has to survive
    // verbatim: maestro-uninstall.js removes it by exact string match.
    const legacyBashCommands = commandsFor(readSettings(theirs), "PreToolUse");
    expect(legacyBashCommands).toEqual(["$CLAUDE_PROJECT_DIR/.claude/scripts/bash-validation.sh"]);
    expect(commandsFor(readSettings(mine), "PreToolUse")).toContain(legacyBashCommands[0]);
  });

  it("keeps the legacy behaviour of preserving a rendered HANDOFFS table on re-sync", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT);

    const skillPath = path.join(root, ".claude", "skills", "maestro", "SKILL.md");
    const rendered = fs
      .readFileSync(skillPath, "utf8")
      .replace(
        /<!-- Maestro:HANDOFFS:START -->[\s\S]*?<!-- Maestro:HANDOFFS:END -->/,
        "<!-- Maestro:HANDOFFS:START -->\n| default | @backend |\n<!-- Maestro:HANDOFFS:END -->"
      );
    fs.writeFileSync(skillPath, rendered + "\n\n## My own section\n");

    const report = await installRuntime(root, PLUGIN_ROOT);
    const after = fs.readFileSync(skillPath, "utf8");
    expect(report.orchestratorSkill.action).toBe("unchanged");
    expect(after).toContain("| default | @backend |");
    expect(after).toContain("## My own section");
  });

  it("migrates a pre-managed-regions skill and keeps the old body next to it", async () => {
    const root = makeProject("p");
    const skillPath = path.join(root, ".claude", "skills", "maestro", "SKILL.md");
    fs.mkdirSync(path.dirname(skillPath), { recursive: true });
    fs.writeFileSync(skillPath, "# Old orchestrator\n\nHand-written prose, no markers.\n");

    const report = await installRuntime(root, PLUGIN_ROOT);

    expect(report.orchestratorSkill.action).toBe("migrated");
    expect(report.orchestratorSkill.backup).toBe(`${skillPath}.bak`);
    expect(fs.readFileSync(`${skillPath}.bak`, "utf8")).toContain("Hand-written prose");
    expect(fs.readFileSync(skillPath, "utf8")).toContain("Maestro:STEPS:START");
    expect(report.warnings.join(" ")).toContain(".bak");
  });
});

describe("installRuntime", () => {
  it("installs the runtime and registers every hook project-locally", async () => {
    const root = makeProject("p");
    const report = await installRuntime(root, PLUGIN_ROOT);

    expect(report.orchestratorSkill.action).toBe("installed");
    expect(report.scriptsWritten).toEqual(runtimeAssets(PLUGIN_ROOT).map((a) => a.dest));
    expect(report.hooksAdded).toEqual(HOOK_REGISTRATIONS.map((h) => h.id));
    expect(report.unchanged).toBe(false);
    expect(report.status.installed).toBe(true);
    expect(report.status.stale).toBe(false);
    expect(report.status.hooksMissing).toEqual([]);

    // Every registered command must resolve to a file that exists in the project.
    const settings = readSettings(root);
    for (const reg of HOOK_REGISTRATIONS) {
      const commands = commandsFor(settings, reg.event);
      const command = commands.find((c) => c.includes(reg.script));
      expect(command, `${reg.id} not registered`).toBeDefined();
      expect(command).toContain("$CLAUDE_PROJECT_DIR/.claude/scripts/");
      // No ${CLAUDE_PLUGIN_ROOT}: that is the marketplace-cache path this milestone retires.
      expect(command).not.toContain("CLAUDE_PLUGIN_ROOT");
      expect(fs.existsSync(path.join(root, ".claude", "scripts", reg.script))).toBe(true);
    }

    // The .sh hook has to be executable — it is registered as a bare command, not `bash <path>`.
    expect(fs.statSync(path.join(root, ".claude", "scripts", "bash-validation.sh")).mode & 0o111).toBeTruthy();
  });

  it("installs the handoff templates where the injector's fallback looks, not over the user's overrides", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT);

    // `.claude/scripts/../templates/handoffs` is the copied injector's second candidate; the
    // first is `.claude/handoffs`, which stays the user's and must not be written.
    expect(fs.existsSync(path.join(root, ".claude", "templates", "handoffs"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".claude", "handoffs"))).toBe(false);
  });

  it("writes nothing outside the project, including the user's global Claude config", async () => {
    const home = path.join(tmp, "home");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(home, ".claude", "settings.json"), '{\n  "mine": true\n}\n');
    const before = fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8");

    const root = makeProject("p");
    const prevHome = process.env.HOME;
    process.env.HOME = home;
    try {
      await installRuntime(root, PLUGIN_ROOT);
    } finally {
      process.env.HOME = prevHome;
    }

    expect(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8")).toBe(before);
    expect(filesUnder(path.join(home, ".claude"))).toEqual(["settings.json"]);
  });

  it("is idempotent — the second run changes nothing and says so", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT);
    const settingsPath = path.join(root, ".claude", "settings.json");
    const firstSettings = fs.readFileSync(settingsPath, "utf8");
    const firstSkill = fs.readFileSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"), "utf8");

    const second = await installRuntime(root, PLUGIN_ROOT);

    expect(second.unchanged).toBe(true);
    expect(second.scriptsWritten).toEqual([]);
    expect(second.hooksAdded).toEqual([]);
    expect(second.gitignoreUpdated).toBe(false);
    expect(second.orchestratorSkill.action).toBe("unchanged");
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(firstSettings);
    expect(fs.readFileSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"), "utf8")).toBe(firstSkill);
  });

  it("never duplicates a hook entry, even after five runs or a re-quoted command", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT);

    // A user reformats one command by hand. Keying presence on the script basename (not on the
    // exact string) is what stops the next install from adding a second, near-identical entry —
    // the failure that is invisible until the hook fires twice.
    const settingsPath = path.join(root, ".claude", "settings.json");
    const edited = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    edited.hooks.PreToolUse[0].hooks[0].command =
      "node '${CLAUDE_PROJECT_DIR}/.claude/scripts/maestro-session-log.cjs'";
    fs.writeFileSync(settingsPath, JSON.stringify(edited, null, 2));

    for (let i = 0; i < 4; i++) await installRuntime(root, PLUGIN_ROOT);

    const settings = readSettings(root);
    for (const reg of HOOK_REGISTRATIONS) {
      const matching = commandsFor(settings, reg.event).filter((c) => c.includes(reg.script));
      expect(matching, `${reg.id} registered ${matching.length} times`).toHaveLength(1);
    }
    // And the .gitignore section is appended once, not five times.
    const gitignore = fs.readFileSync(path.join(root, ".gitignore"), "utf8");
    expect(gitignore.match(/maestro_session\.log\.jsonl/g)).toHaveLength(1);
  });

  it("preserves settings and hooks the app did not put there", async () => {
    const root = makeProject("p");
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".claude", "settings.json"),
      JSON.stringify(
        {
          model: "opus",
          permissions: { allow: ["Bash(git status)"] },
          hooks: {
            PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "/usr/local/bin/my-guard.sh" }] }],
            SessionEnd: [{ matcher: "", hooks: [{ type: "command", command: "my-cleanup.sh" }] }],
            Notification: [{ matcher: "", hooks: [{ type: "command", command: "say hi" }] }],
          },
        },
        null,
        2
      )
    );

    await installRuntime(root, PLUGIN_ROOT);
    const settings = readSettings(root);

    expect(settings.model).toBe("opus");
    expect(settings.permissions).toEqual({ allow: ["Bash(git status)"] });
    expect(commandsFor(settings, "PreToolUse")).toContain("/usr/local/bin/my-guard.sh");
    expect(commandsFor(settings, "SessionEnd")).toContain("my-cleanup.sh");
    expect(commandsFor(settings, "Notification")).toEqual(["say hi"]);
    // Ours went into the user's existing Bash matcher rather than a competing second entry.
    const bashEntries = settings.hooks.PreToolUse.filter((e: any) => e.matcher === "Bash");
    expect(bashEntries).toHaveLength(1);
    expect(bashEntries[0].hooks.map((h: any) => h.command)).toEqual([
      "/usr/local/bin/my-guard.sh",
      "$CLAUDE_PROJECT_DIR/.claude/scripts/bash-validation.sh",
    ]);
  });

  it("refuses to touch an unparseable settings.json, and leaves the project retryable", async () => {
    const root = makeProject("p");
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    const settingsPath = path.join(root, ".claude", "settings.json");
    fs.writeFileSync(settingsPath, '{ "model": "opus", }  // trailing comma\n');

    await expect(installRuntime(root, PLUGIN_ROOT)).rejects.toThrow(/not valid JSON/);

    // Nothing half-written: the preflight runs before the first copy.
    expect(fs.existsSync(path.join(root, ".claude", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude", "scripts"))).toBe(false);
    expect(fs.readFileSync(settingsPath, "utf8")).toContain("trailing comma");
    expect((await installStatus(root, PLUGIN_ROOT)).settingsUnreadable).toBe(true);

    // Fixing the cause and pressing the button again is all it takes.
    fs.writeFileSync(settingsPath, '{ "model": "opus" }');
    const report = await installRuntime(root, PLUGIN_ROOT);
    expect(report.status.installed).toBe(true);
    expect(readSettings(root).model).toBe("opus");
  });
});

describe("staleness", () => {
  it("reports an uninstalled project as not installed and not stale", async () => {
    const root = makeProject("p");
    const status = await installStatus(root, PLUGIN_ROOT);

    expect(status.installed).toBe(false);
    expect(status.stale).toBe(false);
    expect(status.orchestratorSkill).toBe(false);
    expect(status.hooksMissing).toEqual(HOOK_REGISTRATIONS.map((h) => h.id));
    expect(status.installedRuntimeId).not.toBe(status.shippedRuntimeId);
  });

  it("notices an older runtime by content, and clears once updated", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT);
    expect((await installStatus(root, PLUGIN_ROOT)).stale).toBe(false);

    // What a project that installed an older version of the app looks like.
    const stale = path.join(root, ".claude", "scripts", "maestro-session-log.cjs");
    fs.writeFileSync(stale, "// an older release of this script\n");
    fs.rmSync(path.join(root, ".claude", "scripts", "maestro-task-status.cjs"));

    const before = await installStatus(root, PLUGIN_ROOT);
    expect(before.stale).toBe(true);
    expect(before.scriptsOutOfDate).toEqual([".claude/scripts/maestro-session-log.cjs"]);
    expect(before.scriptsMissing).toEqual([".claude/scripts/maestro-task-status.cjs"]);
    expect(before.installedRuntimeId).not.toBe(before.shippedRuntimeId);

    const report = await installRuntime(root, PLUGIN_ROOT);
    expect(report.scriptsWritten).toEqual([
      ".claude/scripts/maestro-task-status.cjs",
      ".claude/scripts/maestro-session-log.cjs",
    ]);
    expect(report.status.stale).toBe(false);
    expect(report.status.installedRuntimeId).toBe(report.status.shippedRuntimeId);
  });

  it("is decided by content, not by modification times", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT);
    const first = await installStatus(root, PLUGIN_ROOT);

    // A fresh `git clone` rewrites every mtime; two checkouts of one commit must still agree.
    const old = new Date("2001-01-01T00:00:00Z");
    for (const asset of runtimeAssets(PLUGIN_ROOT)) {
      fs.utimesSync(path.join(root, ...asset.dest.split("/")), old, old);
    }

    const second = await installStatus(root, PLUGIN_ROOT);
    expect(second.stale).toBe(false);
    expect(second.installedRuntimeId).toBe(first.installedRuntimeId);
    expect(second.scriptsOutOfDate).toEqual([]);
  });

  it("treats a missing hook registration as stale, and re-registering as the fix", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT);

    const settingsPath = path.join(root, ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    delete settings.hooks.SubagentStop;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    const status = await installStatus(root, PLUGIN_ROOT);
    expect(status.stale).toBe(true);
    expect(status.hooksMissing).toEqual(["SubagentStop:maestro-subagent-log.cjs"]);

    const report = await installRuntime(root, PLUGIN_ROOT);
    expect(report.hooksAdded).toEqual(["SubagentStop:maestro-subagent-log.cjs"]);
    expect(report.status.stale).toBe(false);
  });

  it("treats an orchestrator skill whose managed regions drifted as stale", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT);

    const skillPath = path.join(root, ".claude", "skills", "maestro", "SKILL.md");
    const drifted = fs
      .readFileSync(skillPath, "utf8")
      .replace("<!-- Maestro:PRINCIPLES:START -->", "<!-- Maestro:PRINCIPLES:START -->\nan older principle");
    fs.writeFileSync(skillPath, drifted);

    expect((await installStatus(root, PLUGIN_ROOT)).orchestratorSkillOutOfDate).toBe(true);
    expect((await installStatus(root, PLUGIN_ROOT)).stale).toBe(true);

    const report = await installRuntime(root, PLUGIN_ROOT);
    expect(report.orchestratorSkill.action).toBe("synced");
    expect(report.status.stale).toBe(false);
  });
});

describe("the installed hooks actually run", () => {
  // Not a substitute for running a real session (that is verification step 5 of the plan), but it
  // is the half a test can own: the scripts the commands point at do their job when fed the
  // payload Claude Code would send, from the project copy, with no plugin and no node_modules.
  function runHook(root: string, script: string, payload: unknown): string {
    return execFileSync("node", [path.join(root, ".claude", "scripts", script)], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
  }

  it("logs a tool call, injects agent context, and cleans up at session end", async () => {
    const root = makeProject("p");
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT);

    runHook(root, "maestro-session-log.cjs", {
      cwd: root,
      tool_name: "Read",
      tool_input: { file_path: "src/app.ts" },
    });
    const log = fs.readFileSync(path.join(root, ".claude", "maestro_session.log.jsonl"), "utf8");
    expect(JSON.parse(log.trim())).toMatchObject({ origin: "main_session", log: "Read(src/app.ts)" });

    const injected = runHook(root, "maestro-inject-agent-context.cjs", { cwd: root, agent_type: "backend" });
    expect(injected).toContain("expressjs"); // the backend instance's loaded_skills
    expect(injected).toContain("HANDOFF:");

    runHook(root, "maestro-session-cleanup.cjs", { cwd: root });
    expect(fs.existsSync(path.join(root, ".claude", "maestro_session.log.jsonl"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude", "maestro_session.json"))).toBe(false);
    // The user's config survives a session end — only the ephemeral files go.
    expect(fs.existsSync(path.join(root, ".claude", "maestro.json"))).toBe(true);
  });

  it("copies the hook scripts as .cjs so they survive a `type: module` project", async () => {
    const root = makeProject("p");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "p", type: "module" }, null, 2));
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT);

    // Under `"type": "module"` a copied .js hook would throw "require is not defined in ES module
    // scope" on every single tool call. Nothing but running it from inside the project catches it.
    expect(() =>
      runHook(root, "maestro-session-log.cjs", { cwd: root, tool_name: "Read", tool_input: {} })
    ).not.toThrow();
    expect(fs.existsSync(path.join(root, ".claude", "maestro_session.log.jsonl"))).toBe(true);
  });
});
