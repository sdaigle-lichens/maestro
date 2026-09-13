// `066` through the REAL installed CLI: plugins/maestro/scripts/maestro-task-status.cjs hand-
// duplicates claims.ts's claim/release logic (there is no plugin-entries/claims.ts — this isn't a
// generated-bundle relationship, see plugin-libs-parity), so the only way to catch the two
// drifting is to exercise equivalent scenarios through both and compare outcomes. Driven exactly
// like per-session-state.test.ts drives maestro-session-log.cjs etc.: a real installed project,
// spawnSync against the installed script, HOME pinned, CLAUDE_CODE_SESSION_ID always explicitly
// set or deleted (never inherited).
//
// Scope split: claims.test.ts owns the exhaustive unit-level behavior of src/core/claims.ts
// (liveness edge cases, EEXIST races, reap-on-read). This file owns "the shipped CLI a Claude Code
// session actually runs behaves the same way," plus the `sync`/`done`/cascade interaction that only
// exists at the CLI/orchestrator layer.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";
import { claimTask, releaseTask, readClaims } from "../../src/core/claims.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

const SESSION_A = "sess-aaa-111";
const SESSION_B = "sess-bbb-222";

let tmp: string;
let REPORTS_DB: string;
let PROJECT_TAGS_DB: string;
let HANDOFFS_DB: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-066-cli-"));
  REPORTS_DB = path.join(tmp, "report-defaults.sqlite");
  PROJECT_TAGS_DB = path.join(tmp, "project-tags.sqlite");
  HANDOFFS_DB = path.join(tmp, "handoff-defaults.sqlite");
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

async function installed(name = "p"): Promise<string> {
  const root = makeProject(name);
  writeConfig(root, defaultish);
  await installRuntime(root, PLUGIN_ROOT, REPORTS_DB, PROJECT_TAGS_DB, HANDOFFS_DB);
  return root;
}

function hookEnv(root: string, sessionId: string | null): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp };
  if (sessionId === null) delete env.CLAUDE_CODE_SESSION_ID;
  else env.CLAUDE_CODE_SESSION_ID = sessionId;
  return env;
}

function cli(root: string, args: string[], sessionId: string | null = SESSION_A) {
  const res = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-task-status.cjs"), ...args], {
    encoding: "utf8",
    env: hookEnv(root, sessionId),
  });
  return { code: res.status ?? -1, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

const tasksDir = (root: string) => path.join(root, ".claude", "maestro-tasks");
const claimPath = (root: string, filename: string) => path.join(tasksDir(root), "claims", `${filename}.json`);
const sessionDir = (root: string, id: string) => path.join(root, ".claude", "maestro_sessions", id);
const logFile = (root: string, id: string) => path.join(sessionDir(root, id), "log.jsonl");

function writeTask(root: string, filename: string, title: string, blockedBy: string[] = []) {
  fs.mkdirSync(tasksDir(root), { recursive: true });
  const body = blockedBy.length
    ? `# ${title}\n\n## Blocked by\n\n${blockedBy.map((b) => `- \`${b}\``).join("\n")}\n`
    : `# ${title}\n\n## Blocked by\n\nNone\n`;
  fs.writeFileSync(path.join(tasksDir(root), filename), body);
}

/** A live session: a real maestro_sessions/<id>/ directory whose log.jsonl was just touched — the
 * CLI resolves its OWN session id the same way (env var only, no stdin), so a `claim`/`release`
 * call needs this to exist for `ownSessionId()` to have anything meaningful to attribute to, and
 * for a WINNING claim to read back as live rather than being reaped on the next look. */
function makeLiveSession(root: string, id: string) {
  fs.mkdirSync(sessionDir(root, id), { recursive: true });
  fs.writeFileSync(logFile(root, id), '{"kind":"tool_call"}\n');
}

describe("maestro-task-status.cjs claim/release/done, through the installed CLI (066)", () => {
  it("claims a task, exits 0, and writes the same claim-file shape claims.ts writes", async () => {
    const root = await installed();
    makeLiveSession(root, SESSION_A);
    writeTask(root, "001-a.md", "A");

    const run = cli(root, ["claim", "001-a.md"], SESSION_A);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("claimed");
    const onDisk = JSON.parse(fs.readFileSync(claimPath(root, "001-a.md"), "utf8"));
    expect(onDisk).toMatchObject({ session_id: SESSION_A, project_root: root });
    expect(typeof onDisk.claimed_at).toBe("string");
  });

  it("a second session's claim attempt loses, exits 0 (not an error), and does not overwrite the file", async () => {
    const root = await installed();
    makeLiveSession(root, SESSION_A);
    makeLiveSession(root, SESSION_B);
    writeTask(root, "001-a.md", "A");

    expect(cli(root, ["claim", "001-a.md"], SESSION_A).code).toBe(0);
    const loser = cli(root, ["claim", "001-a.md"], SESSION_B);

    expect(loser.code).toBe(0); // "take the next ready task instead" — never a thrown/nonzero EEXIST
    expect(loser.stdout).toContain("already claimed");
    expect(loser.stdout).toContain(SESSION_A);
    expect(JSON.parse(fs.readFileSync(claimPath(root, "001-a.md"), "utf8")).session_id).toBe(SESSION_A);
  });

  it("release refuses a foreign claim: exits nonzero, says so on stderr, and leaves the file in place", async () => {
    const root = await installed();
    makeLiveSession(root, SESSION_A);
    makeLiveSession(root, SESSION_B);
    writeTask(root, "001-a.md", "A");
    expect(cli(root, ["claim", "001-a.md"], SESSION_A).code).toBe(0);
    const before = fs.readFileSync(claimPath(root, "001-a.md"), "utf8");

    const run = cli(root, ["release", "001-a.md"], SESSION_B);

    expect(run.code).not.toBe(0);
    expect(run.stderr).toContain("refusing to release");
    expect(fs.existsSync(claimPath(root, "001-a.md"))).toBe(true);
    expect(fs.readFileSync(claimPath(root, "001-a.md"), "utf8")).toBe(before); // byte-for-byte untouched
  });

  it("release succeeds for the owning session and removes the file", async () => {
    const root = await installed();
    makeLiveSession(root, SESSION_A);
    writeTask(root, "001-a.md", "A");
    expect(cli(root, ["claim", "001-a.md"], SESSION_A).code).toBe(0);

    const run = cli(root, ["release", "001-a.md"], SESSION_A);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("released");
    expect(fs.existsSync(claimPath(root, "001-a.md"))).toBe(false);
  });

  it("a claim for a session with no directory (removed / clean SessionEnd) is reaped, letting a new session win", async () => {
    const root = await installed();
    writeTask(root, "001-a.md", "A");
    fs.mkdirSync(path.join(tasksDir(root), "claims"), { recursive: true });
    fs.writeFileSync(
      claimPath(root, "001-a.md"),
      JSON.stringify({ session_id: SESSION_A, claimed_at: new Date().toISOString(), project_root: root })
    );
    // No maestro_sessions/SESSION_A directory anywhere.
    makeLiveSession(root, SESSION_B);

    const run = cli(root, ["claim", "001-a.md"], SESSION_B);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("claimed");
    expect(run.stdout).not.toContain("already claimed");
    expect(JSON.parse(fs.readFileSync(claimPath(root, "001-a.md"), "utf8")).session_id).toBe(SESSION_B);
  });

  it("a claim with a stale log mtime is reaped, letting a new session win", async () => {
    const root = await installed();
    writeTask(root, "001-a.md", "A");
    makeLiveSession(root, SESSION_A);
    const stale = new Date(Date.now() - 20 * 60 * 1000); // 20 minutes, past the 15-minute cap
    fs.utimesSync(logFile(root, SESSION_A), stale, stale);
    fs.mkdirSync(path.join(tasksDir(root), "claims"), { recursive: true });
    fs.writeFileSync(
      claimPath(root, "001-a.md"),
      JSON.stringify({ session_id: SESSION_A, claimed_at: stale.toISOString(), project_root: root })
    );
    makeLiveSession(root, SESSION_B);

    const run = cli(root, ["claim", "001-a.md"], SESSION_B);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("claimed");
    expect(run.stdout).not.toContain("already claimed");
    expect(JSON.parse(fs.readFileSync(claimPath(root, "001-a.md"), "utf8")).session_id).toBe(SESSION_B);
  });

  it("a claim with a fresh log mtime is NOT reaped — the second session is told, not let through", async () => {
    const root = await installed();
    writeTask(root, "001-a.md", "A");
    makeLiveSession(root, SESSION_A); // fresh mtime
    makeLiveSession(root, SESSION_B);
    expect(cli(root, ["claim", "001-a.md"], SESSION_A).code).toBe(0);

    const run = cli(root, ["claim", "001-a.md"], SESSION_B);

    expect(run.code).toBe(0);
    expect(run.stdout).toContain("already claimed");
    expect(JSON.parse(fs.readFileSync(claimPath(root, "001-a.md"), "utf8")).session_id).toBe(SESSION_A);
  });

  it("done releases the claim and still runs the normal ready/blocked cascade", async () => {
    const root = await installed();
    makeLiveSession(root, SESSION_A);
    writeTask(root, "001-a.md", "A");
    writeTask(root, "002-b.md", "B", ["001-a.md"]);
    expect(cli(root, ["sync"]).code).toBe(0);
    expect(cli(root, ["claim", "001-a.md"], SESSION_A).code).toBe(0);

    const run = cli(root, ["done", "001-a.md"], SESSION_A);

    expect(run.code).toBe(0);
    expect(fs.existsSync(claimPath(root, "001-a.md"))).toBe(false); // 066: nothing left for it to protect
    const status = JSON.parse(fs.readFileSync(path.join(tasksDir(root), "status.json"), "utf8"));
    expect(status["001-a.md"].status).toBe("done");
    expect(status["002-b.md"].status).toBe("ready"); // cascade unaffected by there having been a claim
  });

  it("claiming, releasing and syncing never touch status.json's cascade fields", async () => {
    const root = await installed();
    makeLiveSession(root, SESSION_A);
    writeTask(root, "001-a.md", "A");
    writeTask(root, "002-b.md", "B", ["001-a.md"]);
    expect(cli(root, ["sync"]).code).toBe(0);
    const before = fs.readFileSync(path.join(tasksDir(root), "status.json"), "utf8");

    expect(cli(root, ["claim", "001-a.md"], SESSION_A).code).toBe(0);
    expect(cli(root, ["release", "001-a.md"], SESSION_A).code).toBe(0);

    const after = fs.readFileSync(path.join(tasksDir(root), "status.json"), "utf8");
    expect(after).toBe(before); // claiming/releasing never writes status.json at all
  });
});

// ── semantic parity: same scenario, claims.ts vs. the installed CLI (066) ───────────────────────
//
// The two are hand-duplicated implementations with no shared bundle (there is no
// plugin-entries/claims.ts — see plugin-libs-parity's "twelve generated entries" list, which does
// not include claims). parity.test.ts's existing patterns (legacy-snapshot diff, bundle export
// assertion, STATIC_ASSETS manifest diff) don't fit a feature with no ported/generated file, so
// this is a behavioral parity check instead: drive the same fixture through claims.ts directly and
// through the CLI, and assert they reach the same verdict.

describe("claims.ts and maestro-task-status.cjs agree on outcomes (066 parity)", () => {
  it("both refuse to hand a live claim to a second session, and both let a new one win once it's stale", async () => {
    const tsRoot = await installed("ts-side");
    const cliRoot = await installed("cli-side");
    for (const root of [tsRoot, cliRoot]) {
      makeLiveSession(root, SESSION_A);
      makeLiveSession(root, SESSION_B);
      writeTask(root, "001-a.md", "A");
    }

    // Winner claims via claims.ts directly; the CLI claims the same scenario in its own project.
    const tsFirst = claimTask(tsRoot, tasksDir(tsRoot), "001-a.md", SESSION_A);
    const cliFirst = cli(cliRoot, ["claim", "001-a.md"], SESSION_A);
    expect(tsFirst).toEqual({ outcome: "claimed" });
    expect(cliFirst.code).toBe(0);

    // Loser: claims.ts returns a typed already-claimed result; the CLI says so on stdout, exit 0.
    const tsSecond = claimTask(tsRoot, tasksDir(tsRoot), "001-a.md", SESSION_B);
    const cliSecond = cli(cliRoot, ["claim", "001-a.md"], SESSION_B);
    expect(tsSecond.outcome).toBe("already-claimed");
    expect(cliSecond.code).toBe(0);
    expect(cliSecond.stdout).toContain("already claimed");

    // Go stale in both, the same way (utimesSync past the cap), and confirm both now hand the
    // claim to the second session instead of continuing to refuse it.
    const stale = new Date(Date.now() - 20 * 60 * 1000);
    fs.utimesSync(logFile(tsRoot, SESSION_A), stale, stale);
    fs.utimesSync(logFile(cliRoot, SESSION_A), stale, stale);

    const tsThird = claimTask(tsRoot, tasksDir(tsRoot), "001-a.md", SESSION_B);
    const cliThird = cli(cliRoot, ["claim", "001-a.md"], SESSION_B);
    expect(tsThird).toEqual({ outcome: "claimed" });
    expect(cliThird.code).toBe(0);
    expect(cliThird.stdout).not.toContain("already claimed");
  });

  it("both refuse release to a non-owning session and leave the claim file untouched", async () => {
    const tsRoot = await installed("ts-side-2");
    const cliRoot = await installed("cli-side-2");
    for (const root of [tsRoot, cliRoot]) {
      makeLiveSession(root, SESSION_A);
      writeTask(root, "001-a.md", "A");
    }

    claimTask(tsRoot, tasksDir(tsRoot), "001-a.md", SESSION_A);
    cli(cliRoot, ["claim", "001-a.md"], SESSION_A);

    const tsResult = releaseTask(tasksDir(tsRoot), "001-a.md", SESSION_B);
    const cliResult = cli(cliRoot, ["release", "001-a.md"], SESSION_B);

    expect(tsResult).toBe("not-owner");
    expect(cliResult.code).not.toBe(0);
    expect(fs.existsSync(claimPath(tsRoot, "001-a.md"))).toBe(true);
    expect(fs.existsSync(claimPath(cliRoot, "001-a.md"))).toBe(true);
  });

  it("both reap a claim for a session whose directory was removed, on the very next look", async () => {
    const tsRoot = await installed("ts-side-3");
    const cliRoot = await installed("cli-side-3");
    for (const root of [tsRoot, cliRoot]) {
      writeTask(root, "001-a.md", "A");
      fs.mkdirSync(path.join(tasksDir(root), "claims"), { recursive: true });
      fs.writeFileSync(
        claimPath(root, "001-a.md"),
        JSON.stringify({ session_id: SESSION_A, claimed_at: new Date().toISOString(), project_root: root })
      );
      makeLiveSession(root, SESSION_B);
    }

    const tsClaims = readClaims(tsRoot, tasksDir(tsRoot));
    expect(tsClaims.get("001-a.md")).toMatchObject({ live: false });
    expect(fs.existsSync(claimPath(tsRoot, "001-a.md"))).toBe(false);

    const cliRun = cli(cliRoot, ["claim", "001-a.md"], SESSION_B); // the CLI's own reap-then-create path
    expect(cliRun.code).toBe(0);
    expect(cliRun.stdout).toContain("claimed");
    expect(cliRun.stdout).not.toContain("already claimed");
  });
});
