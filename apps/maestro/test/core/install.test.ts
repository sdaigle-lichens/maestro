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
import { execFileSync, spawnSync } from "node:child_process";
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
import { writeAgentReportDefault } from "../../src/core/report-defaults.js";
import { renderOrchestrator } from "../../src/core/render.js";
import { defaultish, withSkillNodes } from "./fixtures/configs.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";
import { SEED_HANDOFFS } from "../../src/core/handoff-seeds.js";

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
// And the same again for `033`'s handoff sync, which reads
// ~/.claude/maestro-handoff-defaults.sqlite. Every installRuntime()/refreshStaleRuntime() call
// below passes it — a missed one materializes `.claude/handoffs/**` from whatever the machine
// running the suite happens to have edited.
let HANDOFFS_DB: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-install-"));
  REPORTS_DB = path.join(tmp, "report-defaults.sqlite");
  PROJECT_TAGS_DB = path.join(tmp, "project-tags.sqlite");
  HANDOFFS_DB = path.join(tmp, "handoff-defaults.sqlite");
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

    await installRuntime(mine, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
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

    // `036` added a channels glob and reworded the header (not everything under it is removed at
    // SessionEnd any more), so ours no longer matches the frozen legacy snapshot byte for byte —
    // same "legacy is a SUBSET of ours" rule as the file tree above, applied to gitignore lines.
    const legacyGitignoreLines = fs
      .readFileSync(path.join(theirs, ".gitignore"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l && l !== "# Maestro ephemeral session state — recreated each session, removed at SessionEnd");
    const mineGitignore = fs.readFileSync(path.join(mine, ".gitignore"), "utf8");
    for (const line of legacyGitignoreLines) {
      expect(mineGitignore, `${line} missing from ours`).toContain(line);
    }
    expect(mineGitignore).toContain("**/.claude/channels/");

    // settings.json is where the port deliberately does more. The legacy entry has to survive
    // verbatim: maestro-uninstall.js removes it by exact string match.
    const legacyBashCommands = commandsFor(readSettings(theirs), "PreToolUse");
    expect(legacyBashCommands).toEqual(["$CLAUDE_PROJECT_DIR/.claude/scripts/bash-validation.sh"]);
    expect(commandsFor(readSettings(mine), "PreToolUse")).toContain(legacyBashCommands[0]);
  });

  it("keeps the legacy behaviour of preserving a rendered HANDOFFS table on re-sync", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

    const skillPath = path.join(root, ".claude", "skills", "maestro", "SKILL.md");
    const rendered = fs
      .readFileSync(skillPath, "utf8")
      .replace(
        /<!-- Maestro:HANDOFFS:START -->[\s\S]*?<!-- Maestro:HANDOFFS:END -->/,
        "<!-- Maestro:HANDOFFS:START -->\n| default | @backend |\n<!-- Maestro:HANDOFFS:END -->"
      );
    fs.writeFileSync(skillPath, rendered + "\n\n## My own section\n");

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
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

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

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
    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

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

  // `041` — the collision the canvas refuses to create can still reach an install through a
  // hand-edited maestro.json. Reported beside the sync summaries, never repaired, and never a
  // reason to fail the install.
  it("reports a duplicate-agent-type collision without failing the install", async () => {
    const root = makeProject("p");
    const collision: MaestroConfigV3 = {
      ...defaultish,
      workflow_instances: [
        ...defaultish.workflow_instances,
        { name: "backend-2", agent: "backend", loaded_skills: [], referenced_skills: [] },
      ],
      workflows: [
        {
          ...defaultish.workflows[0],
          nodes: [...defaultish.workflows[0].nodes, { id: "backend-2", type: "agent", instance: "backend-2" }],
          edges: [...defaultish.workflows[0].edges, { from: "main-session", to: "backend-2", kind: "success" }],
        },
      ],
    };
    writeConfig(root, collision);
    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

    expect(report.configIssues).toHaveLength(1);
    expect(report.configIssues[0].workflow).toBe("default");
    expect(report.configIssues[0].detail).toContain("backend-2");
  });

  it("reports no config issues for a healthy config", async () => {
    const root = makeProject("p");
    writeConfig(root, defaultish);
    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    expect(report.configIssues).toEqual([]);
  });

  it("installs no handoff templates as ASSETS any more — the sync materializes them instead", async () => {
    const root = makeProject("p");
    writeConfig(root, defaultish);
    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

    // The install-managed fallback is gone (`033`): a directory every install blind-overwrites
    // cannot hold an opinion, which is the whole failure this slice removes.
    expect(fs.existsSync(path.join(root, ".claude", "templates", "handoffs"))).toBe(false);
    expect(runtimeAssets(PLUGIN_ROOT).some((a) => a.dest.includes("templates/handoffs"))).toBe(false);

    // What replaced it: `.claude/handoffs/<sender>/<receiver>.md` for the routes the workflows
    // actually wire, tracked in the config so a later edit is never clobbered.
    expect(report.handoffsSync.materialized.length).toBeGreaterThan(0);
    for (const id of report.handoffsSync.materialized) {
      const [sender, receiver] = id.split("/");
      expect(fs.existsSync(path.join(root, ".claude", "handoffs", sender, `${receiver}.md`))).toBe(true);
      expect(readConfig(root)!.handoffs![id].syncedFrom).toBeDefined();
    }
  });

  // `035`. THE MANIFEST IS A DEPENDENCY LIST, AND IT FAILS SILENTLY WHEN IT IS WRONG. A copied
  // script that `require`s a lib the manifest never copies throws MODULE_NOT_FOUND from inside
  // `.claude/scripts/` — and every such require in a hook is wrapped in a try/catch (for a `node`
  // older than 22.5, which has no `node:sqlite`), so the catch swallows it and the tier that
  // require backed just stops existing. Nothing logs, nothing fails, and the plugin's own copy of
  // the same hook — which has the whole `lib/` beside it in the marketplace cache — goes on
  // answering, so the arbitration winner decides what an agent is told. That is how
  // `lib/maestro-report-defaults.cjs` was missing from this list for two releases.
  //
  // Static, not a spawn: the failing branch is behind a `node:sqlite` version check and a caught
  // exception, so no run of the hook can be trusted to reach it.
  it("copies every lib a copied script requires, including the ones inside a try/catch", () => {
    const assets = runtimeAssets(PLUGIN_ROOT);
    const copied = new Set(assets.map((a) => a.dest));
    const found: string[] = [];

    for (const asset of assets) {
      if (!asset.src.endsWith(".js") && !asset.src.endsWith(".cjs")) continue;
      const text = fs.readFileSync(path.join(PLUGIN_ROOT, ...asset.src.split("/")), "utf8");
      // Relative requires only: a bare specifier is a node builtin here (these scripts run with no
      // node_modules), and an absolute one does not exist in either tree.
      for (const m of text.matchAll(/require\(\s*["'](\.[^"']+)["']\s*\)/g)) {
        // Resolve against the DESTINATION, which is what the copied script's `require` resolves
        // against — the `.js` → `.cjs` rename moves nothing sideways, but the check is about the
        // copied layout, not the plugin's.
        const dest = path.posix.normalize(path.posix.join(path.posix.dirname(asset.dest), m[1]));
        found.push(dest);
        expect(copied.has(dest), `${asset.dest} requires ${m[1]}, which no STATIC_ASSET copies`).toBe(true);
      }
    }

    // The audit ran against something. Both sqlite tiers are named explicitly because they are the
    // two the scan is here to keep: they are the only requires reachable from a hook that a
    // try/catch can hide, and a future refactor that drops them would otherwise leave this test
    // passing over a smaller graph.
    expect(found.length).toBeGreaterThan(5);
    expect(found).toContain(".claude/scripts/lib/maestro-report-defaults.cjs");
    expect(found).toContain(".claude/scripts/lib/maestro-handoff-defaults.cjs");
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
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    } finally {
      process.env.HOME = prevHome;
    }

    expect(fs.readFileSync(path.join(home, ".claude", "settings.json"), "utf8")).toBe(before);
    expect(filesUnder(path.join(home, ".claude"))).toEqual(["settings.json"]);
  });

  it("is idempotent — the second run changes nothing and says so", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    const settingsPath = path.join(root, ".claude", "settings.json");
    const firstSettings = fs.readFileSync(settingsPath, "utf8");
    const firstSkill = fs.readFileSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"), "utf8");

    const second = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

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
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

    // A user reformats one command by hand. Keying presence on the script basename (not on the
    // exact string) is what stops the next install from adding a second, near-identical entry —
    // the failure that is invisible until the hook fires twice.
    const settingsPath = path.join(root, ".claude", "settings.json");
    const edited = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    // Found by what it points at, never by index: PreToolUse carries several of our entries and
    // the order they are written in is not a promise this test should be making.
    const logHook = edited.hooks.PreToolUse.flatMap((e: any) => e.hooks).find((h: any) =>
      h.command.includes("maestro-session-log.cjs")
    );
    logHook.command = "node '${CLAUDE_PROJECT_DIR}/.claude/scripts/maestro-session-log.cjs'";
    fs.writeFileSync(settingsPath, JSON.stringify(edited, null, 2));

    for (let i = 0; i < 4; i++) await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

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

    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
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

    await expect(installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB)).rejects.toThrow(
      /not valid JSON/
    );

    // Nothing half-written: the preflight runs before the first copy.
    expect(fs.existsSync(path.join(root, ".claude", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude", "scripts"))).toBe(false);
    expect(fs.readFileSync(settingsPath, "utf8")).toContain("trailing comma");
    expect((await installStatus(root, PLUGIN_ROOT)).settingsUnreadable).toBe(true);

    // Fixing the cause and pressing the button again is all it takes.
    fs.writeFileSync(settingsPath, '{ "model": "opus" }');
    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
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
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
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

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    expect(report.scriptsWritten).toEqual([
      ".claude/scripts/maestro-task-status.cjs",
      ".claude/scripts/maestro-session-log.cjs",
    ]);
    expect(report.status.stale).toBe(false);
    expect(report.status.installedRuntimeId).toBe(report.status.shippedRuntimeId);
  });

  it("is decided by content, not by modification times", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
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
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

    const settingsPath = path.join(root, ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    delete settings.hooks.SubagentStop;
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    const status = await installStatus(root, PLUGIN_ROOT);
    expect(status.stale).toBe(true);
    expect(status.hooksMissing).toEqual(["SubagentStop:maestro-subagent-log.cjs"]);

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    expect(report.hooksAdded).toEqual(["SubagentStop:maestro-subagent-log.cjs"]);
    expect(report.status.stale).toBe(false);
  });

  it("treats an orchestrator skill whose managed regions drifted as stale", async () => {
    const root = makeProject("p");
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

    const skillPath = path.join(root, ".claude", "skills", "maestro", "SKILL.md");
    const drifted = fs
      .readFileSync(skillPath, "utf8")
      .replace("<!-- Maestro:PRINCIPLES:START -->", "<!-- Maestro:PRINCIPLES:START -->\nan older principle");
    fs.writeFileSync(skillPath, drifted);

    expect((await installStatus(root, PLUGIN_ROOT)).orchestratorSkillOutOfDate).toBe(true);
    expect((await installStatus(root, PLUGIN_ROOT)).stale).toBe(true);

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
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

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    expect(report.runtimeVersion).toBe(shippedRuntimeVersion(PLUGIN_ROOT));
    expect(report.runtimeVersionUpdated).toBe(true);
    expect(readConfig(root)!.runtimeVersion).toBe(shippedRuntimeVersion(PLUGIN_ROOT));

    // Re-running with the version already stamped writes nothing further and reports so.
    const second = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    expect(second.runtimeVersionUpdated).toBe(false);
    expect(second.unchanged).toBe(true);
  });

  it("a first install seeds maestro.json itself, so there is always one to stamp", async () => {
    const root = makeProject("p");
    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    expect(report.runtimeVersionUpdated).toBe(true);
    expect(fs.existsSync(path.join(root, ".claude", "maestro.json"))).toBe(true);
    expect(readConfig(root)!.runtimeVersion).toBe(shippedRuntimeVersion(PLUGIN_ROOT));
  });

  describe("refreshStaleRuntime", () => {
    it("returns null when there is no maestro.json at all", async () => {
      const root = makeProject("p");
      expect(await refreshStaleRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB)).toBeNull();
    });

    it("returns null and writes nothing when the stamped version already matches", async () => {
      const root = makeProject("p");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
      const settingsBefore = fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8");

      expect(await refreshStaleRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB)).toBeNull();
      expect(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8")).toBe(settingsBefore);
    });

    it("never touches a corrupt or non-v3 maestro.json — it's not readConfig()'s blank fallback", async () => {
      const root = makeProject("p");
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB); // an installed runtime, so `installed` alone can't gate it
      const configPath = path.join(root, ".claude", "maestro.json");
      fs.writeFileSync(configPath, '{ "not": "valid json", ');
      const before = fs.readFileSync(configPath, "utf8");

      expect(await refreshStaleRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB)).toBeNull();
      expect(fs.readFileSync(configPath, "utf8")).toBe(before);
    });

    it("never installs fresh — a config with a stale/missing version but no runtime installed is left alone", async () => {
      const root = makeProject("p");
      writeConfig(root, { ...defaultish, runtimeVersion: "0.0.0-nonexistent" });

      expect(await refreshStaleRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB)).toBeNull();
      expect(fs.existsSync(path.join(root, ".claude", "scripts"))).toBe(false);
    });

    it("refreshes an already-installed project whose stamped version is stale", async () => {
      const root = makeProject("p");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
      // Simulate what a project installed before this feature — or under an older plugin version —
      // looks like: the runtime is present, but the stamp doesn't match what's shipped now.
      writeConfig(root, { ...readConfig(root)!, runtimeVersion: "0.0.0-older" });
      fs.writeFileSync(
        path.join(root, ".claude", "scripts", "maestro-session-log.cjs"),
        "// stale content from an older release\n"
      );

      const report = await refreshStaleRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
      expect(report).not.toBeNull();
      expect(report!.runtimeVersionUpdated).toBe(true);
      expect(report!.runtimeVersion).toBe(shippedRuntimeVersion(PLUGIN_ROOT));
      expect(report!.scriptsWritten).toContain(".claude/scripts/maestro-session-log.cjs");
      expect(readConfig(root)!.runtimeVersion).toBe(shippedRuntimeVersion(PLUGIN_ROOT));
      // The authored graph is provably unchanged by the refresh — runtimeVersion differs,
      // `reports` gains entries for every agent in `agents_available` that has a global default
      // and `handoffs` one per wired route (each sync step's own materialize-if-absent behavior),
      // never touching anything else.
      expect({
        ...readConfig(root)!,
        runtimeVersion: undefined,
        reports: undefined,
        handoffs: undefined,
      }).toEqual({
        ...defaultish,
        runtimeVersion: undefined,
        reports: undefined,
        handoffs: undefined,
      });
      // Already materialized by the FIRST installRuntime() call above (line 504) — this refresh
      // finds them unmodified since that sync and current, so nothing changes a second time.
      expect(report!.reportsSync.unchanged.sort()).toEqual(["backend", "scribe", "test"]);
    });
  });
});

// `033` — the app's installRuntime() and the plugin's maestro-install.js are two implementations
// of the handoff sync, so this proves them equal against a real fixture rather than asserting it
// in a comment. Both are pointed at ONE fake HOME so they read the same freshly-seeded global
// store: the plugin script is a CLI with no db-path override, so isolating it means isolating its
// whole `~/.claude`.
describe("handoff sync parity between the app and the plugin's installer (033)", () => {
  it("materializes the same files, byte for byte, and writes the same handoffs slice", async () => {
    const home = path.join(tmp, "parity-home");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    const sharedDb = path.join(home, ".claude", "maestro-handoff-defaults.sqlite");

    const mine = makeProject("mine-handoffs");
    const theirs = makeProject("theirs-handoffs");
    writeConfig(mine, defaultish);
    writeConfig(theirs, defaultish);

    await installRuntime(mine, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, sharedDb);
    execFileSync("node", [path.join(PLUGIN_ROOT, "scripts", "maestro-install.js"), theirs], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });

    const mineFiles = filesUnder(path.join(mine, ".claude", "handoffs"));
    expect(mineFiles.sort()).toEqual(["backend/test.md", "test/backend.md"]);
    expect(filesUnder(path.join(theirs, ".claude", "handoffs")).sort()).toEqual(mineFiles.sort());
    for (const rel of mineFiles) {
      const a = fs.readFileSync(path.join(mine, ".claude", "handoffs", rel));
      const b = fs.readFileSync(path.join(theirs, ".claude", "handoffs", rel));
      expect(a.equals(b), `${rel} differs between the two installers`).toBe(true);
    }

    expect(readConfig(theirs)!.handoffs).toEqual(readConfig(mine)!.handoffs);
    expect(Object.keys(readConfig(mine)!.handoffs!).sort()).toEqual(["backend/test", "test/backend"]);
  });

  it("both leave a hand-edit alone on a re-run, and neither writes .claude/templates/handoffs", async () => {
    const home = path.join(tmp, "parity-home-2");
    fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
    const sharedDb = path.join(home, ".claude", "maestro-handoff-defaults.sqlite");

    const mine = makeProject("mine-edit");
    const theirs = makeProject("theirs-edit");
    writeConfig(mine, defaultish);
    writeConfig(theirs, defaultish);
    await installRuntime(mine, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, sharedDb);
    execFileSync("node", [path.join(PLUGIN_ROOT, "scripts", "maestro-install.js"), theirs], {
      encoding: "utf8",
      env: { ...process.env, HOME: home },
    });

    for (const root of [mine, theirs]) {
      fs.writeFileSync(path.join(root, ".claude", "handoffs", "backend", "test.md"), "MY EDIT\n");
    }

    const report = await installRuntime(mine, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, sharedDb);
    const out = JSON.parse(
      execFileSync("node", [path.join(PLUGIN_ROOT, "scripts", "maestro-install.js"), theirs], {
        encoding: "utf8",
        env: { ...process.env, HOME: home },
      })
    );

    expect(report.handoffsSync.staleCustomized).toEqual(["backend/test"]);
    expect(out.handoffsSync.staleCustomized).toEqual(["backend/test"]);
    for (const root of [mine, theirs]) {
      expect(fs.readFileSync(path.join(root, ".claude", "handoffs", "backend", "test.md"), "utf8")).toBe("MY EDIT\n");
      expect(fs.existsSync(path.join(root, ".claude", "templates", "handoffs"))).toBe(false);
    }
  });
});

describe("first-install config seeding (project tags)", () => {
  it("seeds maestro.json immediately, with project_tags matched from repo detection", async () => {
    const root = makeProject("p");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ dependencies: { express: "^4" } }));

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    expect(report.configSeeded).toEqual({ implAgents: ["backend"], projectTags: ["backend"] });

    const cfg = readConfig(root)!;
    expect(cfg.agents_available).toContain("backend");
    expect(cfg.project_tags).toEqual(["backend"]);
  });

  it("never re-seeds or touches project_tags when maestro.json already exists", async () => {
    const root = makeProject("p");
    writeConfig(root, { ...defaultish, project_tags: ["frontend"] });

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
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

    const report = await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, narrowedCatalogDb, HANDOFFS_DB);
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
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
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
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
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
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

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

  // `035`. The global report tier, reached from the PROJECT'S copy of the hook — which is the
  // whole point: `.claude/scripts/` is a different `require` root than the marketplace cache the
  // plugin's copy runs from, and until this slice the manifest copied no
  // `lib/maestro-report-defaults.cjs` into it. The require then failed, the try/catch around it
  // swallowed the failure, and an agent whose only report is the global one got no output format
  // at all — silently, and only for projects running their own install.
  //
  // `docsmith` is used because it is in no fixture's `agents_available`, so the report sync
  // materializes no `.claude/reports/docsmith.md` and the project tier cannot be what answers.
  // That is also the real case: a report has to reach an agent used outside Maestro's routing.
  describe("global report defaults, from the project's own copy of the hook", () => {
    // runHook points HOME at `tmp`, so this is the store the copied hook actually opens. NOT
    // REPORTS_DB, which is the install's own read: passing the same file would leave it ambiguous
    // whether the hook resolved the row or the install had materialized it.
    const hookReportsDb = () => path.join(tmp, ".claude", "maestro-report-defaults.sqlite");

    async function projectWithGlobalReport(): Promise<string> {
      const root = makeProject("reports");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
      writeAgentReportDefault("docsmith", "REPORT FROM THE GLOBAL STORE", hookReportsDb());
      return root;
    }

    it("resolves an agent's global report default", async () => {
      const root = await projectWithGlobalReport();
      expect(fs.existsSync(path.join(root, ".claude", "reports", "docsmith.md"))).toBe(false);

      const context = JSON.parse(
        runHook(root, "maestro-inject-agent-context.cjs", { cwd: root, agent_type: "docsmith" })
      ).hookSpecificOutput.additionalContext as string;
      expect(context).toContain("Mandatory output format for the `docsmith` agent");
      expect(context).toContain("REPORT FROM THE GLOBAL STORE");
    });

    // The state every project installed before `035` was in, and the reason the bug was invisible:
    // remove the copied lib and the same run emits NOTHING — no report, no error, exit 0. It is
    // also still the state on a `node` older than 22.5, where the file is there and `node:sqlite`
    // is not, which is why the require stays inside a try/catch.
    it("emits nothing at all when the copied lib is missing, without failing the hook", async () => {
      const root = await projectWithGlobalReport();
      fs.rmSync(path.join(root, ".claude", "scripts", "lib", "maestro-report-defaults.cjs"));

      expect(runHook(root, "maestro-inject-agent-context.cjs", { cwd: root, agent_type: "docsmith" })).toBe("");
    });

    // The tier order is unchanged by the copy: a project file still wins over the global row.
    it("still prefers a project override over the global row", async () => {
      const root = await projectWithGlobalReport();
      const cfg = readConfig(root)!;
      writeConfig(root, { ...cfg, reports: { ...(cfg.reports ?? {}), docsmith: { id: "docsmith" } } });
      fs.mkdirSync(path.join(root, ".claude", "reports"), { recursive: true });
      fs.writeFileSync(path.join(root, ".claude", "reports", "docsmith.md"), "THE PROJECT'S OWN SHAPE\n");

      const context = JSON.parse(
        runHook(root, "maestro-inject-agent-context.cjs", { cwd: root, agent_type: "docsmith" })
      ).hookSpecificOutput.additionalContext as string;
      expect(context).toContain("THE PROJECT'S OWN SHAPE");
      expect(context).not.toContain("REPORT FROM THE GLOBAL STORE");
    });
  });

  // `033`'s three tiers, exercised through the COPIED hook — the only place the fall-through can
  // actually be observed. Since `035` the sqlite tier IS copied into the project, so the second
  // test below has to delete it to reach the seed: that is the condition the seed was split out
  // of the store for (a `node` older than 22.5, or a project installed by an older runtime), and
  // it is now simulated rather than a property of the manifest.
  describe("handoff protocol injection", () => {
    it("injects the project's materialized copy, and the user's edit to it", async () => {
      const root = makeProject("p");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

      const injected = runHook(root, "maestro-inject-agent-context.cjs", { cwd: root, agent_type: "backend" });
      expect(injected).toContain(".claude/channels/test/backend.1.md"); // `036`: the channel file to write, not a field
      expect(injected).toContain("behaviors_to_test"); // the backend -> test protocol

      fs.writeFileSync(path.join(root, ".claude", "handoffs", "backend", "test.md"), "MY OWN SHAPE\n");
      expect(runHook(root, "maestro-inject-agent-context.cjs", { cwd: root, agent_type: "backend" })).toContain(
        "MY OWN SHAPE"
      );
    });

    it("still emits the shipped seed with the sqlite bundle unresolvable and no project file", async () => {
      const root = makeProject("p");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

      // Neither of the two tiers above this one can answer: the project's copies are gone, and
      // the store's bundle is deleted, which is what an old `node` amounts to at the require.
      fs.rmSync(path.join(root, ".claude", "handoffs"), { recursive: true, force: true });
      fs.rmSync(path.join(root, ".claude", "scripts", "lib", "maestro-handoff-defaults.cjs"));

      const context = JSON.parse(
        runHook(root, "maestro-inject-agent-context.cjs", { cwd: root, agent_type: "backend" })
      ).hookSpecificOutput.additionalContext as string;
      expect(context).toContain(
        "Route `HANDOFF: success` → `test` — write this to `.claude/channels/test/backend.1.md`:"
      );
      expect(context).toContain(SEED_HANDOFFS["backend/test"]);
    });

    // The bug `033` folded in, and the fixture that proves it: the sender was bared and the
    // RECEIVER was not, so a project whose instances carry namespaced agents resolved
    // `frontend/maestro:reviewer` — a pair that exists nowhere — and injected no protocol at all,
    // silently. Both ends namespaced is what the old code could not do; `withSkillNodes` only
    // namespaces the sender, so it would have passed either way.
    const namespacedBothEnds: MaestroConfigV3 = {
      ...withSkillNodes,
      workflow_instances: [
        { name: "frontend_main", agent: "maestro:frontend", loaded_skills: [], referenced_skills: [] },
        { name: "reviewer_main", agent: "maestro:reviewer", loaded_skills: [], referenced_skills: [] },
      ],
    };

    it("resolves a protocol for a project whose instances carry NAMESPACED agents on both ends", async () => {
      // Run from the PLUGIN root (an uninstalled project, so the arbitration guard lets it
      // through) — that copy has the sqlite lib beside it, which also exercises the global tier.
      const root = makeProject("ns");
      writeConfig(root, namespacedBothEnds);
      const context = JSON.parse(
        runPluginHook(root, "maestro-inject-agent-context.js", { cwd: root, agent_type: "maestro:frontend" })
      ).hookSpecificOutput.additionalContext as string;
      expect(context).toContain(
        "Route `HANDOFF: success` → `reviewer` — write this to `.claude/channels/reviewer/frontend.1.md`:"
      );
      expect(context).toContain("areas_of_concern"); // the frontend -> reviewer protocol
    });
  });

  // `036`. The COPIED scripts, fed synthetic SubagentStop/SubagentStart payloads exactly as
  // maestro-inject-agent-context's own describe block above does for handoff protocols.
  describe("agent channels (036)", () => {
    function runId(root: string): string {
      return JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro_session.json"), "utf8")).run_id;
    }

    it("stamps a channel file at SubagentStop, and a different sender's write is untouched", async () => {
      const root = makeProject("p");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

      const laneDir = path.join(root, ".claude", "channels", "test");
      fs.mkdirSync(laneDir, { recursive: true });
      fs.writeFileSync(path.join(laneDir, "backend.1.md"), '{"behaviors_to_test":["x"]}\n');
      fs.writeFileSync(path.join(laneDir, "frontend.1.md"), '{"behaviors_to_test":["y"]}\n');

      runHook(root, "maestro-subagent-log.cjs", {
        cwd: root,
        hook_event_name: "SubagentStop",
        agent_type: "backend",
        agent_id: "a1",
        last_assistant_message: "HANDOFF: success",
      });

      const stamped = fs.readFileSync(path.join(laneDir, "backend.1.md"), "utf8");
      expect(stamped).toMatch(/^<!-- maestro:run_id=.+ -->\n\{"behaviors_to_test":\["x"\]\}\n$/);
      // A parallel `frontend` write must not have been stamped by `backend`'s own SubagentStop.
      expect(fs.readFileSync(path.join(laneDir, "frontend.1.md"), "utf8")).toBe('{"behaviors_to_test":["y"]}\n');
    });

    it("delivers a same-run stamped file at SubagentStart, retires it, and logs a channel_delivery entry", async () => {
      const root = makeProject("p");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

      const laneDir = path.join(root, ".claude", "channels", "test");
      fs.mkdirSync(laneDir, { recursive: true });
      fs.writeFileSync(path.join(laneDir, "backend.1.md"), '{"behaviors_to_test":["x"]}\n');

      runHook(root, "maestro-subagent-log.cjs", {
        cwd: root,
        hook_event_name: "SubagentStop",
        agent_type: "backend",
        agent_id: "a1",
        last_assistant_message: "HANDOFF: success",
      });
      const stampedRunId = runId(root);

      const context = JSON.parse(
        runHook(root, "maestro-inject-agent-context.cjs", { cwd: root, agent_type: "test", agent_id: "a2" })
      ).hookSpecificOutput.additionalContext as string;
      expect(context).toContain("Delivered to your channel");
      expect(context).toContain('{"behaviors_to_test":["x"]}');
      expect(context).toContain("From `backend`");

      // Retired by MOVE, not delete.
      expect(fs.existsSync(path.join(laneDir, "backend.1.md"))).toBe(false);
      expect(
        fs.readFileSync(path.join(root, ".claude", "channels", ".consumed", "test", "backend.1.md"), "utf8")
      ).toContain('{"behaviors_to_test":["x"]}');

      const log = fs
        .readFileSync(path.join(root, ".claude", "maestro_session.log.jsonl"), "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l));
      const delivery = log.find((e) => e.kind === "channel_delivery");
      expect(delivery).toMatchObject({ sender: "backend", receiver: "test", agent_id: "a2" });
      expect(delivery.content).toContain('{"behaviors_to_test":["x"]}');
      expect(stampedRunId).toBeTruthy();

      // A second SubagentStart for the same receiver in the same run has nothing left to deliver.
      const second = runHook(root, "maestro-inject-agent-context.cjs", { cwd: root, agent_type: "test" });
      expect(JSON.parse(second).hookSpecificOutput.additionalContext as string).not.toContain(
        "Delivered to your channel"
      );
    });

    it("does NOT inline a file stamped with a different run_id, or an unstamped one — only mentions them, and leaves them on disk", async () => {
      const root = makeProject("p");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

      const laneDir = path.join(root, ".claude", "channels", "test");
      fs.mkdirSync(laneDir, { recursive: true });
      fs.writeFileSync(path.join(laneDir, "backend.1.md"), "<!-- maestro:run_id=some-other-run -->\nFOREIGN\n");
      fs.writeFileSync(path.join(laneDir, "frontend.1.md"), "UNSTAMPED\n");

      const context = JSON.parse(runHook(root, "maestro-inject-agent-context.cjs", { cwd: root, agent_type: "test" }))
        .hookSpecificOutput.additionalContext as string;

      expect(context).not.toContain("Delivered to your channel");
      expect(context).not.toContain("FOREIGN");
      expect(context).not.toContain("UNSTAMPED");
      expect(context).toContain("Waiting in your channel but NOT from this run");
      expect(context).toContain("backend");
      expect(context).toContain("frontend");
      expect(context).toContain("(unstamped)");
      expect(context).toContain(".claude/channels/test/backend.1.md");
      expect(context).toContain(".claude/channels/test/frontend.1.md");

      // Left on disk, exactly where they were.
      expect(fs.existsSync(path.join(laneDir, "backend.1.md"))).toBe(true);
      expect(fs.existsSync(path.join(laneDir, "frontend.1.md"))).toBe(true);
    });

    it("mints run_id into maestro_session.json (at SubagentStop, which always touches it), and a run after SessionEnd gets a different one", async () => {
      const root = makeProject("p");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

      runHook(root, "maestro-subagent-log.cjs", {
        cwd: root,
        hook_event_name: "SubagentStop",
        agent_type: "backend",
        agent_id: "a1",
        last_assistant_message: "HANDOFF: success",
      });
      const first = runId(root);
      expect(first).toBeTruthy();

      runHook(root, "maestro-session-cleanup.cjs", { cwd: root });
      expect(fs.existsSync(path.join(root, ".claude", "maestro_session.json"))).toBe(false);

      runHook(root, "maestro-subagent-log.cjs", {
        cwd: root,
        hook_event_name: "SubagentStop",
        agent_type: "backend",
        agent_id: "a2",
        last_assistant_message: "HANDOFF: success",
      });
      expect(runId(root)).not.toBe(first);
    });

    it("SessionEnd sweeps .consumed/ and ages out a lane file past the cap, but leaves an in-cap undelivered file — including the scribe's own lane", async () => {
      const root = makeProject("p");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

      const consumedPath = path.join(root, ".claude", "channels", ".consumed", "test", "backend.1.md");
      fs.mkdirSync(path.dirname(consumedPath), { recursive: true });
      fs.writeFileSync(consumedPath, "OLD DELIVERY\n");

      const scribeLane = path.join(root, ".claude", "channels", "scribe", "backend.1.md");
      fs.mkdirSync(path.dirname(scribeLane), { recursive: true });
      fs.writeFileSync(scribeLane, '{"concept_skill_gaps":[]}\n');
      const oldTime = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
      fs.utimesSync(scribeLane, oldTime, oldTime); // past the 14-day cap

      const recentLane = path.join(root, ".claude", "channels", "test", "frontend.1.md");
      fs.mkdirSync(path.dirname(recentLane), { recursive: true });
      fs.writeFileSync(recentLane, "RECENT\n"); // no scribe ran, still well inside the cap

      runHook(root, "maestro-session-cleanup.cjs", { cwd: root });

      expect(fs.existsSync(consumedPath)).toBe(false); // .consumed/ swept unconditionally
      expect(fs.existsSync(scribeLane)).toBe(false); // past the age cap
      expect(fs.existsSync(recentLane)).toBe(true); // in-cap, undelivered — kept
    });

    // `backend` has NO route to `scribe` at all in `defaultish` (its only success edge is
    // `backend -> test`) — the case the whole scribe-lane redesign exists for: a gap is not
    // route-shaped, so it has to reach the scribe regardless of whether this workflow ever wires
    // an edge to it.
    it("a concept-skill gap from an agent with no route to scribe still reaches the scribe's lane across a SessionEnd", async () => {
      const root = makeProject("p");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

      // backend's own injected report tells it where to write a gap, unconditionally — not gated
      // on a scribe route existing for this workflow.
      const backendContext = JSON.parse(
        runHook(root, "maestro-inject-agent-context.cjs", { cwd: root, agent_type: "backend" })
      ).hookSpecificOutput.additionalContext as string;
      expect(backendContext).toContain(".claude/channels/scribe/backend.1.md");

      // backend writes the gap itself, then its own SubagentStop stamps it (run A).
      const gapPath = path.join(root, ".claude", "channels", "scribe", "backend.1.md");
      fs.mkdirSync(path.dirname(gapPath), { recursive: true });
      fs.writeFileSync(
        gapPath,
        '{"concept_skill_gaps":[{"skill":"agents-view","missing":"the tri-state chip logic"}]}\n'
      );
      runHook(root, "maestro-subagent-log.cjs", {
        cwd: root,
        hook_event_name: "SubagentStop",
        agent_type: "backend",
        agent_id: "a1",
        last_assistant_message: "HANDOFF: success",
      });

      // Run A ends. The gap survives it — SessionEnd sweeps only `.consumed/` and the age cap.
      runHook(root, "maestro-session-cleanup.cjs", { cwd: root });
      expect(fs.existsSync(gapPath)).toBe(true);

      // Run B: `@scribe` is invoked with no route from `backend` in this run either. The gap is
      // NOT silently dropped — same freshness rule as any other channel file, no special case for
      // this lane: a run B stamp mismatch means it is surfaced, not inlined, and left on disk for
      // the scribe to read itself.
      const scribeContext = JSON.parse(
        runHook(root, "maestro-inject-agent-context.cjs", { cwd: root, agent_type: "scribe" })
      ).hookSpecificOutput.additionalContext as string;
      expect(scribeContext).toContain("Waiting in your channel but NOT from this run");
      expect(scribeContext).toContain("backend");
      expect(scribeContext).toContain(".claude/channels/scribe/backend.1.md");
      expect(fs.existsSync(gapPath)).toBe(true); // left in place — the scribe can go read it
    });
  });

  // `040`. Same COPIED-hook harness as `036` above, but exercising BOTH sibling hooks
  // (`maestro-subagent-log.cjs` at SubagentStop, then `maestro-inject-agent-context.cjs` at the
  // next SubagentStart) rather than a hand-built log — the acceptance criterion that matters most
  // here is a race between the two hooks' own writes, which a hand-built log can't reproduce.
  describe("resume-aware injection (040)", () => {
    function stop(root: string, agentType: string, agentId: string, msg = "HANDOFF: success") {
      runHook(root, "maestro-subagent-log.cjs", {
        cwd: root,
        hook_event_name: "SubagentStop",
        agent_type: agentType,
        agent_id: agentId,
        last_assistant_message: msg,
      });
    }

    function inject(root: string, agentType: string, agentId: string): string {
      return JSON.parse(
        runHook(root, "maestro-inject-agent-context.cjs", { cwd: root, agent_type: agentType, agent_id: agentId })
      ).hookSpecificOutput.additionalContext as string;
    }

    it("gives a first run the full injection byte-for-byte, and a resumed run the one-line reminder instead", async () => {
      const root = makeProject("resume");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

      // First run: agent_id "a1" has no completed run in the log yet.
      const first = inject(root, "backend", "a1");
      expect(first).toContain("expressjs"); // backend's loaded_skills
      expect(first).toContain("Skills to load for the `backend` agent instance");
      expect(first).toContain("Handoff routing for the `backend` agent");
      expect(first).toContain("write the shape for the route you take");
      expect(first).not.toContain("Resumed run —");

      // Rerunning the SAME first-run payload must be pinned identical — the regression that
      // matters. Nothing about this call touches the log, so it's deterministic.
      expect(inject(root, "backend", "a1")).toBe(first);

      // `a1` completes a run — the resume signal.
      stop(root, "backend", "a1");

      // Same agent_id, same agent_type: now a resume.
      const resumed = inject(root, "backend", "a1");
      expect(resumed).toContain(
        "Resumed run — the skills, handoff routes and output format from your first run still apply."
      );
      expect(resumed).not.toContain("expressjs");
      expect(resumed).not.toContain("Skills to load for the");
      expect(resumed).not.toContain("Skills available to the");
      expect(resumed).not.toContain("Handoff routing for the");
      expect(resumed).not.toContain("write the shape for the route you take");
    });

    it("still delivers a channel payload that arrived between a resumed agent's two runs, and still carries a warning", async () => {
      const root = makeProject("resume-warn");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

      // An active workflow name that matches nothing in maestro.json — the union-and-warn branch.
      fs.writeFileSync(
        path.join(root, ".claude", "maestro_session.json"),
        JSON.stringify({ workflow: "not-a-real-workflow", generated_instances: [] })
      );

      stop(root, "backend", "a1"); // a1 completes its first run — the resume signal for next time

      // A payload arrives in backend's lane between the two runs.
      const laneDir = path.join(root, ".claude", "channels", "backend");
      fs.mkdirSync(laneDir, { recursive: true });
      fs.writeFileSync(path.join(laneDir, "test.1.md"), "NEW SINCE THE FIRST RUN\n");
      stop(root, "test", "t1"); // test's own SubagentStop stamps its own write with this run's id

      const resumed = inject(root, "backend", "a1");
      expect(resumed).toContain(
        "Resumed run — the skills, handoff routes and output format from your first run still apply."
      );
      expect(resumed).toContain("⚠️ Maestro warning:");
      expect(resumed).toContain("not-a-real-workflow");
      expect(resumed).toContain("Delivered to your channel");
      expect(resumed).toContain("NEW SINCE THE FIRST RUN");
    });

    it("classifies two agents running in parallel independently — one resuming does not make the other look resumed", async () => {
      const root = makeProject("resume-parallel");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

      // `backend` (a1) completes a run. `test` (t1) is dispatched for the FIRST time — its
      // sibling SubagentStart hook writes a `dispatch` entry carrying t1's agent_id, which must
      // not be mistaken for a completed run of its own.
      stop(root, "backend", "a1");
      runHook(root, "maestro-subagent-log.cjs", {
        cwd: root,
        hook_event_name: "SubagentStart",
        agent_type: "test",
        agent_id: "t1",
        last_assistant_message: null,
      });

      const backendResumed = inject(root, "backend", "a1");
      expect(backendResumed).toContain("Resumed run —");

      const testFirstRun = inject(root, "test", "t1");
      expect(testFirstRun).not.toContain("Resumed run —");
      expect(testFirstRun).toContain("Handoff routing for the `test` agent");
    });

    it("classifies a first run as not-a-resume with no session log on disk at all", async () => {
      const root = makeProject("resume-cold");
      writeConfig(root, defaultish);
      await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
      expect(fs.existsSync(path.join(root, ".claude", "maestro_session.log.jsonl"))).toBe(false);

      const first = inject(root, "backend", "a1");
      expect(first).not.toContain("Resumed run —");
      expect(first).toContain("Handoff routing for the `backend` agent");
    });
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
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

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
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT });

    expect(fs.existsSync(path.join(root, ".claude", "scripts", "maestro-session-log.cjs"))).toBe(true);
    runPluginHook(root, "maestro-session-log.js", readPayload(root));
    expect(fs.existsSync(logPath(root))).toBe(true);
  });

  it("stands down the plugin's SubagentStart injection, so context is injected once", async () => {
    const root = makeProject("p");
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

    const payload = { cwd: root, hook_event_name: "SubagentStart", agent_type: "backend" };
    expect(runPluginHook(root, "maestro-inject-agent-context.js", payload)).toBe("");
    expect(runHook(root, "maestro-inject-agent-context.cjs", payload)).toContain("HANDOFF:");
  });

  // ── Step 0, as a hook ────────────────────────────────────────────────────
  //
  // The readiness check used to be two bash calls and forty lines of prose at the top of every
  // orchestration. What is asserted here is the part that replaced it: WHICH invocations it reacts
  // to, and that the healthy path is silent — a hook that speaks on every prompt is worse than the
  // prose it replaced.

  /** Run a hook that may exit non-zero, returning both streams and the code. */
  function runHookRaw(root: string, script: string, payload: unknown) {
    try {
      const stdout = runHook(root, script, payload);
      return { code: 0, stdout, stderr: "" };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { code: e.status, stdout: e.stdout, stderr: e.stderr };
    }
  }

  const expansion = (root: string, command: string) => ({
    cwd: root,
    hook_event_name: "UserPromptExpansion",
    command_name: command,
  });

  it("says nothing at all when the project is ready to orchestrate", async () => {
    const root = makeProject("p");
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    // The install copies the skill; rendering its handoff table from maestro.json is the separate
    // step /maestro-install runs next, and check 4 is what notices when nobody did.
    renderOrchestrator(root);
    writeRuntimeVersion(root, shippedRuntimeVersion(PLUGIN_ROOT));

    const run = runHookRaw(root, "maestro-step0.cjs", expansion(root, "maestro"));
    expect(run.code).toBe(0);
    expect(run.stdout).toBe("");
  });

  it("reacts to `/maestro` and to the Skill tool, and to nothing else", async () => {
    const root = makeProject("p");
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    // Deliberately NOT rendered, so the check has something to say and silence means "ignored".
    const speaks = (payload: unknown) => runHookRaw(root, "maestro-step0.cjs", payload).stdout !== "";

    expect(speaks(expansion(root, "maestro"))).toBe(true);
    // The plugin's own commands share the prefix and must not trip it.
    expect(speaks(expansion(root, "maestro-update"))).toBe(false);
    expect(speaks(expansion(root, "maestro-install"))).toBe(false);
    // The other entrance: the model invoking the skill itself.
    const skillCall = (skill: string) => ({
      cwd: root,
      hook_event_name: "PreToolUse",
      tool_name: "Skill",
      tool_input: { skill },
    });
    expect(speaks(skillCall("maestro"))).toBe(true);
    expect(speaks(skillCall("maestro:maestro-update"))).toBe(false);
    expect(speaks({ ...skillCall("maestro"), tool_name: "Bash" })).toBe(false);
  });

  it("injects an instruction the way each event actually accepts one", async () => {
    const root = makeProject("p");
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

    // UserPromptExpansion adds plain stdout to the model's context...
    const expanded = runHookRaw(root, "maestro-step0.cjs", expansion(root, "maestro"));
    expect(expanded.code).toBe(0);
    expect(expanded.stdout).toContain("/maestro-update");
    expect(() => JSON.parse(expanded.stdout)).toThrow();

    // ...PreToolUse does not, so the same sentence has to travel as additionalContext.
    const viaSkill = runHookRaw(root, "maestro-step0.cjs", {
      cwd: root,
      hook_event_name: "PreToolUse",
      tool_name: "Skill",
      tool_input: { skill: "maestro" },
    });
    expect(JSON.parse(viaSkill.stdout).hookSpecificOutput).toMatchObject({
      hookEventName: "PreToolUse",
      additionalContext: expect.stringContaining("/maestro-update"),
    });
  });

  it("blocks the invocation outright when the project cannot orchestrate", () => {
    // No maestro.json at all: the prose this replaced could only ASK the model to stop.
    const root = makeProject("p");
    fs.mkdirSync(path.join(root, ".claude", "scripts"), { recursive: true });
    for (const asset of runtimeAssets(PLUGIN_ROOT)) {
      const to = path.join(root, asset.dest);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.copyFileSync(path.join(PLUGIN_ROOT, asset.src), to);
    }

    const run = runHookRaw(root, "maestro-step0.cjs", expansion(root, "maestro"));
    expect(run.code).toBe(2);
    expect(run.stderr).toContain("/maestro-install");
  });

  it("copies the hook scripts as .cjs so they survive a `type: module` project", async () => {
    const root = makeProject("p");
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "p", type: "module" }, null, 2));
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);

    // Under `"type": "module"` a copied .js hook would throw "require is not defined in ES module
    // scope" on every single tool call. Nothing but running it from inside the project catches it.
    expect(() =>
      runHook(root, "maestro-session-log.cjs", { cwd: root, tool_name: "Read", tool_input: {} })
    ).not.toThrow();
    expect(fs.existsSync(path.join(root, ".claude", "maestro_session.log.jsonl"))).toBe(true);
  });
});

// The one runtime asset whose ABSENCE breaks an invocation rather than degrading it: Step 1 names
// it with an injected !`command`, and an injected command that exits non-zero aborts the whole
// skill before the model sees the body. So both halves are pinned here — that the script never
// fails whatever it is handed, and that a project missing it is reported stale before it can.
describe("maestro-step1-gates.cjs (032)", () => {
  /**
   * The both-off output, read from the script rather than written down here.
   *
   * Its wording is prose the orchestrator obeys and is expected to be reworded; what must not
   * change is that every degenerate input resolves to exactly THIS, whatever it currently says.
   * Duplicating the sentence in the test would pin the wording and prove nothing about the rule.
   */
  function skipLine(root: string): string {
    writeConfig(root, { ...defaultish, gates: { confidence_check: false, use_code_architecture_design_check: false } });
    return runGates(root).stdout;
  }

  /** Runs the COPY in the project, not the plugin's original — that is what a session executes. */
  function runGates(root: string): { code: number; stdout: string; stderr: string } {
    const res = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-step1-gates.cjs")], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
  }

  /** Writes maestro.json verbatim — including shapes `writeConfig` would never produce. */
  function writeRawConfig(root: string, body: string): void {
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "maestro.json"), body);
  }

  async function installed(name: string): Promise<string> {
    const root = makeProject(name);
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    return root;
  }

  it("is copied into the project by installRuntime", async () => {
    const root = await installed("copied");
    expect(fs.existsSync(path.join(root, ".claude", "scripts", "maestro-step1-gates.cjs"))).toBe(true);
    expect(runtimeAssets(PLUGIN_ROOT).map((a) => a.dest)).toContain(".claude/scripts/maestro-step1-gates.cjs");
  });

  // The script prints the WHOLE of Step 1, not a flag the skill body branches on, so what is
  // asserted is the contract rather than the prose: one line, exit 0, empty stderr, exactly the
  // enabled gates named, in order, and an instruction to go on to Step 2. The wording is expected
  // to change; every property below is not.
  it("prints one line naming exactly the enabled gates, in order, for all four combinations", async () => {
    const root = await installed("combos");
    const seen = new Set<string>();

    for (const confidence_check of [false, true]) {
      for (const use_code_architecture_design_check of [false, true]) {
        const label = `confidence=${confidence_check} design=${use_code_architecture_design_check}`;
        writeConfig(root, { ...defaultish, gates: { confidence_check, use_code_architecture_design_check } });
        const { code, stdout, stderr } = runGates(root);

        expect(code, `${label} must exit 0`).toBe(0);
        expect(stderr, `${label} must say nothing on stderr`).toBe("");
        expect(stdout.endsWith("\n"), `${label} must be newline-terminated`).toBe(true);
        expect(stdout.trimEnd().split("\n"), `${label} must be exactly one line`).toHaveLength(1);

        // Named iff enabled — this is the whole decision the script exists to make.
        expect(stdout.includes("/confidence-check"), label).toBe(confidence_check);
        expect(stdout.includes("/use-code-architecture-design-check"), label).toBe(use_code_architecture_design_check);
        // Both on: confidence first. The order is part of the instruction, not incidental.
        if (confidence_check && use_code_architecture_design_check) {
          expect(stdout.indexOf("/confidence-check")).toBeLessThan(
            stdout.indexOf("/use-code-architecture-design-check")
          );
        }
        // Every state hands off to Step 2, including the one that does nothing else.
        expect(stdout, `${label} must send the orchestrator on to Step 2`).toMatch(/Step 2/);

        seen.add(stdout);
      }
    }

    // Four distinct answers: a bug collapsing two states would otherwise pass everything above.
    expect(seen.size).toBe(4);
  });

  // Every one of these is a case where a script that "reported the problem" would take the whole
  // /maestro invocation down with it. Skip, quietly, exit 0, is the only safe answer.
  it("falls back to the both-off line — exit 0, empty stderr — on every degenerate input", async () => {
    const root = await installed("degenerate");
    const configPath = path.join(root, ".claude", "maestro.json");

    const cases: [string, () => void][] = [
      ["maestro.json missing", () => fs.rmSync(configPath)],
      ["corrupt JSON", () => writeRawConfig(root, "{ not json at all")],
      ["empty file", () => writeRawConfig(root, "")],
      ["version 2", () => writeRawConfig(root, JSON.stringify({ version: 2, gates: { confidence_check: true } }))],
      ["gates absent", () => writeConfig(root, { ...defaultish, gates: undefined })],
      ["gates is an array", () => writeRawConfig(root, JSON.stringify({ version: 3, gates: [true, true] }))],
      ["gates is a string", () => writeRawConfig(root, JSON.stringify({ version: 3, gates: "both" }))],
      ["gates is null", () => writeRawConfig(root, JSON.stringify({ version: 3, gates: null }))],
      [
        "gate values are strings",
        () =>
          writeRawConfig(
            root,
            JSON.stringify({
              version: 3,
              gates: { confidence_check: "true", use_code_architecture_design_check: "true" },
            })
          ),
      ],
      [
        "gate values are numbers",
        () =>
          writeRawConfig(
            root,
            JSON.stringify({ version: 3, gates: { confidence_check: 1, use_code_architecture_design_check: 1 } })
          ),
      ],
      ["the whole file is an array", () => writeRawConfig(root, "[]")],
      [
        ".claude/maestro.json is a directory",
        () => {
          fs.rmSync(configPath, { force: true });
          fs.mkdirSync(configPath);
        },
      ],
    ];

    const skip = skipLine(root);
    expect(skip, "the both-off line must not be empty").toMatch(/Step 2/);

    for (const [label, mutate] of cases) {
      mutate();
      const { code, stdout, stderr } = runGates(root);
      expect(code, `${label} must exit 0`).toBe(0);
      expect(stderr, `${label} must say nothing on stderr`).toBe("");
      expect(stdout, `${label} must resolve to exactly the both-off line`).toBe(skip);
      fs.rmSync(configPath, { recursive: true, force: true });
    }
  });

  it("reports a project missing the script as stale, and re-installing as the fix", async () => {
    const root = await installed("stale");
    expect((await installStatus(root, PLUGIN_ROOT)).stale).toBe(false);

    fs.rmSync(path.join(root, ".claude", "scripts", "maestro-step1-gates.cjs"));
    expect((await installStatus(root, PLUGIN_ROOT)).stale).toBe(true);

    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    expect((await installStatus(root, PLUGIN_ROOT)).stale).toBe(false);
  });

  // The staleness nag is the only thing standing between a half-installed project and an aborted
  // /maestro, so it has to fire from the runtime check the step0 hook actually consults — not just
  // from the app's own content hash above.
  it("makes maestro-check-runtime say update when the script is gone", async () => {
    const root = await installed("check");
    execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root]);
    const check = (): { action: string; reason?: string } =>
      JSON.parse(
        execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-check-runtime.cjs")], {
          encoding: "utf8",
          env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: path.join(tmp, "home-check") },
        })
      );

    expect(check().action).toBe("continue");
    fs.rmSync(path.join(root, ".claude", "scripts", "maestro-step1-gates.cjs"));
    const after = check();
    expect(after.action).toBe("update");
    expect(after.reason).toContain("maestro-step1-gates.cjs");
  });
});

// Same shape as maestro-step1-gates.cjs's suite above, for the Step 4 gate (`046`) that reads
// `use_maestro_tasks` and tells the orchestrator whether to consider /to-maestro-tasks.
describe("maestro-step4-gate.cjs (046)", () => {
  /** Runs the COPY in the project, not the plugin's original — that is what a session executes. */
  function runGate(root: string): { code: number; stdout: string; stderr: string } {
    const res = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-step4-gate.cjs")], {
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
  }

  /** Writes maestro.json verbatim — including shapes `writeConfig` would never produce. */
  function writeRawConfig(root: string, body: string): void {
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "maestro.json"), body);
  }

  async function installed(name: string): Promise<string> {
    const root = makeProject(name);
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    return root;
  }

  it("is copied into the project by installRuntime", async () => {
    const root = await installed("step4-copied");
    expect(fs.existsSync(path.join(root, ".claude", "scripts", "maestro-step4-gate.cjs"))).toBe(true);
    expect(runtimeAssets(PLUGIN_ROOT).map((a) => a.dest)).toContain(".claude/scripts/maestro-step4-gate.cjs");
  });

  it("prints the directive line only when use_maestro_tasks is true, otherwise the neutral line", async () => {
    const root = await installed("step4-onoff");

    writeConfig(root, { ...defaultish, use_maestro_tasks: true });
    const on = runGate(root);
    expect(on.code).toBe(0);
    expect(on.stderr).toBe("");
    expect(on.stdout.endsWith("\n")).toBe(true);
    expect(on.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(on.stdout).toMatch(/to-maestro-tasks/);

    writeConfig(root, { ...defaultish, use_maestro_tasks: false });
    const off = runGate(root);
    expect(off.code).toBe(0);
    expect(off.stderr).toBe("");
    expect(off.stdout.endsWith("\n")).toBe(true);
    expect(off.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(off.stdout).not.toMatch(/to-maestro-tasks/);

    expect(on.stdout).not.toBe(off.stdout);
  });

  it("falls back to the neutral line — exit 0, empty stderr — on every degenerate input", async () => {
    const root = await installed("step4-degenerate");
    const configPath = path.join(root, ".claude", "maestro.json");

    writeConfig(root, { ...defaultish, use_maestro_tasks: false });
    const off = runGate(root).stdout;
    expect(off).not.toMatch(/to-maestro-tasks/);

    const cases: [string, () => void][] = [
      ["maestro.json missing", () => fs.rmSync(configPath)],
      ["corrupt JSON", () => writeRawConfig(root, "{ not json at all")],
      ["empty file", () => writeRawConfig(root, "")],
      ["version 2", () => writeRawConfig(root, JSON.stringify({ version: 2, use_maestro_tasks: true }))],
      ["use_maestro_tasks absent", () => writeConfig(root, { ...defaultish, use_maestro_tasks: undefined })],
      [
        "use_maestro_tasks is a string",
        () => writeRawConfig(root, JSON.stringify({ version: 3, use_maestro_tasks: "true" })),
      ],
      [
        "use_maestro_tasks is a number",
        () => writeRawConfig(root, JSON.stringify({ version: 3, use_maestro_tasks: 1 })),
      ],
      [
        "use_maestro_tasks is null",
        () => writeRawConfig(root, JSON.stringify({ version: 3, use_maestro_tasks: null })),
      ],
      ["the whole file is an array", () => writeRawConfig(root, "[]")],
      [
        ".claude/maestro.json is a directory",
        () => {
          fs.rmSync(configPath, { force: true });
          fs.mkdirSync(configPath);
        },
      ],
    ];

    for (const [label, mutate] of cases) {
      mutate();
      const { code, stdout, stderr } = runGate(root);
      expect(code, `${label} must exit 0`).toBe(0);
      expect(stderr, `${label} must say nothing on stderr`).toBe("");
      expect(stdout, `${label} must resolve to exactly the neutral line`).toBe(off);
      fs.rmSync(configPath, { recursive: true, force: true });
    }
  });

  it("reports a project missing the script as stale, and re-installing as the fix", async () => {
    const root = await installed("step4-stale");
    expect((await installStatus(root, PLUGIN_ROOT)).stale).toBe(false);

    fs.rmSync(path.join(root, ".claude", "scripts", "maestro-step4-gate.cjs"));
    expect((await installStatus(root, PLUGIN_ROOT)).stale).toBe(true);

    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    expect((await installStatus(root, PLUGIN_ROOT)).stale).toBe(false);
  });

  it("makes maestro-check-runtime say update when the script is gone", async () => {
    const root = await installed("step4-check");
    execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root]);
    const check = (): { action: string; reason?: string } =>
      JSON.parse(
        execFileSync("node", [path.join(root, ".claude", "scripts", "maestro-check-runtime.cjs")], {
          encoding: "utf8",
          env: { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: path.join(tmp, "home-check-step4") },
        })
      );

    expect(check().action).toBe("continue");
    fs.rmSync(path.join(root, ".claude", "scripts", "maestro-step4-gate.cjs"));
    const after = check();
    expect(after.action).toBe("update");
    expect(after.reason).toContain("maestro-step4-gate.cjs");
  });
});

// The hook half of `047`: dual-registered exactly like maestro-step0.js, but it injects nothing —
// it exists only for the config write side effect that flips use_maestro_tasks on the first
// /to-maestro-tasks invocation, so what matters here is WHICH invocations flip it, that every other
// field survives byte-for-byte, and that every failure mode degrades to silence rather than noise.
describe("maestro-enable-task-routing.cjs (047)", () => {
  /** Runs the COPY in the project, not the plugin's original — that is what a session executes. */
  function runEnable(root: string, payload: unknown): { code: number; stdout: string; stderr: string } {
    const res = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-enable-task-routing.cjs")], {
      input: JSON.stringify(payload),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    return { code: res.status ?? -1, stdout: res.stdout, stderr: res.stderr };
  }

  /** Writes maestro.json verbatim — including shapes `writeConfig` would never produce. */
  function writeRawConfig(root: string, body: string): void {
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "maestro.json"), body);
  }

  const configPath = (root: string) => path.join(root, ".claude", "maestro.json");
  const readRawConfig = (root: string) => fs.readFileSync(configPath(root), "utf8");

  async function installed(name: string): Promise<string> {
    const root = makeProject(name);
    writeConfig(root, defaultish);
    await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
    return root;
  }

  const expansion = (root: string, command: string) => ({
    cwd: root,
    hook_event_name: "UserPromptExpansion",
    command_name: command,
  });
  const skillCall = (root: string, skill: string) => ({
    cwd: root,
    hook_event_name: "PreToolUse",
    tool_name: "Skill",
    tool_input: { skill },
  });

  it("is copied into the project by installRuntime and registered on both events", async () => {
    const root = await installed("route-copied");
    expect(fs.existsSync(path.join(root, ".claude", "scripts", "maestro-enable-task-routing.cjs"))).toBe(true);
    expect(runtimeAssets(PLUGIN_ROOT).map((a) => a.dest)).toContain(".claude/scripts/maestro-enable-task-routing.cjs");

    const settings = readSettings(root);
    expect(commandsFor(settings, "UserPromptExpansion")).toContain(
      'node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-enable-task-routing.cjs"'
    );
    expect(commandsFor(settings, "PreToolUse")).toContain(
      'node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-enable-task-routing.cjs"'
    );
  });

  it("flips use_maestro_tasks to true on /to-maestro-tasks, via both entrances, and on nothing else", async () => {
    const root = await installed("route-fires");

    // Neither the plugin's own commands nor another skill's Skill-tool call trips it.
    runEnable(root, expansion(root, "to-maestro-tasks-planning")); // shares the prefix, must not match
    expect(readConfig(root)?.use_maestro_tasks).not.toBe(true);
    runEnable(root, expansion(root, "maestro"));
    expect(readConfig(root)?.use_maestro_tasks).not.toBe(true);
    runEnable(root, skillCall(root, "maestro:maestro-update"));
    expect(readConfig(root)?.use_maestro_tasks).not.toBe(true);
    runEnable(root, { ...skillCall(root, "to-maestro-tasks"), tool_name: "Bash" });
    expect(readConfig(root)?.use_maestro_tasks).not.toBe(true);

    // The user typing the command.
    const typed = runEnable(root, expansion(root, "to-maestro-tasks"));
    expect(typed.code).toBe(0);
    expect(typed.stderr).toBe("");
    expect(readConfig(root)?.use_maestro_tasks).toBe(true);

    // Reset, then the other entrance: the model invoking the skill itself, plugin-namespaced.
    writeConfig(root, defaultish);
    const viaSkill = runEnable(root, skillCall(root, "plugin:to-maestro-tasks"));
    expect(viaSkill.code).toBe(0);
    expect(viaSkill.stderr).toBe("");
    expect(readConfig(root)?.use_maestro_tasks).toBe(true);
  });

  it("injects nothing on either event — no stdout, no additionalContext, ever", async () => {
    const root = await installed("route-silent");

    const typed = runEnable(root, expansion(root, "to-maestro-tasks"));
    expect(typed.stdout).toBe("");

    writeConfig(root, defaultish);
    const viaSkill = runEnable(root, skillCall(root, "to-maestro-tasks"));
    expect(viaSkill.stdout).toBe("");
  });

  it("mutates only use_maestro_tasks, leaving every other field byte-for-byte in a re-parse", async () => {
    const root = await installed("route-isolated");
    const before = readConfig(root)!;

    runEnable(root, expansion(root, "to-maestro-tasks"));

    const after = readConfig(root)!;
    expect(after.use_maestro_tasks).toBe(true);
    expect({ ...after, use_maestro_tasks: undefined }).toEqual({ ...before, use_maestro_tasks: undefined });
  });

  it("serializes exactly as writeConfig does: two-space indent, no trailing newline", async () => {
    const root = await installed("route-serialization");
    runEnable(root, expansion(root, "to-maestro-tasks"));

    const raw = readRawConfig(root);
    expect(raw.endsWith("\n")).toBe(false);
    expect(raw).toBe(JSON.stringify(JSON.parse(raw), null, 2));
  });

  it("is a no-op once already true — no write, content and mtime unchanged", async () => {
    const root = await installed("route-noop");
    writeConfig(root, { ...defaultish, use_maestro_tasks: true });
    const before = readRawConfig(root);
    const mtimeBefore = fs.statSync(configPath(root)).mtimeMs;

    // A filesystem mtime clock can be coarser than the gap between these two calls; without a
    // pause a same-tick no-op write would look identical to a real one, silently trivializing this
    // whole assertion. 20ms is comfortably past the coarsest common tick (Windows' ~15ms) and short
    // enough not to be worth ever noticing in CI.
    await new Promise((r) => setTimeout(r, 20));

    const run = runEnable(root, expansion(root, "to-maestro-tasks"));
    expect(run.code).toBe(0);
    expect(readRawConfig(root)).toBe(before);
    expect(fs.statSync(configPath(root)).mtimeMs).toBe(mtimeBefore);
  });

  it("degrades to silence — exit 0, no stderr, no crash, no file created — on every failure mode", async () => {
    const root = await installed("route-degenerate");

    const cases: [string, () => void][] = [
      ["maestro.json missing", () => fs.rmSync(configPath(root), { force: true })],
      ["corrupt JSON", () => writeRawConfig(root, "{ not json at all")],
      ["empty file", () => writeRawConfig(root, "")],
      ["the whole file is an array", () => writeRawConfig(root, "[]")],
      ["the whole file is a string", () => writeRawConfig(root, '"nope"')],
    ];

    for (const [label, mutate] of cases) {
      fs.rmSync(configPath(root), { recursive: true, force: true });
      mutate();
      const run = runEnable(root, expansion(root, "to-maestro-tasks"));
      expect(run.code, `${label} must exit 0`).toBe(0);
      expect(run.stderr, `${label} must say nothing on stderr`).toBe("");
      if (label === "maestro.json missing") {
        expect(fs.existsSync(configPath(root)), `${label} must not create a file`).toBe(false);
      }
    }
  });

  it("stands down when the project registers its own copy of the hook", async () => {
    const root = await installed("route-arbitration");
    // Same arbitration maestro-step0.js's tests rely on: the plugin's copy, running from a
    // marketplace-shaped root, must not also fire once the project owns this hook itself.
    const pluginCopy = path.join(PLUGIN_ROOT, "scripts", "maestro-enable-task-routing.js");
    const res = spawnSync("node", [pluginCopy], {
      input: JSON.stringify(expansion(root, "to-maestro-tasks")),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: root },
    });
    expect(res.status ?? -1).toBe(0);
    expect(readConfig(root)?.use_maestro_tasks).not.toBe(true);
  });
});
