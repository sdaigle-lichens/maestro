// `152` item 1: `readGlobalHandoff` is defined once (src/core/global-handoff.ts, bundled into the
// copied lib/maestro-session.cjs) and every hook that resolves a payload route reads the global
// sqlite tier through it. These tests run the INSTALLED copies in a temp project with a temp HOME:
// the copied lib is required by a real node child, the copied hooks are spawned with a synthetic
// payload, and the store is a real sqlite file written with the app's own writer. The
// missing-bundle arm deletes the copied sqlite lib, which is what an old `node` amounts to at the
// require.
//
// Also covers the SubagentStop side of item 6: the stop hook can fire twice for one run, and the
// missing-payload issue must be listed once.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { writeHandoffDefault } from "../../src/core/handoff-defaults.js";
import { SEED_HANDOFFS } from "../../src/core/handoff-seeds.js";
import { defaultish } from "./fixtures/configs.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

const SESS = "sess-152-aaa";
const GLOBAL_MARKER = "GLOBAL-TIER-152-PROTOCOL";

let tmp: string;
let home: string;
let store: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-152-global-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  store = path.join(home, ".claude", "maestro-handoff-defaults.sqlite");
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** A hook or CLI run with HOME pinned and the session id set explicitly (never inherited). */
function hook(root: string, script: string, payload: unknown, sessionId: string | null = SESS) {
  const extra: NodeJS.ProcessEnv = { CLAUDE_PROJECT_DIR: root };
  if (sessionId !== null) extra.CLAUDE_CODE_SESSION_ID = sessionId;
  const r = spawnSync("node", [path.join(root, ".claude", "scripts", script)], {
    encoding: "utf8",
    input: JSON.stringify(payload),
    env: pinnedEnv(home, extra),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

async function installed(name = "repo"): Promise<string> {
  const root = path.join(tmp, name);
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeConfig(root, defaultish);
  // Every DB is isolated: the install must never read the developer's real stores.
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults-install.sqlite")
  );
  return root;
}

/** Calls `readGlobalHandoff` on the COPIED lib in a fresh node process, HOME pinned. */
function readGlobalFromCopiedLib(root: string, id: string) {
  const lib = path.join(root, ".claude", "scripts", "lib", "maestro-session.cjs");
  const code = `const s = require(process.argv[1]); process.stdout.write(JSON.stringify(s.readGlobalHandoff(process.argv[2])));`;
  const r = spawnSync("node", ["-e", code, lib, id], { encoding: "utf8", env: pinnedEnv(home) });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function injectContext(root: string, agent: string): string {
  const r = hook(root, "maestro-inject-agent-context.cjs", {
    cwd: root,
    session_id: SESS,
    hook_event_name: "SubagentStart",
    agent_type: agent,
    agent_id: `${agent}-1`,
  });
  expect(r.code, r.stderr).toBe(0);
  if (!r.stdout.trim()) return "";
  return JSON.parse(r.stdout).hookSpecificOutput.additionalContext as string;
}

const sessionState = (root: string) =>
  JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro_sessions", SESS, "session.json"), "utf8"));

const subagentStart = (root: string, agent: string, id: string) =>
  hook(root, "maestro-subagent-log.cjs", {
    cwd: root,
    session_id: SESS,
    hook_event_name: "SubagentStart",
    agent_type: agent,
    agent_id: id,
  });

const subagentStop = (root: string, agent: string, id: string) =>
  hook(root, "maestro-subagent-log.cjs", {
    cwd: root,
    session_id: SESS,
    hook_event_name: "SubagentStop",
    agent_type: agent,
    agent_id: id,
    // A success route with no payload file written: the only thing the stop hook can flag here.
    last_assistant_message: '"verdict": "SUCCESS"\nHANDOFF: success',
  });

describe("readGlobalHandoff in an installed project (152 item 1)", () => {
  it("reads a global row through the copied lib", async () => {
    const root = await installed();
    writeHandoffDefault("backend/test", GLOBAL_MARKER, store);

    const r = readGlobalFromCopiedLib(root, "backend/test");
    expect(r.code, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ content: GLOBAL_MARKER });
  });

  it("returns null for a valid id with no global row", async () => {
    const root = await installed();
    writeHandoffDefault("backend/test", GLOBAL_MARKER, store);

    const r = readGlobalFromCopiedLib(root, "backend/scribe");
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe("null");
  });

  it("returns null, without throwing, when the copied sqlite bundle is missing", async () => {
    const root = await installed();
    writeHandoffDefault("backend/test", GLOBAL_MARKER, store);
    fs.rmSync(path.join(root, ".claude", "scripts", "lib", "maestro-handoff-defaults.cjs"));

    // The session lib itself must still load: the sqlite bundle is only ever required lazily.
    const r = readGlobalFromCopiedLib(root, "backend/test");
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toBe("null");
  });

  it("keeps node:sqlite out of the copied session lib (the bundling trap readGlobalHandoff avoids)", async () => {
    const root = await installed();
    const bundle = fs.readFileSync(path.join(root, ".claude", "scripts", "lib", "maestro-session.cjs"), "utf8");
    expect(bundle).toContain("readGlobalHandoff");
    expect(bundle).not.toContain("node:sqlite");
  });

  it("the source function answers null outside the CJS bundle, where `require` is not the bundle's", async () => {
    // Vitest/app context: the relative require is not resolvable from src/core, so it must be caught.
    const mod = await import("../../src/core/global-handoff.js");
    expect(mod.readGlobalHandoff("backend/test")).toBeNull();
  });
});

describe("the copied hooks resolve the global tier and survive a missing bundle (152 item 1)", () => {
  it("the SubagentStart injection uses a global row over the seed", async () => {
    const root = await installed();
    // Written AFTER install so the project copy cannot be what answers: remove it, then ask.
    writeHandoffDefault("backend/test", GLOBAL_MARKER, store);
    fs.rmSync(path.join(root, ".claude", "handoffs"), { recursive: true, force: true });

    const context = injectContext(root, "backend");
    expect(context).toContain(GLOBAL_MARKER);
  });

  it("with the bundle deleted, the same injection falls through to the shipped seed, not the global row", async () => {
    const root = await installed();
    writeHandoffDefault("backend/test", GLOBAL_MARKER, store);
    fs.rmSync(path.join(root, ".claude", "handoffs"), { recursive: true, force: true });
    fs.rmSync(path.join(root, ".claude", "scripts", "lib", "maestro-handoff-defaults.cjs"));

    const context = injectContext(root, "backend");
    expect(context).not.toContain(GLOBAL_MARKER);
    expect(context).toContain(SEED_HANDOFFS["backend/test"]);
  });

  it("SubagentStop with the bundle deleted still flags the missing payload from the seed route", async () => {
    const root = await installed();
    fs.rmSync(path.join(root, ".claude", "scripts", "lib", "maestro-handoff-defaults.cjs"));

    expect(subagentStart(root, "backend", "b-missing").code).toBe(0);
    const stop = subagentStop(root, "backend", "b-missing");
    expect(stop.code, stop.stderr).toBe(0);

    const issues = sessionState(root).handoff_issues as Array<Record<string, unknown>>;
    const missing = issues.filter((i) => i.kind === "missing_payload");
    expect(missing).toHaveLength(1);
    expect(missing[0].agent_id).toBe("b-missing");
    expect((missing[0].files as string[])[0]).toMatch(/session-sess-152\/test\/backend\.1\.md$/);
  });
});

describe("the stop hook firing twice for one run (152 item 6, adversarial)", () => {
  it("a second stop for the same run does not add a second missing_payload", async () => {
    const root = await installed();
    expect(subagentStart(root, "backend", "b-dup").code).toBe(0);
    expect(subagentStop(root, "backend", "b-dup").code).toBe(0);
    expect(subagentStop(root, "backend", "b-dup").code).toBe(0);

    const issues = sessionState(root).handoff_issues as Array<Record<string, unknown>>;
    expect(issues.filter((i) => i.kind === "missing_payload" && i.agent_id === "b-dup")).toHaveLength(1);
  });

  it("a different run of the same route is a different issue and is still listed", async () => {
    const root = await installed();
    expect(subagentStart(root, "backend", "b-one").code).toBe(0);
    expect(subagentStop(root, "backend", "b-one").code).toBe(0);
    expect(subagentStart(root, "backend", "b-two").code).toBe(0);
    expect(subagentStop(root, "backend", "b-two").code).toBe(0);

    const issues = sessionState(root).handoff_issues as Array<Record<string, unknown>>;
    const ids = issues.filter((i) => i.kind === "missing_payload").map((i) => i.agent_id);
    expect(ids.sort()).toEqual(["b-one", "b-two"]);
  });
});
