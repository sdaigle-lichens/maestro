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
  shippedRuntimeVersion,
  refreshStaleRuntime,
  HOOK_REGISTRATIONS,
} from "../../src/core/install.js";
import { uninstallRuntime } from "../../src/core/uninstall.js";
import { writeConfig, readConfig, writeRuntimeVersion } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
// Snapshotted as .cjs, not .js: this package is "type": "module", so node would refuse to run the
// legacy script's `require`. Verbatim otherwise — see test/parity.test.ts on why the baseline is
// a snapshot rather than the live plugin file.
const LEGACY_INSTALL = path.join(here, "fixtures", "legacy", "maestro-install.cjs");

const PLUGIN_ROOT = findUpPluginRoot(here)!;

let tmp: string;
// Every installRuntime()/refreshStaleRuntime() call below passes this, so the report-sync step
// never touches the REAL ~/.claude/maestro-report-defaults.sqlite on whoever runs the suite —
// same reasoning as real-project.test.ts overriding HOME for its skill-tags read.
let REPORTS_DB: string;
// Same isolation, for the first-install seed's read of the global Project Tags catalog — a
// fresh file per test gets the seeded backend/frontend/mobile default without touching the real
// ~/.claude/maestro-project-tags.sqlite.
let PROJECT_TAGS_DB: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-install-"));
  REPORTS_DB = path.join(tmp, "report-defaults.sqlite");
  PROJECT_TAGS_DB = path.join(tmp, "project-tags.sqlite");
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

    await installRuntime(mine, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
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
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);

    const skillPath = path.join(root, ".claude", "skills", "maestro", "SKILL.md");
    const rendered = fs
      .readFileSync(skillPath, "utf8")
      .replace(
        /<!-- Maestro:HANDOFFS:START -->[\s\S]*?<!-- Maestro:HANDOFFS:END -->/,
        "<!-- Maestro:HANDOFFS:START -->\n| default | @backend |\n<!-- Maestro:HANDOFFS:END -->"
      );
    fs.writeFileSync(skillPath, rendered + "\n\n## My own section\n");

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
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

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);

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
    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);

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
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);

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
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
    } finally {
      process.env.HOME = prevHome;
    }

    expect(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8")).toBe(before);
    expect(filesUnder(path.join(home, ".claude"))).toEqual(["settings.json"]);
  });

  it("is idempotent — the second run changes nothing and says so", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
    const settingsPath = path.join(root, ".claude", "settings.json");
    const firstSettings = fs.readFileSync(settingsPath, "utf8");
    const firstSkill = fs.readFileSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"), "utf8");

    const second = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);

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
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);

    // A user reformats one command by hand. Keying presence on the script basename (not on the
    // exact string) is what stops the next install from adding a second, near-identical entry —
    // the failure that is invisible until the hook fires twice.
    const settingsPath = path.join(root, ".claude", "settings.json");
    const edited = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    edited.hooks.PreToolUse[0].hooks[0].command =
      "node '${CLAUDE_PROJECT_DIR}/.claude/scripts/maestro-session-log.cjs'";
    fs.writeFileSync(settingsPath, JSON.stringify(edited, null, 2));

    for (let i = 0; i < 4; i++) await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);

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

    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
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

    await expect(installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB)).rejects.toThrow(/not valid JSON/);

    // Nothing half-written: the preflight runs before the first copy.
    expect(fs.existsSync(path.join(root, ".claude", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude", "scripts"))).toBe(false);
    expect(fs.readFileSync(settingsPath, "utf8")).toContain("trailing comma");
    expect((await installStatus(root, PLUGIN_ROOT)).settingsUnreadable).toBe(true);

    // Fixing the cause and pressing the button again is all it takes.
    fs.writeFileSync(settingsPath, '{ "model": "opus" }');
    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
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
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
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

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
    expect(report.scriptsWritten).toEqual([
      ".claude/scripts/maestro-task-status.cjs",
      ".claude/scripts/maestro-session-log.cjs",
    ]);
    expect(report.status.stale).toBe(false);
    expect(report.status.installedRuntimeId).toBe(report.status.shippedRuntimeId);
  });

  it("is decided by content, not by modification times", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
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
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);

    const settingsPath = path.join(root, ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    delete settings.hooks.SubagentStop;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    const status = await installStatus(root, PLUGIN_ROOT);
    expect(status.stale).toBe(true);
    expect(status.hooksMissing).toEqual(["SubagentStop:maestro-subagent-log.cjs"]);

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
    expect(report.hooksAdded).toEqual(["SubagentStop:maestro-subagent-log.cjs"]);
    expect(report.status.stale).toBe(false);
  });

  it("treats an orchestrator skill whose managed regions drifted as stale", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);

    const skillPath = path.join(root, ".claude", "skills", "maestro", "SKILL.md");
    const drifted = fs
      .readFileSync(skillPath, "utf8")
      .replace("<!-- Maestro:PRINCIPLES:START -->", "<!-- Maestro:PRINCIPLES:START -->\nan older principle");
    fs.writeFileSync(skillPath, drifted);

    expect((await installStatus(root, PLUGIN_ROOT)).orchestratorSkillOutOfDate).toBe(true);
    expect((await installStatus(root, PLUGIN_ROOT)).stale).toBe(true);

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
    expect(report.orchestratorSkill.action).toBe("synced");
    expect(report.status.stale).toBe(false);
  });
});

describe("runtimeVersion (task 027)", () => {
  it("shippedRuntimeVersion reads the plugin's own plugin.json version", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json"), "utf8"));
    expect(shippedRuntimeVersion(PLUGIN_ROOT)).toBe(manifest.version);
  });

  it("writeRuntimeVersion no-ops when maestro.json doesn't exist yet", () => {
    const root = makeProject("p");
    expect(writeRuntimeVersion(root, "9.9.9")).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude", "maestro.json"))).toBe(false);
  });

  it("writeRuntimeVersion stamps the field and leaves the rest of the config untouched", () => {
    const root = makeProject("p");
    writeConfig(root, defaultish);
    const before = readConfig(root)!;

    expect(writeRuntimeVersion(root, "1.2.3")).toBe(true);
    const after = readConfig(root)!;
    expect(after.runtimeVersion).toBe("1.2.3");
    // Everything else — the authored graph — is byte-identical to before the stamp.
    expect({ ...after, runtimeVersion: undefined }).toEqual({ ...before, runtimeVersion: undefined });

    // A second stamp with the same version writes nothing further.
    expect(writeRuntimeVersion(root, "1.2.3")).toBe(false);
  });

  it("installRuntime stamps runtimeVersion when maestro.json already exists", async () => {
    const root = makeProject("p");
    writeConfig(root, defaultish);

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
    expect(report.runtimeVersion).toBe(shippedRuntimeVersion(PLUGIN_ROOT));
    expect(report.runtimeVersionUpdated).toBe(true);
    expect(readConfig(root)!.runtimeVersion).toBe(shippedRuntimeVersion(PLUGIN_ROOT));

    // Re-running with the version already stamped writes nothing further and reports so.
    const second = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
    expect(second.runtimeVersionUpdated).toBe(false);
    expect(second.unchanged).toBe(true);
  });

  it("a first install seeds maestro.json itself, so there is always one to stamp", async () => {
    const root = makeProject("p");
    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
    expect(report.runtimeVersionUpdated).toBe(true);
    expect(fs.existsSync(path.join(root, ".claude", "maestro.json"))).toBe(true);
    expect(readConfig(root)!.runtimeVersion).toBe(shippedRuntimeVersion(PLUGIN_ROOT));
  });

  describe("refreshStaleRuntime", () => {
    it("returns null when there is no maestro.json at all", async () => {
      const root = makeProject("p");
      expect(await refreshStaleRuntime(root, PLUGIN_ROOT, REPORTS_DB)).toBeNull();
    });

    it("returns null and writes nothing when the stamped version already matches", async () => {
      const root = makeProject("p");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
      const settingsBefore = fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8");

      expect(await refreshStaleRuntime(root, PLUGIN_ROOT, REPORTS_DB)).toBeNull();
      expect(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8")).toBe(settingsBefore);
    });

    it("never touches a corrupt or non-v3 maestro.json — it's not readConfig()'s blank fallback", async () => {
      const root = makeProject("p");
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB); // an installed runtime, so `installed` alone can't gate it
      const configPath = path.join(root, ".claude", "maestro.json");
      fs.writeFileSync(configPath, '{ "not": "valid json", ');
      const before = fs.readFileSync(configPath, "utf8");

      expect(await refreshStaleRuntime(root, PLUGIN_ROOT, REPORTS_DB)).toBeNull();
      expect(fs.readFileSync(configPath, "utf8")).toBe(before);
    });

    it("never installs fresh — a config with a stale/missing version but no runtime installed is left alone", async () => {
      const root = makeProject("p");
      writeConfig(root, { ...defaultish, runtimeVersion: "0.0.0-nonexistent" });

      expect(await refreshStaleRuntime(root, PLUGIN_ROOT, REPORTS_DB)).toBeNull();
      expect(fs.existsSync(path.join(root, ".claude", "scripts"))).toBe(false);
    });

    it("refreshes an already-installed project whose stamped version is stale", async () => {
      const root = makeProject("p");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
      // Simulate what a project installed before this feature — or under an older plugin version —
      // looks like: the runtime is present, but the stamp doesn't match what's shipped now.
      writeConfig(root, { ...readConfig(root)!, runtimeVersion: "0.0.0-older" });
      fs.writeFileSync(
        path.join(root, ".claude", "scripts", "maestro-session-log.cjs"),
        "// stale content from an older release\n"
      );

      const report = await refreshStaleRuntime(root, PLUGIN_ROOT, REPORTS_DB);
      expect(report).not.toBeNull();
      expect(report!.runtimeVersionUpdated).toBe(true);
      expect(report!.runtimeVersion).toBe(shippedRuntimeVersion(PLUGIN_ROOT));
      expect(report!.scriptsWritten).toContain(".claude/scripts/maestro-session-log.cjs");
      expect(readConfig(root)!.runtimeVersion).toBe(shippedRuntimeVersion(PLUGIN_ROOT));
      // The authored graph is provably unchanged by the refresh — runtimeVersion differs, and
      // `reports` gains entries for every agent in `agents_available` that has a global default
      // (the report sync step's own materialize-if-absent behavior), never touching anything else.
      expect({ ...readConfig(root)!, runtimeVersion: undefined, reports: undefined }).toEqual({
        ...defaultish,
        runtimeVersion: undefined,
        reports: undefined,
      });
      // Already materialized by the FIRST installRuntime() call above (line 504) — this refresh
      // finds them unmodified since that sync and current, so nothing changes a second time.
      expect(report!.reportsSync.unchanged.sort()).toEqual(["backend", "scribe", "test"]);
    });
  });
});

describe("first-install config seeding (project tags)", () => {
  it("seeds maestro.json immediately, with project_tags matched from repo detection", async () => {
    const root = makeProject("p");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { express: "^4" } }));

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
    expect(report.configSeeded).toEqual({ implAgents: ["backend"], projectTags: ["backend"] });

    const cfg = readConfig(root)!;
    expect(cfg.agents_available).toContain("backend");
    expect(cfg.project_tags).toEqual(["backend"]);
  });

  it("never re-seeds or touches project_tags when maestro.json already exists", async () => {
    const root = makeProject("p");
    writeConfig(root, { ...defaultish, project_tags: ["frontend"] });

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
    expect(report.configSeeded).toBeNull();
    expect(readConfig(root)!.project_tags).toEqual(["frontend"]);
  });

  it("only records project_tags for catalog entries — a detected agent absent from the catalog is dropped", async () => {
    const root = makeProject("p");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { expo: "^50" } }));
    const narrowedCatalogDb = path.join(tmp, "narrowed-catalog.sqlite");
    const { removeProjectTag } = await import("../../src/core/project-tags.js");
    // Removing just "mobile" (leaving backend/frontend) doesn't trigger the store's
    // seed-when-empty fallback — that only fires when the WHOLE catalog is emptied.
    removeProjectTag("mobile", narrowedCatalogDb);

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, narrowedCatalogDb);
    expect(report.configSeeded).toEqual({ implAgents: ["mobile"], projectTags: [] });
    expect(readConfig(root)!.project_tags).toEqual([]);
  });
});

// The orchestrator's Step 0 reads two fields and nothing else: `action`, one of three values naming
// exactly one command (`continue` / `/maestro-update` / `/maestro-install`), and `instruction`, the
// sentence it obeys. Both live here rather than in the SKILL.md: there are more states than
// behaviours, and prose that re-derives the mapping is re-read at the top of every orchestration —
// paid for on every healthy run too. So every case below asserts the ACTION, not just the state it
// was derived from, and one case pins the wording that travels with it.
describe("maestro-check-runtime.cjs", () => {
  function runCheck(root: string, home: string): { code: number; stdout: string } {
    try {
      const stdout = execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-check-runtime.cjs")], {
        encoding: "utf8",
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: home },
      });
      return { code: 0, stdout };
    } catch (e: any) {
      return { code: e.status, stdout: e.stdout };
    }
  }

  function writeInstalledPlugins(home: string, plugins: Record<string, unknown[]>): void {
    const dir = path.join(home, ".claude", "plugins");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "installed_plugins.json"), JSON.stringify({ version: 1, plugins }, null, 2));
  }

  /** A project that is fully set up and current — the baseline every case below breaks one way. */
  async function healthyProject(name: string): Promise<{ root: string; home: string }> {
    const root = makeProject(name);
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
    execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root]);
    const home = path.join(tmp, "home-" + name);
    writeInstalledPlugins(home, {
      "maestro@maestro": [
        {
          scope: "user",
          version: readConfig(root)!.runtimeVersion!,
          installedAt: "2026-01-01T00:00:00.000Z",
          installPath: "/some/cache/path/maestro",
        },
      ],
    });
    return { root, home };
  }

  it("continues when the project is configured, rendered and current", async () => {
    const { root, home } = await healthyProject("healthy");
    const { code, stdout } = runCheck(root, home);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ action: "continue", ok: true, stale: false });
  });

  // Step 0 does what `instruction` says without consulting a table, so an action that arrives
  // without its sentence — or with someone else's — is the whole contract broken.
  it("carries the one instruction that matches its action", async () => {
    const { root, home } = await healthyProject("instructions");
    const seen = new Map<string, string>();
    const record = (r: string, h: string) => {
      const { action, instruction } = JSON.parse(runCheck(r, h).stdout);
      expect(instruction, `no instruction for action "${action}"`).toBeTypeOf("string");
      const prior = seen.get(action);
      if (prior !== undefined) expect(instruction).toBe(prior); // one wording per action, always
      seen.set(action, instruction);
    };
    record(root, home); // continue
    writeConfig(root, { ...readConfig(root)!, runtimeVersion: "0.0.0-older" });
    record(root, home); // update
    fs.rmSync(path.join(root, ".claude", "maestro.json"));
    record(root, home); // install

    expect([...seen.keys()].sort()).toEqual(["continue", "install", "update"]);
    expect(seen.get("continue")).toContain("Carry on");
    expect(seen.get("update")).toContain("/maestro-update");
    expect(seen.get("install")).toContain("/maestro-install");
    expect(seen.get("install")).toContain("Stop");
  });

  it("says install when maestro.json is absent", async () => {
    const { root, home } = await healthyProject("no-config");
    fs.rmSync(path.join(root, ".claude", "maestro.json"));
    const { code, stdout } = runCheck(root, home);
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ action: "install" });
  });

  // installRuntime copies the orchestrator template, whose HANDOFFS region is still the
  // placeholder; /maestro-install runs the renderer as a separate step afterwards. A project
  // caught between the two is genuinely not ready, and this is the state that says so.
  it("says update when the runtime was installed but never rendered", async () => {
    const root = makeProject("unrendered");
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
    expect(JSON.parse(runCheck(root, path.join(tmp, "home-unrendered")).stdout)).toMatchObject({
      action: "update",
      reason: "the handoff table no longer matches maestro.json",
    });
  });

  // A config with no workflows renders the handoff table to its "not configured yet" placeholder,
  // so the orchestrator would read that, find no success path, and start improvising. Catching it
  // here is the difference between one actionable line and a confused conversation.
  it("says install when maestro.json configures no workflows", async () => {
    const { root, home } = await healthyProject("empty-wf");
    writeConfig(root, { ...readConfig(root)!, workflows: [] });
    expect(JSON.parse(runCheck(root, home).stdout)).toMatchObject({
      action: "install",
      reason: "maestro.json configures no workflows",
    });
  });

  it("says install when the orchestrator skill was never written", async () => {
    const { root, home } = await healthyProject("no-skill");
    fs.rmSync(path.join(root, ".claude", "skills", "maestro"), { recursive: true, force: true });
    expect(JSON.parse(runCheck(root, home).stdout)).toMatchObject({ action: "install" });
  });

  // The check nothing else in the system performs. A hand-edited maestro.json whose table was
  // never re-rendered routes work down a path that is not the configured one — silently, and for
  // as long as nobody notices. `handoffTable()` is imported from the renderer, so this comparison
  // cannot drift from what a real re-render would produce.
  it("says update when the handoff table no longer matches maestro.json", async () => {
    const { root, home } = await healthyProject("drift");
    const cfg = readConfig(root)!;
    writeConfig(root, {
      ...cfg,
      workflows: cfg.workflows.map((w, i) => (i === 0 ? { ...w, name: w.name + "-renamed" } : w)),
    });
    expect(JSON.parse(runCheck(root, home).stdout)).toMatchObject({
      action: "update",
      reason: "the handoff table no longer matches maestro.json",
    });
  });

  it("says update when the installed plugin's version doesn't match runtimeVersion", async () => {
    const { root, home } = await healthyProject("stale");
    writeConfig(root, { ...readConfig(root)!, runtimeVersion: "0.0.0-older" });
    expect(JSON.parse(runCheck(root, home).stdout)).toMatchObject({
      action: "update",
      ok: true,
      stale: true,
      installedVersion: "0.0.0-older",
      pluginRoot: "/some/cache/path/maestro",
    });
  });

  // The one branch that must NOT block: an unanswerable version comparison is ordinary (a
  // project-local-only setup, or the app-only delivery path) and has nothing to do with whether
  // this project can orchestrate. Everything the project itself controls has already passed.
  it("continues when the maestro plugin isn't installed on this machine", async () => {
    const { root } = await healthyProject("no-plugin");
    const home = path.join(tmp, "home-bare");
    fs.mkdirSync(home, { recursive: true }); // no plugins/installed_plugins.json at all
    expect(JSON.parse(runCheck(root, home).stdout)).toMatchObject({ action: "continue", ok: false, stale: false });
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
      // HOME pointed at this test's own tmp dir: maestro-inject-agent-context.cjs now reads
      // ~/.claude/maestro-report-defaults.sqlite (report-defaults.ts) unconditionally on every
      // invocation, and without this override that's the DEVELOPER's real one — same reasoning as
      // real-project.test.ts's HOME override for its skill-tags read.
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp },
    });
  }

  it("logs a tool call, injects agent context, and cleans up at session end", async () => {
    const root = makeProject("p");
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);

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

  // The other half of "the installed hooks actually run": what the PLUGIN's copy of the same hook
  // does while the project is running its own. Both used to fire — every tool call logged twice —
  // and this runs the plugin's real script, from the real plugins/maestro/scripts/, to show it
  // does not any more.
  function runPluginHook(root: string, script: string, payload: unknown): string {
    return execFileSync("node", [path.join(PLUGIN_ROOT, "scripts", script)], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp },
    });
  }

  const logPath = (root: string) => path.join(root, ".claude", "maestro_session.log.jsonl");
  const readPayload = (root: string) => ({
    cwd: root,
    hook_event_name: "PreToolUse",
    tool_name: "Read",
    tool_input: { file_path: "src/app.ts" },
  });

  it("stands the plugin's copy down for a hook the project registers itself", async () => {
    const root = makeProject("p");
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);

    runPluginHook(root, "maestro-session-log.js", readPayload(root));
    expect(fs.existsSync(logPath(root))).toBe(false);

    // ...and the project's own copy of that same hook still logs the call, exactly once.
    runHook(root, "maestro-session-log.cjs", readPayload(root));
    expect(fs.readFileSync(logPath(root), "utf8").trim().split("\n")).toHaveLength(1);
  });

  it("keeps the plugin's copy running for a Maestro project with no local install", async () => {
    // The plugin-global path, untouched: a maestro.json and no registrations of its own.
    const root = makeProject("p");
    writeConfig(root, defaultish);

    runPluginHook(root, "maestro-session-log.js", readPayload(root));
    expect(fs.existsSync(logPath(root))).toBe(true);
  });

  it("hands the work back to the plugin after a non-purging uninstall", async () => {
    // Plain uninstall removes the registrations and LEAVES .claude/scripts/ on disk. A guard that
    // keyed on the twin file would suppress the plugin here in favour of hooks nobody runs, which
    // is Maestro off rather than Maestro falling back.
    const root = makeProject("p");
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);
    await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT });

    expect(fs.existsSync(path.join(root, ".claude", "scripts", "maestro-session-log.cjs"))).toBe(true);
    runPluginHook(root, "maestro-session-log.js", readPayload(root));
    expect(fs.existsSync(logPath(root))).toBe(true);
  });

  it("stands down the plugin's SubagentStart injection, so context is injected once", async () => {
    const root = makeProject("p");
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);

    const payload = { cwd: root, hook_event_name: "SubagentStart", agent_type: "backend" };
    expect(runPluginHook(root, "maestro-inject-agent-context.js", payload)).toBe("");
    expect(runHook(root, "maestro-inject-agent-context.cjs", payload)).toContain("HANDOFF:");
  });

  it("copies the hook scripts as .cjs so they survive a `type: module` project", async () => {
    const root = makeProject("p");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "p", type: "module" }, null, 2));
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB);

    // Under `"type": "module"` a copied .js hook would throw "require is not defined in ES module
    // scope" on every single tool call. Nothing but running it from inside the project catches it.
    expect(() =>
      runHook(root, "maestro-session-log.cjs", { cwd: root, tool_name: "Read", tool_input: {} })
    ).not.toThrow();
    expect(fs.existsSync(path.join(root, ".claude", "maestro_session.log.jsonl"))).toBe(true);
  });
});
