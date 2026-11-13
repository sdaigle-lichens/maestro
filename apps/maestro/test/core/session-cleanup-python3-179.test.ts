// `179`: the plugin's SessionEnd twin `maestro-session-cleanup.sh` reads every field of its payload with
// python3. With python3 missing the reads yield "" and the script used to exit 0 having removed nothing,
// silently. It now says so on stderr and still exits 0. This runs the REAL script in a child process whose
// PATH holds only `bash` and `cat` (the two commands it needs before the check), so python3 is absent by
// construction, not by accident of the host. HOME and CLAUDE_CODE_SESSION_ID are pinned via pinnedEnv.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { findUpPluginRoot } from "../../src/core/install.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const SCRIPT = path.join(PLUGIN_ROOT, "scripts", "maestro-session-cleanup.sh");
const SID = "sess-179-py3";
const MISSING = "python3 is not installed or not on PATH";

let tmp: string;
let root: string;
let home: string;

/** Absolute path of a command as the host sees it, or null. */
function hostCommand(name: string): string | null {
  const r = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" });
  const p = (r.stdout ?? "").trim();
  return r.status === 0 && p.startsWith("/") ? p : null;
}

/** A session's own state directory, as the cleanup would remove it on a final end. */
function seedSessionState(): string {
  const dir = path.join(root, ".claude", "maestro_sessions", SID);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({ workflow: "feature" }));
  return dir;
}

/** Runs the plugin script with the given PATH, feeding the payload Claude Code sends on SessionEnd. */
function runCleanup(pathValue: string) {
  const bash = hostCommand("bash");
  if (!bash) throw new Error("bash is not on the host PATH");
  const payload = { cwd: root, session_id: SID, hook_event_name: "SessionEnd", reason: "clear" };
  const r = spawnSync(bash, [SCRIPT], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: pinnedEnv(home, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: SID, PATH: pathValue }),
  });
  return { code: r.status ?? -1, stderr: r.stderr ?? "", stdout: r.stdout ?? "" };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-179-py3-"));
  root = path.join(tmp, "project");
  home = path.join(tmp, "home");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(home, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("179: maestro-session-cleanup.sh with python3 missing says so instead of failing silently", () => {
  it("exits 0, names the missing interpreter on stderr, and removes nothing when PATH has no python3", () => {
    const cat = hostCommand("cat");
    const bash = hostCommand("bash");
    expect(cat).not.toBeNull();
    expect(bash).not.toBeNull();

    // A PATH that holds bash and cat and nothing else: no python3 anywhere on it.
    const bin = path.join(tmp, "bin");
    fs.mkdirSync(bin);
    fs.symlinkSync(cat!, path.join(bin, "cat"));
    fs.symlinkSync(bash!, path.join(bin, "bash"));
    expect(fs.existsSync(path.join(bin, "python3"))).toBe(false);

    const state = seedSessionState();
    const run = runCleanup(bin);

    expect(run.code).toBe(0);
    expect(run.stderr).toContain(MISSING);
    expect(run.stderr).toContain("removed no session state");
    // The message is the visible signal; the state really was left in place, which is what it claims.
    expect(fs.existsSync(path.join(state, "session.json"))).toBe(true);
  });

  const hasPython3 = hostCommand("python3") !== null;
  it.skipIf(!hasPython3)(
    "positive control: with python3 on PATH the same payload removes the session and prints no message",
    () => {
      const state = seedSessionState();
      const run = runCleanup(process.env.PATH ?? "");

      expect(run.code).toBe(0);
      expect(run.stderr).not.toContain(MISSING);
      expect(fs.existsSync(state)).toBe(false);
    }
  );
});
