// Team meeting — a scripted dry run of the moderator's tool sequence (`082`).
//
// The agenda confirmation, the mid-meeting checkpoint and the owner-run dispatch exist as SKILL.md
// instructions only: the moderator is a model, so nothing can execute them. What CAN be executed is
// the sequence of CLI calls and participant file writes each branch of those instructions turns into,
// against the real plugin script and the real installed hooks. This drives every branch:
//
//   start -> brief -> [agenda: change participants | cancel]
//         -> round 1 -> [checkpoint: redirect | stop | continue]
//         -> conflicts -> tally -> end -> owner-runs (planned only after close)
//
// and asserts the property the SKILL promises for a cancelled or stopped meeting: it closes
// cleanly (flag gone, participants confined no longer) and applies nothing (maestro.json, handoff
// templates and every project file byte-identical, no tally, nothing for apply-placement or
// owner-runs to act on).
//
// Every spawn pins HOME at this test's tmp dir and sets the session id explicitly (`064`).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";
import { pinnedEnv } from "../helpers/env.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const PLUGIN_SCRIPTS = path.join(PLUGIN_ROOT, "scripts");
const SESSION = "sess-dry-run-1";

const succ = (from: string, to: string) =>
  ({ from, to, kind: "success", sourceHandle: "bottom", targetHandle: "top" }) as const;

const CFG: MaestroConfigV3 = {
  version: 3,
  agents_available: ["backend", "frontend"],
  skills_available: ["expressjs", "react"],
  workflow_instances: [
    { name: "backend", agent: "backend", loaded_skills: ["expressjs"], referenced_skills: [] },
    { name: "frontend", agent: "frontend", loaded_skills: ["react"], referenced_skills: [] },
  ],
  workflows: [
    {
      name: "build",
      nodes: [
        { id: "backend", type: "agent", instance: "backend", position: { x: 0, y: 100 } },
        { id: "frontend", type: "agent", instance: "frontend", position: { x: 0, y: 220 } },
      ],
      edges: [succ("main-session", "backend"), succ("backend", "frontend")],
    },
  ],
  rules: [],
} as unknown as MaestroConfigV3;

let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-meeting-dry-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const env = (root: string) => pinnedEnv(tmp, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: SESSION });

async function project(): Promise<string> {
  const root = path.join(tmp, "p");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root, stdio: "ignore" });
  writeConfig(root, CFG);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  const rendered = spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-render-orchestrator.cjs"), root], {
    encoding: "utf8",
    env: env(root),
  });
  expect(rendered.status, rendered.stderr).toBe(0);
  fs.mkdirSync(path.join(root, ".claude", "handoffs", "backend"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "handoffs", "backend", "frontend.md"), "ORIGINAL TEMPLATE");
  return root;
}

/** One moderator tool call: `TM <args> <root>`. */
function tm(root: string, ...args: string[]) {
  const r = spawnSync("node", [path.join(PLUGIN_SCRIPTS, "maestro-team-meeting.cjs"), ...args, root], {
    encoding: "utf8",
    env: env(root),
  });
  return { code: r.status ?? -1, out: JSON.parse(r.stdout || "{}") as Record<string, any>, stderr: r.stderr };
}

const sessionDir = (root: string) => path.join(root, ".claude", "maestro_sessions", SESSION);
const sessionState = (root: string) => JSON.parse(fs.readFileSync(path.join(sessionDir(root), "session.json"), "utf8"));

/** What a participant does in its turn: write its own round file inside the meeting directory. */
function fileRound(meetingDir: string, round: number, agent: string, proposals: object[]) {
  const dir = path.join(meetingDir, `round-${round}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${agent}.json`), JSON.stringify({ agent, round, proposals }));
}

const placement = (id: string, target: string, to: "loaded" | "referenced") => ({
  id,
  kind: "skill.placement",
  target,
  change: `move to ${to}`,
  rationale: "r",
  evidence: "e",
  to,
});

/** Every file the meeting could have changed, as bytes, to compare before and after. */
function projectFingerprint(root: string): Record<string, string> {
  return {
    config: fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8"),
    handoff: fs.readFileSync(path.join(root, ".claude", "handoffs", "backend", "frontend.md"), "utf8"),
    skill: fs.readFileSync(path.join(root, ".claude", "skills", "maestro", "SKILL.md"), "utf8"),
  };
}

/** The write guard hook, called as Claude Code would for a participant's Write. */
function participantWrite(root: string, agent: string, file: string) {
  const r = spawnSync("node", [path.join(PLUGIN_SCRIPTS, "maestro-channel-write-guard.js")], {
    encoding: "utf8",
    env: env(root),
    input: JSON.stringify({
      cwd: root,
      session_id: SESSION,
      hook_event_name: "PreToolUse",
      agent_type: agent,
      tool_name: "Write",
      tool_input: { file_path: file },
    }),
  });
  expect(r.status).toBe(0);
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : "allow";
}

/** The "closed cleanly, applied nothing" contract for a meeting that never reached a tally. */
function expectClosedAndNothingApplied(root: string, before: Record<string, string>, meetingDir: string) {
  expect(sessionState(root).meeting).toBeUndefined(); // flag cleared: hooks treat runs as workflow steps again
  expect(projectFingerprint(root)).toEqual(before);
  expect(fs.existsSync(path.join(meetingDir, "decision.json"))).toBe(false);
  expect(fs.existsSync(path.join(meetingDir, "decision.md"))).toBe(false);
  expect(fs.existsSync(path.join(meetingDir, "applied.json"))).toBe(false);
  // nothing for the apply phase to act on:
  const apply = tm(root, "apply-placement");
  expect(apply.code).toBe(1);
  expect(apply.out.reason).toContain("tally");
  const owners = tm(root, "owner-runs", "--approved", "backend-1");
  expect(owners.code).toBe(1);
  expect(owners.out.reason).toContain("tally");
  // and the meeting is no longer there to brief, tally or conflict against
  expect(tm(root, "tally").code).toBe(1);
}

describe("team meeting dry run — the moderator's tool sequence", () => {
  it("start, brief, agenda change, round 1, redirect, tally, end, then owner runs planned only after close", async () => {
    const root = await project();
    const before = projectFingerprint(root);

    // Step 2: start + brief.
    const start = tm(root, "start", "--mode", "review");
    expect(start.code, JSON.stringify(start.out)).toBe(0);
    expect(start.out.meeting.participants).toEqual(["backend", "frontend"]);
    const meetingDir: string = start.out.meeting.dir;
    expect(sessionState(root).meeting.id).toBe(start.out.meeting.id);
    const brief = tm(root, "brief");
    expect(brief.code, JSON.stringify(brief.out)).toBe(0);
    expect(Object.keys(brief.out.slices).sort()).toEqual(["backend", "frontend"]);

    // Agenda checkpoint, branch "drop a participant": start again with the new list, brief again.
    const restart = tm(root, "start", "--mode", "review", "--participants", "backend,frontend");
    expect(restart.code, JSON.stringify(restart.out)).toBe(0);
    expect(tm(root, "brief").code).toBe(0);

    // The write guard confines a participant to the meeting directory while the flag is set.
    expect(participantWrite(root, "backend", path.join(meetingDir, "round-1", "backend.json"))).toBe("allow");
    expect(participantWrite(root, "backend", path.join(root, "src", "app.ts"))).toBe("deny");

    // Round 1: both participants file proposals.
    fileRound(meetingDir, 1, "backend", [placement("backend-1", "instance:backend#expressjs", "referenced")]);
    fileRound(meetingDir, 1, "frontend", [placement("frontend-1", "instance:frontend#react", "referenced")]);

    // Mid-meeting checkpoint: the moderator reads positions through `conflicts`.
    const mid = tm(root, "conflicts");
    expect(mid.out.filed).toEqual(["backend", "frontend"]);
    expect(mid.out.conflicts).toEqual([]);

    // Branch "redirect a participant": it rewrites its round file; the meeting stays open.
    fileRound(meetingDir, 1, "backend", [
      placement("backend-1", "instance:backend#expressjs", "referenced"),
      placement("backend-2", "instance:backend#react", "loaded"),
    ]);
    expect(sessionState(root).meeting).toBeDefined();
    expect(tm(root, "conflicts").out.filed).toEqual(["backend", "frontend"]);

    // Tally while open: writes the decision, still applies nothing.
    const tally = tm(root, "tally");
    expect(tally.code, JSON.stringify(tally.out)).toBe(0);
    expect(tally.out.rows.map((r: { id: string }) => r.id).sort()).toEqual(["backend-1", "backend-2", "frontend-1"]);
    expect(projectFingerprint(root)).toEqual(before);

    // Owner runs may only be planned AFTER the meeting closes.
    const early = tm(root, "owner-runs", "--approved", "backend-1");
    expect(early.code).toBe(1);
    expect(early.out.reason).toContain("still open");

    // End, then the plan is available and groups by owner.
    const end = tm(root, "end");
    expect(end.code, JSON.stringify(end.out)).toBe(0);
    expect(sessionState(root).meeting).toBeUndefined();
    const plan = tm(root, "owner-runs", "--approved", "backend-1,frontend-1");
    expect(plan.code, JSON.stringify(plan.out)).toBe(0);
    expect(JSON.stringify(plan.out)).toContain("backend-1");

    // A closed meeting's participant is a normal agent again: the guard no longer confines it.
    expect(participantWrite(root, "backend", path.join(root, "src", "app.ts"))).toBe("allow");
  });

  it("CANCEL at the agenda checkpoint: end closes the meeting and nothing is applied", async () => {
    const root = await project();
    const before = projectFingerprint(root);
    const start = tm(root, "start", "--mode", "review");
    expect(start.code).toBe(0);
    const meetingDir: string = start.out.meeting.dir;
    expect(tm(root, "brief").code).toBe(0);

    const end = tm(root, "end");
    expect(end.code, JSON.stringify(end.out)).toBe(0);

    expectClosedAndNothingApplied(root, before, meetingDir);
    expect(participantWrite(root, "backend", path.join(root, "src", "app.ts"))).toBe("allow");
  });

  it("STOP at the mid-meeting checkpoint: round 1 files exist, end closes it, no tally, nothing applied", async () => {
    const root = await project();
    const before = projectFingerprint(root);
    const start = tm(root, "start", "--mode", "review");
    expect(start.code).toBe(0);
    const meetingDir: string = start.out.meeting.dir;
    expect(tm(root, "brief").code).toBe(0);
    fileRound(meetingDir, 1, "backend", [placement("backend-1", "instance:backend#expressjs", "referenced")]);
    fileRound(meetingDir, 1, "frontend", [placement("frontend-1", "instance:frontend#react", "referenced")]);
    expect(tm(root, "conflicts").out.filed).toEqual(["backend", "frontend"]);

    // The moderator stops: `end`, and does NOT tally.
    const end = tm(root, "end");
    expect(end.code, JSON.stringify(end.out)).toBe(0);

    expectClosedAndNothingApplied(root, before, meetingDir);
    // The proposals were never turned into decisions, so even a tally-less approval has no rows.
    expect(fs.existsSync(path.join(meetingDir, "round-1", "backend.json"))).toBe(true);
  });

  it("STOP after a redirect round: the rewritten proposals still apply nothing once the meeting is ended", async () => {
    const root = await project();
    const before = projectFingerprint(root);
    const start = tm(root, "start", "--mode", "review", "--participants", "backend");
    const meetingDir: string = start.out.meeting.dir;
    fileRound(meetingDir, 1, "backend", [placement("backend-1", "instance:backend#expressjs", "referenced")]);
    fileRound(meetingDir, 1, "backend", [placement("backend-1", "instance:backend#expressjs", "loaded")]); // redirected rewrite
    expect(tm(root, "end").code).toBe(0);
    expectClosedAndNothingApplied(root, before, meetingDir);
  });
});
