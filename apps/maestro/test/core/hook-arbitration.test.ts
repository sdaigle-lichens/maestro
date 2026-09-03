// Which copy of a hook runs when both delivery paths are live — the pure half.
//
// The wired-up half (the plugin's REAL scripts standing down against a REAL install) is in
// install.test.ts's "the plugin's own copy stands down" block; a pure test cannot prove the guard
// is actually called.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { projectOwnsHook, projectTwinName, settingsRegisterScript } from "../../src/core/hook-arbitration.js";

let tmp: string;
let project: string;
/** Stands in for the marketplace cache the plugin's hooks actually run from. */
let pluginScripts: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-arb-"));
  project = path.join(tmp, "project");
  pluginScripts = path.join(tmp, "cache", "maestro", "0.3.3", "scripts");
  fs.mkdirSync(path.join(project, ".claude", "scripts"), { recursive: true });
  fs.mkdirSync(pluginScripts, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeSettings(file: string, settings: unknown): void {
  fs.writeFileSync(path.join(project, ".claude", file), JSON.stringify(settings, null, 2));
}

/** settings.json as an install writes it: the project's own copy, on that event. */
function registering(event: string, command: string): unknown {
  return { hooks: { [event]: [{ matcher: ".*", hooks: [{ type: "command", command }] }] } };
}

const PLUGIN_COPY = () => path.join(pluginScripts, "maestro-session-log.js");
const PROJECT_COPY = () => path.join(project, ".claude", "scripts", "maestro-session-log.cjs");
const REGISTERED = 'node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-session-log.cjs"';

describe("projectTwinName", () => {
  it("maps every shipped extension onto the .cjs the installer copies", () => {
    expect(projectTwinName("/x/maestro-session-log.js")).toBe("maestro-session-log.cjs");
    expect(projectTwinName("/x/maestro-set-session-workflow.cjs")).toBe("maestro-set-session-workflow.cjs");
    // The SessionEnd pair is the one where the extensions differ on the two sides.
    expect(projectTwinName("/x/maestro-session-cleanup.sh")).toBe("maestro-session-cleanup.cjs");
  });
});

describe("settingsRegisterScript", () => {
  it("matches on the basename anywhere in the command, however the user quoted it", () => {
    for (const command of [
      'node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-session-log.cjs"',
      "node $CLAUDE_PROJECT_DIR/.claude/scripts/maestro-session-log.cjs",
      "node '/abs/path/.claude/scripts/maestro-session-log.cjs' --flag",
    ]) {
      const settings = registering("PreToolUse", command) as Parameters<typeof settingsRegisterScript>[0];
      expect(settingsRegisterScript(settings, "PreToolUse", "maestro-session-log.cjs")).toBe(true);
    }
  });

  it("is scoped to the event, so one registration doesn't answer for another", () => {
    const settings = registering("PreToolUse", REGISTERED) as Parameters<typeof settingsRegisterScript>[0];
    expect(settingsRegisterScript(settings, "SubagentStart", "maestro-session-log.cjs")).toBe(false);
  });
});

describe("projectOwnsHook", () => {
  it("stands the plugin's copy down when the project registers the same hook", () => {
    writeSettings("settings.json", registering("PreToolUse", REGISTERED));
    expect(projectOwnsHook(PLUGIN_COPY(), project, "PreToolUse")).toBe(true);
  });

  it("leaves the plugin's copy running for a project that registers nothing", () => {
    // The case the plugin's global hooks exist to serve — nothing may be suppressed here.
    writeSettings("settings.json", { hooks: {} });
    expect(projectOwnsHook(PLUGIN_COPY(), project, "PreToolUse")).toBe(false);
    fs.rmSync(path.join(project, ".claude", "settings.json"));
    expect(projectOwnsHook(PLUGIN_COPY(), project, "PreToolUse")).toBe(false);
  });

  it("keys on the REGISTRATION, not on the twin file existing", () => {
    // Exactly the state a plain `/maestro-uninstall` leaves: the copies are still on disk (only
    // --purge deletes them) and nothing runs them. Standing down here would turn Maestro off
    // altogether instead of falling back to the plugin.
    fs.writeFileSync(PROJECT_COPY(), "// left behind by a non-purging uninstall\n");
    writeSettings("settings.json", { hooks: {} });
    expect(fs.existsSync(PROJECT_COPY())).toBe(true);
    expect(projectOwnsHook(PLUGIN_COPY(), project, "PreToolUse")).toBe(false);
  });

  it("never stands down the project's own copy", () => {
    // One source file is both the plugin's script and the copy installed into a project, so the
    // guard has to recognise which one it is running as — or the project's copy suppresses itself
    // on its own registration and no hook fires at all.
    writeSettings("settings.json", registering("PreToolUse", REGISTERED));
    expect(projectOwnsHook(PROJECT_COPY(), project, "PreToolUse")).toBe(false);
  });

  it("honours a registration a user moved to settings.local.json", () => {
    writeSettings("settings.local.json", registering("PreToolUse", REGISTERED));
    expect(projectOwnsHook(PLUGIN_COPY(), project, "PreToolUse")).toBe(true);
  });

  it("considers every event when the payload carries no hook_event_name", () => {
    writeSettings("settings.json", registering("PreToolUse", REGISTERED));
    expect(projectOwnsHook(PLUGIN_COPY(), project)).toBe(true);
  });

  it("does not stand down on a registration for a different event", () => {
    // Per-hook precedence: a partial install still gets the plugin covering what it left out,
    // rather than one hook silently never firing.
    writeSettings("settings.json", registering("SubagentStart", REGISTERED));
    expect(projectOwnsHook(PLUGIN_COPY(), project, "PreToolUse")).toBe(false);
  });

  it("runs the plugin's copy when settings.json is unparseable", () => {
    // Claude Code isn't running the project's hooks off a broken settings file either, so the
    // plugin's copy is the only one that can do the work.
    fs.writeFileSync(path.join(project, ".claude", "settings.json"), "{ not json");
    expect(projectOwnsHook(PLUGIN_COPY(), project, "PreToolUse")).toBe(false);
  });

  it("is false with no cwd to check against", () => {
    expect(projectOwnsHook(PLUGIN_COPY(), "", "PreToolUse")).toBe(false);
  });
});
