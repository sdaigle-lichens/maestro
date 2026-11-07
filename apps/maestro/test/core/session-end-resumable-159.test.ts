// `159` through the REAL SessionEnd hooks and the real SubagentStart / SubagentStop / resume hooks.
// A resumable end (`077`: prompt_input_exit, other, resume) must keep the ending session's OWN
// `.claude/channels/<scope>/.consumed/` (the sweep half), and a session resumed under the same id
// must get its pre-restart delivered payloads back (the restore half: `restoreInterruptedDeliveries`,
// reached from a cold SubagentStart and from `maestro-resume-target.cjs`). A final end still retires
// it outright. Both cleanup twins run against every case: the project-local `.cjs` copy the installer
// writes, and the plugin's `.sh`. Age-out, the legacy unscoped layout and the rule that a session never
// touches another session's scope are unchanged, and each is asserted here too.
//
// Payloads are delivered for real: backend's SubagentStop stamps a lane file, and the next agent's
// SubagentStart (test) inlines and retires it to `.consumed/`. Temp projects, a temp HOME, nothing
// mocked; HOME and CLAUDE_CODE_SESSION_ID are pinned on every spawn via pinnedEnv.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { CHANNEL_AGE_CAP_MS } from "../../src/core/handoff-channels.js";
import { pinnedEnv } from "../helpers/env.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

vi.setConfig({ testTimeout: 60_000 });

const SA = "sess-159-aaa"; // the session that ends resumably, on task 159
const SB = "sess-160-bbb"; // a sibling session on task 160, never to be touched
const A_TASK = "159-keep.md";
const B_TASK = "160-other.md";
const A_SCOPE = "task-159";
const B_SCOPE = "task-160";
const DAY = 24 * 60 * 60 * 1000;

const RESUMABLE = ["prompt_input_exit", "other", "resume"] as const;
const FINAL = ["clear", "logout"] as const;

const A_PAYLOAD = '{"behaviors_to_test":["PRE-RESTART-159"]}\n';
const B_PAYLOAD = '{"behaviors_to_test":["SIBLING-160"]}\n';
const FRESH_PAYLOAD = '{"behaviors_to_test":["FRESH-159"]}\n';
const GAP_TOKEN = "GAP-159-TOKEN";

// main -> backend -> test -> scribe, and test -> backend on "tests failed" (the loop-back).
const cfg = {
  version: 3,
  agents_available: ["backend", "test", "scribe", "reviewer"],
  skills_available: [],
  workflow_instances: [
    { name: "backend", agent: "backend", loaded_skills: [], referenced_skills: [] },
    { name: "test", agent: "test", loaded_skills: [], referenced_skills: [] },
    { name: "scribe", agent: "scribe", loaded_skills: [], referenced_skills: [] },
  ],
  workflows: [
    {
      name: "feature",
      nodes: [
        { id: "backend", type: "agent", instance: "backend", position: { x: 0, y: 100 } },
        { id: "test", type: "agent", instance: "test", position: { x: 0, y: 200 } },
        { id: "scribe", type: "agent", instance: "scribe", position: { x: 0, y: 300 } },
      ],
      edges: [
        { from: "main-session", to: "backend", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
        { from: "backend", to: "test", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
        { from: "test", to: "scribe", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
        {
          from: "test",
          to: "backend",
          kind: "condition",
          label: "tests failed",
          sourceHandle: "right",
          targetHandle: "top",
        },
      ],
    },
  ],
  rules: [],
} as unknown as MaestroConfigV3;

let tmp: string;
let home: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-159-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", ["-c", "user.email=t@t", "-c", "user.name=t", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** An installed project hook, run with the project as its dir and the session id pinned. */
function script(root: string, sess: string, name: string, args: string[], input?: unknown) {
  const r = spawnSync("node", [path.join(root, ".claude", "scripts", name), ...args], {
    encoding: "utf8",
    env: pinnedEnv(home, {
      CLAUDE_PROJECT_DIR: root,
      CLAUDE_CODE_SESSION_ID: sess,
      GIT_AUTHOR_NAME: "t",
      GIT_AUTHOR_EMAIL: "t@t",
      GIT_COMMITTER_NAME: "t",
      GIT_COMMITTER_EMAIL: "t@t",
    }),
    ...(input !== undefined ? { input: JSON.stringify(input) } : {}),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function ok<T extends { code: number; stderr: string }>(r: T): T {
  expect(r.code, r.stderr).toBe(0);
  return r;
}

async function repo(tasks: string[]): Promise<string> {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeConfig(root, cfg);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  fs.writeFileSync(path.join(root, "app.txt"), "main\n");
  fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
  for (const f of tasks)
    fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", f), `# ${f}\n\n## Blocked by\n\nNone\n`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  return root;
}

/** The orchestrator's Step 2: record the workflow and the task this session is running. */
function recordTask(root: string, sess: string, task: string) {
  ok(script(root, sess, "maestro-set-session-workflow.cjs", ["feature", "--task", task]));
}

function liveSession(root: string, id: string) {
  const dir = path.join(root, ".claude", "maestro_sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "log.jsonl"), '{"kind":"tool_call"}\n');
}

/** Both SubagentStart hooks in registration order; returns the injected context. */
function start(root: string, sess: string, agent: string, id: string): string {
  const payload = { cwd: root, session_id: sess, hook_event_name: "SubagentStart", agent_type: agent, agent_id: id };
  ok(script(root, sess, "maestro-subagent-log.cjs", [], payload));
  const inj = ok(script(root, sess, "maestro-inject-agent-context.cjs", [], payload));
  return inj.stdout.trim() ? (JSON.parse(inj.stdout).hookSpecificOutput.additionalContext as string) : "";
}

function stop(root: string, sess: string, agent: string, id: string, message: string) {
  ok(
    script(root, sess, "maestro-subagent-log.cjs", [], {
      cwd: root,
      session_id: sess,
      hook_event_name: "SubagentStop",
      agent_type: agent,
      agent_id: id,
      last_assistant_message: message,
    })
  );
}

/** The orchestrator's resume of `test` (`maestro-resume-target.cjs`): its printed lines, in order. */
function resumeTest(root: string, sess: string): string[] {
  return ok(script(root, sess, "maestro-resume-target.cjs", ["test"]))
    .stdout.split("\n")
    .filter(Boolean);
}

type LogEntry = Record<string, unknown>;
/** This session's `log.jsonl`, parsed. Empty when the session directory is gone. */
function logOf(root: string, sess: string): LogEntry[] {
  const f = path.join(root, ".claude", "maestro_sessions", sess, "log.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LogEntry);
}

const ch = (root: string, ...parts: string[]) => path.join(root, ".claude", "channels", ...parts);
const chRel = (...parts: string[]) => path.posix.join(".claude", "channels", ...parts);
function put(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}
const read = (f: string) => fs.readFileSync(f, "utf8");
function age(file: string, ms: number) {
  const t = new Date(Date.now() - ms);
  fs.utimesSync(file, t, t);
}

/** Where backend's payload for test lands once test's SubagentStart has retired it (the real path). */
const consumedToTest = (root: string, scope: string) => ch(root, scope, ".consumed", "test", "backend.1.md");
/** The lane file backend writes for test, in `scope`. */
const laneToTest = (root: string, scope: string) => ch(root, scope, "test", "backend.1.md");
/** The same file, as `deliver:` prints it (project-relative). */
const laneToTestRel = (scope: string) => chRel(scope, "test", "backend.1.md");

/**
 * backend hands `body` to test in `sess`'s scope, and test's SubagentStart delivers it: the file ends
 * up in the session's own `.consumed/test/` exactly as it would during a real run.
 */
function deliveredToTest(root: string, sess: string, task: string, scope: string, tag: string, body: string) {
  recordTask(root, sess, task);
  start(root, sess, "backend", `${tag}-b1`);
  put(laneToTest(root, scope), body);
  stop(root, sess, "backend", `${tag}-b1`, '"verdict": "SUCCESS"\nHANDOFF: success');
  const ctx = start(root, sess, "test", `${tag}-t1`);
  expect(ctx).toContain(body.trim().slice(0, 20));
  // The stamp (`<!-- maestro:run_id=… -->`) is prepended, so compare the payload, not the whole file.
  expect(read(consumedToTest(root, scope))).toContain(body);
}

/**
 * The resumed run of the end-to-end case. test runs once and fails (a labelled HANDOFF, before any
 * payload exists). backend then writes its payload for test. The orchestrator resumes test, which is
 * handed that payload by path (`deliver:`), and the resumed run is cut off by the restart: its
 * SubagentStop fires with no HANDOFF line, so its delivered file is retired to `.consumed/`.
 */
function resumedRunCutOff(root: string) {
  recordTask(root, SA, A_TASK);
  start(root, SA, "test", "159-t1");
  stop(root, SA, "test", "159-t1", '"verdict": "FAIL"\nHANDOFF: tests failed');
  start(root, SA, "backend", "159-b1");
  put(laneToTest(root, A_SCOPE), A_PAYLOAD);
  stop(root, SA, "backend", "159-b1", '"verdict": "SUCCESS"\nHANDOFF: success');
  expect(resumeTest(root, SA)).toEqual(["159-t1", `deliver: ${laneToTestRel(A_SCOPE)}`]);
  stop(root, SA, "test", "159-t1", "Cut off by the restart before the report.");
  expect(fs.existsSync(consumedToTest(root, A_SCOPE))).toBe(true);
  expect(fs.existsSync(laneToTest(root, A_SCOPE))).toBe(false);
}

/** test's inline context after a restart must carry the pre-restart payload, and nothing else of it. */
const PRE_TOKEN = "PRE-RESTART-159";

/**
 * A gap report from `test` in `scope`'s scribe lane, stamped by test's SubagentStop (`112`), then
 * inlined to a scribe run that acknowledges it on a `SKILL_GAPS_HANDLED:` line with no HANDOFF line,
 * so the gap is retired to `.consumed/scribe/` and the scribe was never finished.
 */
function gapAcknowledgedByCutOffScribe(root: string, sess: string, scope: string) {
  start(root, sess, "test", "159-tg1");
  put(
    ch(root, scope, "scribe", "test.1.md"),
    "Skill gap report.\n\n```json\n" +
      JSON.stringify({ skill_gaps: [{ skill: "agents-view", missing: GAP_TOKEN }] }, null, 2) +
      "\n```\n"
  );
  stop(root, sess, "test", "159-tg1", '"verdict": "SUCCESS"\nHANDOFF: success');
  const scribeLane = ch(root, scope, "scribe");
  const stamped = fs.readdirSync(scribeLane).find((f) => read(path.join(scribeLane, f)).includes(GAP_TOKEN));
  expect(stamped, "gap report stamped into the scribe lane").toBeDefined();
  const ctx = start(root, sess, "scribe", "159-s1");
  expect(ctx).toContain(GAP_TOKEN);
  stop(root, sess, "scribe", "159-s1", `Acted on it.\nSKILL_GAPS_HANDLED: ${stamped}`);
  expect(fs.existsSync(path.join(ch(root, scope, ".consumed", "scribe"), stamped!))).toBe(true);
}

/**
 * The two cleanup twins. Each takes the SessionEnd payload and runs it the way Claude Code would:
 * the `.cjs` is the copy installed into the project, the `.sh` is the plugin's own script.
 */
interface Twin {
  name: string;
  end(root: string, sess: string, payload: Record<string, unknown>): { code: number; stderr: string };
}
const twins: Twin[] = [
  {
    name: "project-local maestro-session-cleanup.cjs",
    end: (root, sess, payload) => script(root, sess, "maestro-session-cleanup.cjs", [], payload),
  },
  {
    name: "plugin maestro-session-cleanup.sh",
    end: (root, sess, payload) => {
      const r = spawnSync("bash", [path.join(PLUGIN_ROOT, "scripts", "maestro-session-cleanup.sh")], {
        input: JSON.stringify(payload),
        encoding: "utf8",
        env: pinnedEnv(home, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: sess }),
      });
      return { code: r.status ?? -1, stderr: r.stderr ?? "" };
    },
  },
];

const endPayload = (root: string, sess: string, reason: string) => ({
  cwd: root,
  session_id: sess,
  hook_event_name: "SessionEnd",
  reason,
});

describe("159: no session_end line means the restore never runs (deliver-once unchanged)", () => {
  it("a session that never ended resumably gets no pre-restart payload back on a second cold start", async () => {
    const root = await repo([A_TASK, B_TASK]);
    liveSession(root, SA);
    deliveredToTest(root, SA, A_TASK, A_SCOPE, "159", A_PAYLOAD);

    // No SessionEnd at all: the same session simply runs test again.
    expect(start(root, SA, "test", "159-t2")).not.toContain(PRE_TOKEN);
    expect(logOf(root, SA).some((e) => e.kind === "session_end")).toBe(false);
    expect(fs.existsSync(consumedToTest(root, A_SCOPE))).toBe(true);
    expect(fs.existsSync(laneToTest(root, A_SCOPE))).toBe(false);
  });
});

describe.each(twins)("159: $name", (twin) => {
  describe("a resumable SessionEnd keeps the ending session's own delivered payloads", () => {
    it.each(RESUMABLE)(
      "reason %s leaves the own scope's .consumed payload and the sibling's in place",
      async (reason) => {
        const root = await repo([A_TASK, B_TASK]);
        liveSession(root, SA);
        deliveredToTest(root, SA, A_TASK, A_SCOPE, "159", A_PAYLOAD);
        deliveredToTest(root, SB, B_TASK, B_SCOPE, "160", B_PAYLOAD);

        ok(twin.end(root, SA, endPayload(root, SA, reason)));

        expect(read(consumedToTest(root, A_SCOPE))).toContain(A_PAYLOAD);
        expect(read(consumedToTest(root, B_SCOPE))).toContain(B_PAYLOAD);
        // Resumable keeps session state too, so the resumed session still resolves its scope.
        expect(fs.existsSync(path.join(root, ".claude", "maestro_sessions", SA, "session.json"))).toBe(true);
      }
    );
  });

  describe("a final SessionEnd still retires the ending session's own .consumed outright", () => {
    it.each(FINAL)("reason %s removes the own scope's .consumed and leaves the sibling's", async (reason) => {
      const root = await repo([A_TASK, B_TASK]);
      liveSession(root, SA);
      deliveredToTest(root, SA, A_TASK, A_SCOPE, "159", A_PAYLOAD);
      deliveredToTest(root, SB, B_TASK, B_SCOPE, "160", B_PAYLOAD);

      ok(twin.end(root, SA, endPayload(root, SA, reason)));

      expect(fs.existsSync(consumedToTest(root, A_SCOPE))).toBe(false);
      expect(read(consumedToTest(root, B_SCOPE))).toContain(B_PAYLOAD);
    });

    it("a payload with no reason at all is final and retires the own .consumed", async () => {
      const root = await repo([A_TASK, B_TASK]);
      liveSession(root, SA);
      deliveredToTest(root, SA, A_TASK, A_SCOPE, "159", A_PAYLOAD);
      deliveredToTest(root, SB, B_TASK, B_SCOPE, "160", B_PAYLOAD);

      ok(twin.end(root, SA, { cwd: root, session_id: SA, hook_event_name: "SessionEnd" }));

      expect(fs.existsSync(consumedToTest(root, A_SCOPE))).toBe(false);
      expect(read(consumedToTest(root, B_SCOPE))).toContain(B_PAYLOAD);
    });
  });

  describe("the age cap still applies on a resumable end", () => {
    it.each(RESUMABLE)(
      "reason %s ages out what is past the cap in every scope, keeps what is inside it",
      async (reason) => {
        const root = await repo([A_TASK, B_TASK]);
        recordTask(root, SA, A_TASK);
        recordTask(root, SB, B_TASK);
        liveSession(root, SA);
        // The own scope: a consumed file and a live lane file, one inside the cap and one past it.
        const aOld = ch(root, A_SCOPE, ".consumed", "test", "old.1.md");
        const aYoung = ch(root, A_SCOPE, ".consumed", "test", "young.1.md");
        const aLaneOld = ch(root, A_SCOPE, "backend", "old-lane.1.md");
        const aLaneYoung = ch(root, A_SCOPE, "backend", "young-lane.1.md");
        // The sibling scope, same shape.
        const bOld = ch(root, B_SCOPE, ".consumed", "test", "old.1.md");
        const bYoung = ch(root, B_SCOPE, ".consumed", "test", "young.1.md");
        // The legacy unscoped layout: a root .consumed and an unscoped lane.
        const legacyOld = ch(root, ".consumed", "test", "old.1.md");
        const legacyYoung = ch(root, ".consumed", "test", "young.1.md");
        const legacyLaneOld = ch(root, "test", "old.1.md");
        const legacyLaneYoung = ch(root, "test", "young.1.md");

        const all = [
          aOld,
          aYoung,
          aLaneOld,
          aLaneYoung,
          bOld,
          bYoung,
          legacyOld,
          legacyYoung,
          legacyLaneOld,
          legacyLaneYoung,
        ];
        for (const f of all) put(f, "{}\n");
        for (const f of [aOld, aLaneOld, bOld, legacyOld, legacyLaneOld]) age(f, CHANNEL_AGE_CAP_MS + DAY);
        for (const f of [aYoung, aLaneYoung, bYoung, legacyYoung, legacyLaneYoung]) age(f, CHANNEL_AGE_CAP_MS - DAY);

        ok(twin.end(root, SA, endPayload(root, SA, reason)));

        // Past the cap: gone everywhere, the own scope included (age-out only, never outright).
        for (const f of [aOld, aLaneOld, bOld, legacyOld, legacyLaneOld]) expect(fs.existsSync(f), f).toBe(false);
        // Inside the cap: kept everywhere, including the sibling's and the legacy layout's.
        for (const f of [aYoung, aLaneYoung, bYoung, legacyYoung, legacyLaneYoung])
          expect(fs.existsSync(f), f).toBe(true);
      }
    );
  });

  describe("end to end: a session resumed under the same id gets its pre-restart payloads back", () => {
    it.each(RESUMABLE)("reason %s: a cold re-run gets the pre-restart payload inlined exactly once", async (reason) => {
      const root = await repo([A_TASK, B_TASK]);
      liveSession(root, SA);
      deliveredToTest(root, SA, A_TASK, A_SCOPE, "159", A_PAYLOAD);
      ok(twin.end(root, SA, endPayload(root, SA, reason)));

      // The restart: a cold re-run of test gets the payload delivered before the restart, inlined.
      const first = start(root, SA, "test", "159-t-rerun-1");
      expect(first).toContain(PRE_TOKEN);
      expect(first).toContain(`Delivered to your channel (\`${chRel(A_SCOPE, "test")}/\``);

      // A second cold start in the same resumed session does not get it again.
      const second = start(root, SA, "test", "159-t-rerun-2");
      expect(second).not.toContain(PRE_TOKEN);
    });

    it.each(RESUMABLE)(
      "reason %s: a resumed run gets the pre-restart payload as deliver:, and is never reported missing:",
      async (reason) => {
        const root = await repo([A_TASK, B_TASK]);
        liveSession(root, SA);
        resumedRunCutOff(root);
        ok(twin.end(root, SA, endPayload(root, SA, reason)));

        const lines = resumeTest(root, SA);
        expect(lines).toEqual(["159-t1", `deliver: ${laneToTestRel(A_SCOPE)}`]);
        expect(lines.some((l) => l.startsWith("missing:"))).toBe(false);
        // Restored into the live lane, byte for byte, and the restore is what the resume read.
        expect(read(laneToTest(root, A_SCOPE))).toContain(A_PAYLOAD);
      }
    );
  });

  describe("the session_end log line (159)", () => {
    it.each(RESUMABLE)("reason %s writes exactly one session_end line, with its reason", async (reason) => {
      const root = await repo([A_TASK, B_TASK]);
      liveSession(root, SA);
      recordTask(root, SA, A_TASK);

      ok(twin.end(root, SA, endPayload(root, SA, reason)));

      const ends = logOf(root, SA).filter((e) => e.kind === "session_end");
      expect(ends).toHaveLength(1);
      expect(ends[0]).toMatchObject({ kind: "session_end", reason, origin: "main_session" });
    });

    it("a resumable end with no session directory creates none", async () => {
      const root = await repo([A_TASK, B_TASK]);
      const none = "sess-159-none";

      ok(twin.end(root, none, endPayload(root, none, "other")));

      expect(fs.existsSync(path.join(root, ".claude", "maestro_sessions", none))).toBe(false);
    });

    it.each(FINAL)("final reason %s writes no session_end line (the directory is removed)", async (reason) => {
      const root = await repo([A_TASK, B_TASK]);
      liveSession(root, SA);
      recordTask(root, SA, A_TASK);

      ok(twin.end(root, SA, endPayload(root, SA, reason)));

      expect(fs.existsSync(path.join(root, ".claude", "maestro_sessions", SA))).toBe(false);
      expect(logOf(root, SA).some((e) => e.kind === "session_end")).toBe(false);
    });
  });

  describe("guards: nothing is restored", () => {
    it("G2 a final end: the payload is retired and nothing comes back on a cold re-run", async () => {
      const root = await repo([A_TASK, B_TASK]);
      liveSession(root, SA);
      deliveredToTest(root, SA, A_TASK, A_SCOPE, "159", A_PAYLOAD);
      ok(twin.end(root, SA, endPayload(root, SA, "clear")));

      expect(start(root, SA, "test", "159-t-rerun")).not.toContain(PRE_TOKEN);
      expect(fs.existsSync(consumedToTest(root, A_SCOPE))).toBe(false);
    });

    it.each(RESUMABLE)(
      "G3 %s: a payload whose receiver run finished with a HANDOFF after the write is not restored",
      async (reason) => {
        const root = await repo([A_TASK, B_TASK]);
        liveSession(root, SA);
        deliveredToTest(root, SA, A_TASK, A_SCOPE, "159", A_PAYLOAD);
        // test finishes its run (a labelled HANDOFF) after it received the payload.
        stop(root, SA, "test", "159-t1", '"verdict": "SUCCESS"\nHANDOFF: success');
        ok(twin.end(root, SA, endPayload(root, SA, reason)));

        expect(start(root, SA, "test", "159-t-rerun")).not.toContain(PRE_TOKEN);
        expect(fs.existsSync(laneToTest(root, A_SCOPE))).toBe(false);
      }
    );

    it.each(RESUMABLE)("G4 %s: a payload re-delivered after the session_end is not restored again", async (reason) => {
      const root = await repo([A_TASK, B_TASK]);
      liveSession(root, SA);
      resumedRunCutOff(root);
      ok(twin.end(root, SA, endPayload(root, SA, reason)));

      // The resumed run is handed the restored payload after the restart, and is cut off again
      // with no HANDOFF line. That delivery is logged after the session_end.
      expect(resumeTest(root, SA)).toEqual(["159-t1", `deliver: ${laneToTestRel(A_SCOPE)}`]);
      stop(root, SA, "test", "159-t1", "Cut off again before the report.");
      expect(logOf(root, SA).some((e) => e.kind === "channel_delivery" && e.via === "resume")).toBe(true);

      // Neither the resume nor a cold re-run gets it a third time. The resume reports it missing, as
      // it would in an uninterrupted session: it was handed over and consumed, so the sender must rewrite it.
      const third = resumeTest(root, SA);
      expect(third.filter((l) => l.startsWith("deliver:"))).toEqual([]);
      expect(third).toEqual(["159-t1", `missing: ${laneToTestRel(A_SCOPE)} (from backend)`]);
      expect(start(root, SA, "test", "159-t-rerun")).not.toContain(PRE_TOKEN);
    });

    it.each(RESUMABLE)(
      "G5 %s: an acknowledged skill-gap report is not restored into the scribe lane",
      async (reason) => {
        const root = await repo([A_TASK, B_TASK]);
        liveSession(root, SA);
        recordTask(root, SA, A_TASK);
        gapAcknowledgedByCutOffScribe(root, SA, A_SCOPE);
        ok(twin.end(root, SA, endPayload(root, SA, reason)));

        expect(start(root, SA, "scribe", "159-s2")).not.toContain(GAP_TOKEN);
      }
    );

    it.each(RESUMABLE)("G6 %s: another session's scope is never restored from", async (reason) => {
      const root = await repo([A_TASK, B_TASK]);
      liveSession(root, SA);
      recordTask(root, SA, A_TASK);
      deliveredToTest(root, SB, B_TASK, B_SCOPE, "160", B_PAYLOAD);
      ok(twin.end(root, SA, endPayload(root, SA, reason)));

      expect(start(root, SA, "test", "159-t-rerun")).not.toContain("SIBLING-160");
      expect(read(consumedToTest(root, B_SCOPE))).toContain(B_PAYLOAD);
      expect(fs.existsSync(laneToTest(root, A_SCOPE))).toBe(false);
    });

    it.each(RESUMABLE)("G7 %s: a live lane file of the same name is never overwritten by a restore", async (reason) => {
      const root = await repo([A_TASK, B_TASK]);
      liveSession(root, SA);
      deliveredToTest(root, SA, A_TASK, A_SCOPE, "159", A_PAYLOAD);
      ok(twin.end(root, SA, endPayload(root, SA, reason)));

      // A fresh backend run writes the same file name into the live lane, stamped with this run.
      start(root, SA, "backend", "159-b2");
      put(laneToTest(root, A_SCOPE), FRESH_PAYLOAD);
      stop(root, SA, "backend", "159-b2", '"verdict": "SUCCESS"\nHANDOFF: success');

      const ctx = start(root, SA, "test", "159-t-rerun");
      expect(ctx).toContain("FRESH-159");
      expect(ctx).not.toContain(PRE_TOKEN);
    });
  });
});
