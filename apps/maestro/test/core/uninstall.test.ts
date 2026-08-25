// Tests for the in-app uninstaller that replaces `node maestro-uninstall.js` run from a Claude
// session.
//
// These assert WHAT IS LEFT BEHIND, not only what went. Uninstall's failure modes are all of that
// shape: a default level that quietly takes `maestro.json` with it, a hook removal that empties a
// settings file the user hand-edited, a purge that leaves scripts an older release installed. None
// of them show up in an assertion that the thing you asked to remove is gone.
//
// The one leg a test cannot own is the same as install's: whether Claude Code still dispatches the
// hooks. What it can own is the input to that decision — after a default uninstall no command in
// the project's settings.json references `.claude/scripts/` at all, which is the whole of what
// makes a hook fire. Running a real session is verification step 7 of docs/plans/m3-in-app-install.md.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, installStatus, findUpPluginRoot, HOOK_REGISTRATIONS } from "../../src/core/install.js";
import { uninstallRuntime, uninstallPlan } from "../../src/core/uninstall.js";
import { readConfig, writeConfig, maestroJsonPath } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-uninstall-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function makeProject(name: string): string {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  return root;
}

/** A project with the runtime installed, a saved config, and a session's worth of ephemera. */
async function installed(name = "p"): Promise<string> {
  const root = makeProject(name);
  writeConfig(root, defaultish);
  await installRuntime(root, PLUGIN_ROOT);
  for (const file of ["maestro_session.json", "maestro_session.log.jsonl", "maestro_session_tasks.json"]) {
    fs.writeFileSync(path.join(root, ".claude", file), "{}\n");
  }
  return root;
}

function readSettings(root: string): Record<string, any> {
  return JSON.parse(fs.readFileSync(path.join(root, ".claude", "settings.json"), "utf8"));
}

/** Every hook command string in the file, across every event. */
function allCommands(settings: Record<string, any>): string[] {
  return Object.values(settings.hooks ?? {}).flatMap((entries: any) =>
    (entries ?? []).flatMap((e: any) => (e.hooks ?? []).map((h: any) => h.command))
  );
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

describe("default uninstall", () => {
  it("removes the hooks and the session files, and keeps maestro.json", async () => {
    const root = await installed();
    const before = readConfig(root);

    const report = await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT });

    expect(report.purge).toBe(false);
    expect(report.noop).toBe(false);
    expect(report.hooksRemoved.sort()).toEqual(HOOK_REGISTRATIONS.map((h) => h.id).sort());
    expect(report.sessionFilesRemoved).toEqual([
      ".claude/maestro_session.json",
      ".claude/maestro_session.log.jsonl",
      ".claude/maestro_session_tasks.json",
    ]);
    expect(report.purged).toEqual([]);

    // What survives is the point. The config, byte for byte.
    expect(report.configKept).toBe(true);
    expect(fs.existsSync(maestroJsonPath(root))).toBe(true);
    expect(readConfig(root)).toEqual(before);
    // And so do the skill and the scripts — a default uninstall stops the hooks, it does not
    // throw away an install the user can re-enable with one button.
    expect(fs.existsSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(path.join(root, ".claude", "scripts", "maestro-session-log.cjs"))).toBe(true);
  });

  it("leaves nothing in settings.json that could still fire a Maestro hook", async () => {
    const root = await installed();
    // A hook of the user's, so the assertions below run against a file with content in it rather
    // than the `{}` an install-only project is left with.
    const withMine = readSettings(root);
    withMine.hooks.SessionStart = [{ matcher: "", hooks: [{ type: "command", command: "echo hello" }] }];
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify(withMine, null, 2));

    await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT });
    expect(allCommands(readSettings(root))).toEqual(["echo hello"]);

    // The dispatch decision is made from this file alone: no command naming our scripts means no
    // hook can run, whatever Claude Code does with the rest of it.
    const settings = readSettings(root);
    for (const command of allCommands(settings)) {
      expect(command).not.toContain(".claude/scripts/");
    }
    for (const reg of HOOK_REGISTRATIONS) {
      expect(JSON.stringify(settings)).not.toContain(reg.script);
    }

    const status = await installStatus(root, PLUGIN_ROOT);
    expect(status.hooksRegistered).toEqual([]);
    expect(status.hooksMissing).toEqual(HOOK_REGISTRATIONS.map((h) => h.id));
  });

  it("also removes a re-quoted command, and the legacy agent setting", async () => {
    const root = await installed();

    const settingsPath = path.join(root, ".claude", "settings.json");
    const edited = readSettings(root);
    edited.agent = "maestro"; // what installs predating the hook registration left behind
    edited.hooks.PreToolUse[0].hooks[0].command =
      "node '${CLAUDE_PROJECT_DIR}/.claude/scripts/maestro-session-log.cjs' --verbose";
    fs.writeFileSync(settingsPath, JSON.stringify(edited, null, 2));

    const report = await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT });

    expect(report.legacyAgentSettingRemoved).toBe(true);
    expect(report.hooksRemoved).toContain("PreToolUse:maestro-session-log.cjs");
    expect(readSettings(root).agent).toBeUndefined();
    expect(JSON.stringify(readSettings(root))).not.toContain("maestro-session-log");
  });

  it("removes the hook a pre-app install registered, in its exact legacy form", async () => {
    // What `/maestro-install` left in a project before the desktop app existed: one entry, the
    // command unquoted and un-prefixed. test/install.test.ts pins that string byte for byte.
    const root = makeProject("p");
    fs.mkdirSync(path.join(root, ".claude", "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "scripts", "bash-validation.sh"), "#!/bin/sh\n");
    fs.writeFileSync(
      path.join(root, ".claude", "settings.json"),
      JSON.stringify(
        {
          hooks: {
            PreToolUse: [
              {
                matcher: "Bash",
                hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/.claude/scripts/bash-validation.sh" }],
              },
            ],
          },
        },
        null,
        2
      )
    );

    const report = await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT });

    expect(report.hooksRemoved).toEqual(["PreToolUse:bash-validation.sh"]);
    expect(readSettings(root).hooks).toBeUndefined();
  });

  it("is idempotent — a second run removes nothing and writes nothing", async () => {
    const root = await installed();
    await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT });
    const settingsPath = path.join(root, ".claude", "settings.json");
    const after = fs.readFileSync(settingsPath, "utf8");
    const mtime = fs.statSync(settingsPath).mtimeMs;

    const second = await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT });

    expect(second.noop).toBe(true);
    expect(second.hooksRemoved).toEqual([]);
    expect(fs.readFileSync(settingsPath, "utf8")).toBe(after);
    expect(fs.statSync(settingsPath).mtimeMs).toBe(mtime);
  });
});

describe("hooks and settings the app did not add", () => {
  const handEdited = {
    model: "opus",
    permissions: { allow: ["Bash(git status)"] },
    hooks: {
      PreToolUse: [
        { matcher: "Bash", hooks: [{ type: "command", command: "/usr/local/bin/my-guard.sh" }] },
        { matcher: "Write", hooks: [{ type: "command", command: "node ~/bin/maestro-session-log.cjs" }] },
      ],
      SessionEnd: [{ matcher: "", hooks: [{ type: "command", command: "my-cleanup.sh" }] }],
      Notification: [{ matcher: "", hooks: [{ type: "command", command: "say hi" }] }],
      Stop: [{ matcher: "", hooks: [] }],
    },
  };

  it("survives an uninstall, including a same-named script outside .claude/scripts", async () => {
    const root = makeProject("p");
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify(handEdited, null, 2));
    await installRuntime(root, PLUGIN_ROOT);

    await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT });
    const settings = readSettings(root);

    expect(settings.model).toBe("opus");
    expect(settings.permissions).toEqual({ allow: ["Bash(git status)"] });
    // Ours shared the user's Bash matcher; removing it must leave their guard in place.
    expect(allCommands(settings)).toContain("/usr/local/bin/my-guard.sh");
    expect(allCommands(settings)).toContain("my-cleanup.sh");
    expect(settings.hooks.Notification).toEqual(handEdited.hooks.Notification);
    // ~/bin/maestro-session-log.cjs has our filename but is not in our directory — not ours.
    expect(allCommands(settings)).toContain("node ~/bin/maestro-session-log.cjs");
    // An event we never touched comes out exactly as it went in, empty entry and all.
    expect(settings.hooks.Stop).toEqual([{ matcher: "", hooks: [] }]);
  });

  it("keeps a user script that merely lives in .claude/scripts, even on purge", async () => {
    const root = await installed();
    const mine = path.join(root, ".claude", "scripts", "my-hook.sh");
    fs.writeFileSync(mine, "#!/bin/sh\necho mine\n");
    const settingsPath = path.join(root, ".claude", "settings.json");
    const settings = readSettings(root);
    settings.hooks.PreToolUse.push({
      matcher: "Read",
      hooks: [{ type: "command", command: "$CLAUDE_PROJECT_DIR/.claude/scripts/my-hook.sh" }],
    });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    await uninstallRuntime(root, { purge: true, pluginRoot: PLUGIN_ROOT });

    expect(fs.existsSync(mine)).toBe(true);
    expect(allCommands(readSettings(root))).toEqual(["$CLAUDE_PROJECT_DIR/.claude/scripts/my-hook.sh"]);
    // The directory survives because it is not empty — pruning only ever removes empty ones.
    expect(filesUnder(path.join(root, ".claude", "scripts"))).toEqual(["my-hook.sh"]);
  });

  it("refuses to touch an unparseable settings.json, and deletes nothing", async () => {
    const root = await installed();
    const settingsPath = path.join(root, ".claude", "settings.json");
    fs.writeFileSync(settingsPath, '{ "model": "opus", }  // trailing comma\n');

    await expect(uninstallRuntime(root, { purge: true, pluginRoot: PLUGIN_ROOT })).rejects.toThrow(/not valid JSON/);

    // Nothing half-removed: a purge that deleted the scripts and then failed to unregister the
    // hooks would leave the project firing hooks at files that no longer exist.
    expect(fs.existsSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"))).toBe(true);
    expect(fs.existsSync(maestroJsonPath(root))).toBe(true);
    expect(fs.existsSync(path.join(root, ".claude", "maestro_session.json"))).toBe(true);
    expect(fs.readFileSync(settingsPath, "utf8")).toContain("trailing comma");
    expect(uninstallPlan(root, PLUGIN_ROOT).settingsUnreadable).toBe(true);
  });
});

describe("purge", () => {
  it("removes the skill, the scripts and the config — and says which files it took", async () => {
    const root = await installed();
    // The .bak a migrated install leaves behind is purge-only too.
    fs.writeFileSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md.bak"), "old prose\n");

    const plan = uninstallPlan(root, PLUGIN_ROOT);
    expect(plan.purgeRemovesConfig).toBe(true);
    expect(plan.purgeFiles).toContain(".claude/maestro.json");
    expect(plan.purgeFiles).toContain(".claude/skills/maestro/SKILL.md");
    expect(plan.purgeFiles).toContain(".claude/skills/maestro/SKILL.md.bak");
    expect(plan.purgeFiles).toContain(".claude/scripts/maestro-session-log.cjs");
    // The confirmation may only name files the user actually has.
    for (const file of plan.purgeFiles) expect(fs.existsSync(path.join(root, file))).toBe(true);

    const report = await uninstallRuntime(root, { purge: true, pluginRoot: PLUGIN_ROOT });

    expect(report.purge).toBe(true);
    expect(report.purged.sort()).toEqual(plan.purgeFiles.sort());
    expect(report.configKept).toBe(false);
    expect(report.warnings.filter((w) => w.includes("could not be deleted"))).toEqual([]);
    expect(report.status.installed).toBe(false);
    expect(report.status.orchestratorSkill).toBe(false);
    expect(report.status.scriptsDir).toBe(false);
    expect(report.status.configFile).toBe(false);
  });

  it("leaves the project as it found it — no empty scaffolding, nothing outside .claude", async () => {
    const root = makeProject("p");
    fs.writeFileSync(path.join(root, "README.md"), "# mine\n");
    await installRuntime(root, PLUGIN_ROOT);
    await uninstallRuntime(root, { purge: true, pluginRoot: PLUGIN_ROOT });

    // .claude has nothing left in it: no orphaned skills/, scripts/, templates/ or settings.json.
    expect(filesUnder(path.join(root, ".claude"))).toEqual([]);
    expect(fs.existsSync(path.join(root, ".claude", "scripts"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude", "skills"))).toBe(false);
    expect(fs.existsSync(path.join(root, ".claude", "templates"))).toBe(false);
    // .claude itself is the user's directory, so it stays; so does everything else in the repo.
    expect(fs.existsSync(path.join(root, "README.md"))).toBe(true);
    // The .gitignore section stays too — it ignores files that no longer exist, and editing the
    // middle of a file the user also writes to is a bigger risk than three stale globs.
    expect(fs.readFileSync(path.join(root, ".gitignore"), "utf8")).toContain("maestro_session.log.jsonl");
  });

  it("does not orphan scripts an older release installed", async () => {
    const root = await installed();
    // A file the current manifest doesn't know about, from a release that shipped it.
    const orphan = path.join(root, ".claude", "scripts", "maestro-retired-hook.cjs");
    fs.writeFileSync(orphan, "// shipped by an older app\n");

    const plan = uninstallPlan(root, PLUGIN_ROOT);
    expect(plan.purgeFiles).toContain(".claude/scripts/maestro-retired-hook.cjs");

    await uninstallRuntime(root, { purge: true, pluginRoot: PLUGIN_ROOT });
    expect(fs.existsSync(orphan)).toBe(false);
  });

  it("never touches .claude/handoffs — the user's override, not an install location", async () => {
    const root = await installed();
    fs.mkdirSync(path.join(root, ".claude", "handoffs", "backend"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "handoffs", "backend", "frontend.md"), "my protocol\n");

    await uninstallRuntime(root, { purge: true, pluginRoot: PLUGIN_ROOT });

    expect(fs.readFileSync(path.join(root, ".claude", "handoffs", "backend", "frontend.md"), "utf8")).toBe(
      "my protocol\n"
    );
    // But the copies the app installed under templates/ are gone.
    expect(fs.existsSync(path.join(root, ".claude", "templates", "handoffs"))).toBe(false);
  });

  it("keeps a settings.json that still has the user's keys in it", async () => {
    const root = makeProject("p");
    fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "settings.json"), JSON.stringify({ model: "opus" }, null, 2));
    await installRuntime(root, PLUGIN_ROOT);

    await uninstallRuntime(root, { purge: true, pluginRoot: PLUGIN_ROOT });

    // Deleting the file is only safe when nothing but our hooks was ever in it.
    expect(readSettings(root)).toEqual({ model: "opus" });
  });
});

describe("the file-based task queue (.claude/maestro-tasks/)", () => {
  function seedTasks(root: string): void {
    const dir = path.join(root, ".claude", "maestro-tasks");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "001-foo.md"), "# Foo\n");
    fs.writeFileSync(path.join(dir, "status.json"), '{"001-foo.md":{"status":"ready","blockedBy":[]}}\n');
  }

  it("is reported at every level, but purgeFiles never carries it", async () => {
    const root = await installed();
    seedTasks(root);

    for (const purge of [false, true]) {
      const plan = uninstallPlan(root, PLUGIN_ROOT);
      expect(plan.maestroTasks).toEqual({ dir: ".claude/maestro-tasks", files: ["001-foo.md"], hasStatusJson: true });
      expect(plan.purgeFiles).not.toContain(".claude/maestro-tasks");
      expect(plan.purgeFiles.some((f) => f.startsWith(".claude/maestro-tasks/"))).toBe(false);
      void purge; // same plan either way — the report doesn't depend on which level is chosen
    }
  });

  it("a plain purge leaves it alone", async () => {
    const root = await installed();
    seedTasks(root);

    const report = await uninstallRuntime(root, { purge: true, pluginRoot: PLUGIN_ROOT });

    expect(report.maestroTasksDeleted).toBe(false);
    expect(report.purged).not.toContain(".claude/maestro-tasks");
    expect(fs.existsSync(path.join(root, ".claude", "maestro-tasks", "001-foo.md"))).toBe(true);
  });

  it("deleteMaestroTasks without purge is rejected rather than silently ignored", async () => {
    const root = await installed();
    seedTasks(root);

    await expect(
      uninstallRuntime(root, { deleteMaestroTasks: true, pluginRoot: PLUGIN_ROOT })
    ).rejects.toThrow(/deleteMaestroTasks requires purge/);
    // Nothing touched — the rejection happens before any deletion.
    expect(fs.existsSync(path.join(root, ".claude", "maestro-tasks", "001-foo.md"))).toBe(true);
  });

  it("purge + deleteMaestroTasks deletes the whole queue in one pass", async () => {
    const root = await installed();
    seedTasks(root);

    const report = await uninstallRuntime(root, { purge: true, deleteMaestroTasks: true, pluginRoot: PLUGIN_ROOT });

    expect(report.maestroTasksDeleted).toBe(true);
    expect(report.purged).toContain(".claude/maestro-tasks");
    expect(fs.existsSync(path.join(root, ".claude", "maestro-tasks"))).toBe(false);
  });

  it("a project with no task queue reports it as empty, and deleteMaestroTasks is a no-op", async () => {
    const root = await installed();

    const plan = uninstallPlan(root, PLUGIN_ROOT);
    expect(plan.maestroTasks).toEqual({ dir: ".claude/maestro-tasks", files: [], hasStatusJson: false });

    const report = await uninstallRuntime(root, { purge: true, deleteMaestroTasks: true, pluginRoot: PLUGIN_ROOT });
    expect(report.maestroTasksDeleted).toBe(false);
    expect(report.purged).not.toContain(".claude/maestro-tasks");
  });
});

describe("a project with nothing installed", () => {
  it("is a no-op that says so, at either level, and writes nothing", async () => {
    const root = makeProject("p");
    const before = filesUnder(root).filter((f) => !f.startsWith(".git/"));

    const plan = uninstallPlan(root, PLUGIN_ROOT);
    expect(plan.empty).toBe(true);
    expect(plan.purgeFiles).toEqual([]);

    for (const purge of [false, true]) {
      const report = await uninstallRuntime(root, { purge, pluginRoot: PLUGIN_ROOT });
      expect(report.noop).toBe(true);
      expect(report.hooksRemoved).toEqual([]);
      expect(report.purged).toEqual([]);
      expect(report.warnings.filter((w) => w.includes("could not be deleted"))).toEqual([]);
    }

    expect(filesUnder(root).filter((f) => !f.startsWith(".git/"))).toEqual(before);
    expect(fs.existsSync(path.join(root, ".claude"))).toBe(false);
  });

  it("rejects a project root that does not exist rather than reporting success", async () => {
    await expect(uninstallRuntime(path.join(tmp, "nope"), { pluginRoot: PLUGIN_ROOT })).rejects.toThrow(
      /does not exist/
    );
  });
});

describe("install after uninstall", () => {
  it("returns a defaulted project to a working installation, config and all", async () => {
    const root = await installed();
    const config = readConfig(root);

    await uninstallRuntime(root, { pluginRoot: PLUGIN_ROOT });
    const report = await installRuntime(root, PLUGIN_ROOT);

    expect(report.hooksAdded.sort()).toEqual(HOOK_REGISTRATIONS.map((h) => h.id).sort());
    expect(report.status.installed).toBe(true);
    expect(report.status.stale).toBe(false);
    expect(readConfig(root)).toEqual(config); // never left, never rewritten
  });

  it("returns a purged project to a working installation", async () => {
    const root = await installed();
    await uninstallRuntime(root, { purge: true, pluginRoot: PLUGIN_ROOT });

    const report = await installRuntime(root, PLUGIN_ROOT);

    expect(report.orchestratorSkill.action).toBe("installed");
    expect(report.status.installed).toBe(true);
    expect(report.status.stale).toBe(false);
    expect(report.status.hooksMissing).toEqual([]);
    // The config is the one thing a purge does not bring back — it was the user's to delete.
    expect(report.status.configFile).toBe(false);
  });
});
