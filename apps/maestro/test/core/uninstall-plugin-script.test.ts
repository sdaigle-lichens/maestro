// `060` — the terminal uninstall (plugins/maestro/scripts/maestro-uninstall.js) used to hand-type
// its own hook-script list and purge-target list, which fell four assets behind the installer's:
// maestro-agent-forks.cjs, maestro-resume-target.cjs, maestro-step1-gates.cjs and
// maestro-step4-gate.cjs. A purge on a project installed by the CURRENT release reported success
// while leaving those four scripts on disk and two live hook registrations in settings.json — this
// suite is the case that would have failed before the fix (the uninstaller now derives both lists
// from maestro-install.js's own manifest instead of re-typing them).
//
// Both scripts are run as real subprocesses against a project installed by the REAL installer, the
// same pattern real-project.test.ts uses, so a manifest this test does not itself enumerate is
// still covered.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_SCRIPTS = path.resolve(here, "../../../../plugins/maestro/scripts");
const INSTALLER = path.join(PLUGIN_SCRIPTS, "maestro-install.js");
const UNINSTALLER = path.join(PLUGIN_SCRIPTS, "maestro-uninstall.js");

// The four assets that fell behind the hand-typed lists — named explicitly so a future regression
// on any one of them fails by name rather than by a generic "something survived" count.
const PREVIOUSLY_ORPHANED_SCRIPTS = [
  "maestro-agent-forks.cjs",
  "maestro-resume-target.cjs",
  "maestro-step1-gates.cjs",
  "maestro-step4-gate.cjs",
];

let tmp: string;
let root: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-uninstall-plugin-"));
  root = path.join(tmp, "project");
  fs.mkdirSync(path.join(root, "src", "backend"), { recursive: true });
  execFileSync("node", [INSTALLER, root], { encoding: "utf8", env: { ...process.env, HOME: tmp } });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("maestro-uninstall.js --purge against a really-installed project", () => {
  it("installs the four previously-orphaned scripts in the first place", () => {
    for (const name of PREVIOUSLY_ORPHANED_SCRIPTS) {
      expect(fs.existsSync(path.join(root, ".claude", "scripts", name)), name).toBe(true);
    }
  });

  it("leaves no Maestro script in .claude/scripts/ after a purge", () => {
    execFileSync("node", [UNINSTALLER, root, "--purge"], { encoding: "utf8", env: { ...process.env, HOME: tmp } });

    for (const name of PREVIOUSLY_ORPHANED_SCRIPTS) {
      expect(fs.existsSync(path.join(root, ".claude", "scripts", name)), name).toBe(false);
    }
    // Nothing installed should be left anywhere under .claude/scripts/, recursively — the
    // directory itself isn't pruned by this script (only the app's uninstall.ts does that), but no
    // file the installer wrote may survive.
    const scriptsDir = path.join(root, ".claude", "scripts");
    const remaining: string[] = [];
    const walk = (dir: string) => {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else remaining.push(path.relative(scriptsDir, full));
      }
    };
    walk(scriptsDir);
    expect(remaining).toEqual([]);
  });

  it("leaves no Maestro hook in settings.json after a purge, and reports removedHooks: true", () => {
    const out = JSON.parse(
      execFileSync("node", [UNINSTALLER, root, "--purge"], { encoding: "utf8", env: { ...process.env, HOME: tmp } })
    );
    expect(out.removedHooks).toBe(true);

    const settingsPath = path.join(root, ".claude", "settings.json");
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      const text = JSON.stringify(settings.hooks ?? {});
      expect(text).not.toContain(".claude/scripts/");
    }
  });

  it("does not delete a file in .claude/scripts/ the install never wrote", () => {
    fs.writeFileSync(path.join(root, ".claude", "scripts", "my-own-script.cjs"), "// mine\n");

    execFileSync("node", [UNINSTALLER, root, "--purge"], { encoding: "utf8", env: { ...process.env, HOME: tmp } });

    expect(fs.existsSync(path.join(root, ".claude", "scripts", "my-own-script.cjs"))).toBe(true);
  });

  it("still removes a script an OLDER release left behind that the current manifest no longer lists", () => {
    // Simulate an orphan from a release before this one shipped some script under the app's own
    // maestro- namespace but outside the current STATIC_ASSETS/HOOK_REGISTRATIONS manifest.
    fs.writeFileSync(path.join(root, ".claude", "scripts", "maestro-long-retired-script.cjs"), "// old\n");

    execFileSync("node", [UNINSTALLER, root, "--purge"], { encoding: "utf8", env: { ...process.env, HOME: tmp } });

    expect(fs.existsSync(path.join(root, ".claude", "scripts", "maestro-long-retired-script.cjs"))).toBe(false);
  });

  it("still keys hook removal on the script basename inside a hand-requoted command", () => {
    const settingsPath = path.join(root, ".claude", "settings.json");
    const settings = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    // Re-quote one of the Maestro commands the way a user hand-editing the file might.
    let requoted = false;
    for (const entries of Object.values(settings.hooks ?? {})) {
      for (const entry of entries as Array<{ hooks?: Array<{ command?: string }> }>) {
        for (const h of entry.hooks ?? []) {
          if (h.command && h.command.includes("maestro-session-log.cjs") && !requoted) {
            h.command = `node '${h.command.split('"')[1]}'`; // single-quoted instead of double
            requoted = true;
          }
        }
      }
    }
    expect(requoted).toBe(true);
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    const out = JSON.parse(
      execFileSync("node", [UNINSTALLER, root], { encoding: "utf8", env: { ...process.env, HOME: tmp } })
    );
    expect(out.removedHooks).toBe(true);

    const after = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
    expect(JSON.stringify(after.hooks ?? {})).not.toContain("maestro-session-log.cjs");
  });
});
