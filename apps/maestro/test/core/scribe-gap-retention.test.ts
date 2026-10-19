// `112` through the REAL installed scripts: a skill-gap report in the scribe lane survives a
// scribe run that does not act on it, and a SessionEnd, until some scribe ends with a
// `SKILL_GAPS_HANDLED: <file>, …` line naming it. Every other payload keeps `036`'s inline-and-retire,
// deliver-once semantics. Temp projects under os.tmpdir(), a temp HOME, nothing mocked;
// CLAUDE_CODE_SESSION_ID always pinned per spawn (never inherited) — see test-maestro's
// references/hook-script-tests.md.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { sweep, CHANNEL_AGE_CAP_MS } from "../../src/core/handoff-channels.js";
import { pinnedEnv } from "../helpers/env.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";
import { scribeSeedShapes, noGapPayload, withGapPayload } from "../helpers/scribe-seed-payloads.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

vi.setConfig({ testTimeout: 30_000 });

const S1 = "sess-112-one";
const S2 = "sess-112-two";

// main -> backend -> test -> scribe. `backend` has NO route to scribe: a gap is not route-shaped.
const cfg = {
  version: 3,
  agents_available: ["backend", "test", "scribe"],
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
      ],
    },
  ],
  rules: [],
} as unknown as MaestroConfigV3;

let tmp: string;
let home: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-112-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function installed(config: MaestroConfigV3 = cfg): Promise<string> {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeConfig(root, config);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  return root;
}

function script(root: string, sess: string, name: string, args: string[], input?: unknown) {
  const r = spawnSync("node", [path.join(root, ".claude", "scripts", name), ...args], {
    encoding: "utf8",
    env: pinnedEnv(home, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: sess }),
    ...(input !== undefined ? { input: JSON.stringify(input) } : {}),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Both SubagentStart hooks, in the order Claude Code registers them; returns the injected context. */
function start(root: string, sess: string, agent: string, id: string): string {
  const payload = { cwd: root, session_id: sess, hook_event_name: "SubagentStart", agent_type: agent, agent_id: id };
  const log = script(root, sess, "maestro-subagent-log.cjs", [], payload);
  expect(log.code, log.stderr).toBe(0);
  const inj = script(root, sess, "maestro-inject-agent-context.cjs", [], payload);
  expect(inj.code, inj.stderr).toBe(0);
  return inj.stdout.trim() ? (JSON.parse(inj.stdout).hookSpecificOutput.additionalContext as string) : "";
}

function stop(root: string, sess: string, agent: string, id: string, message: string) {
  const r = script(root, sess, "maestro-subagent-log.cjs", [], {
    cwd: root,
    session_id: sess,
    hook_event_name: "SubagentStop",
    agent_type: agent,
    agent_id: id,
    last_assistant_message: message,
  });
  expect(r.code, r.stderr).toBe(0);
}

/** A non-resumable SessionEnd: the session's directory is removed, then the channels are swept. */
function sessionEnd(root: string, sess: string) {
  const r = script(root, sess, "maestro-session-cleanup.cjs", [], {
    cwd: root,
    session_id: sess,
    hook_event_name: "SessionEnd",
    reason: "clear",
  });
  expect(r.code, r.stderr).toBe(0);
}

const laneDir = (root: string, receiver: string) => path.join(root, ".claude", "channels", receiver);
const consumedDir = (root: string, receiver: string) => path.join(root, ".claude", "channels", ".consumed", receiver);
const filesIn = (dir: string) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".md"))
        .sort()
    : [];
const read = (dir: string, f: string) => fs.readFileSync(path.join(dir, f), "utf8");

/** The scribe-lane files whose content carries `token`. */
const laneFilesWith = (root: string, receiver: string, token: string) =>
  filesIn(laneDir(root, receiver)).filter((f) => read(laneDir(root, receiver), f).includes(token));

const gapBody = (token: string) =>
  "Skill gap report.\n\n```json\n" +
  JSON.stringify({ skill_gaps: [{ skill: "agents-view", missing: `the tri-state chip logic ${token}` }] }, null, 2) +
  "\n```\n";

/** What an agent does: write its gap to the literal path its report names. */
function writeGap(root: string, sender: string, token: string) {
  fs.mkdirSync(laneDir(root, "scribe"), { recursive: true });
  fs.writeFileSync(path.join(laneDir(root, "scribe"), `${sender}.1.md`), gapBody(token));
}

function writeRaw(root: string, receiver: string, sender: string, body: string) {
  fs.mkdirSync(laneDir(root, receiver), { recursive: true });
  fs.writeFileSync(path.join(laneDir(root, receiver), `${sender}.1.md`), body);
}

/** backend b1 runs in `sess`, reports a gap, and its SubagentStop stamps it. Returns the gap's file name. */
function backendReportsGap(root: string, sess: string, token: string, id = "b1"): string {
  start(root, sess, "backend", id);
  writeGap(root, "backend", token);
  stop(root, sess, "backend", id, '"verdict": "SUCCESS"\nHANDOFF: success');
  const files = laneFilesWith(root, "scribe", token);
  expect(files, `gap ${token} not in the scribe lane after stamping`).toHaveLength(1);
  expect(read(laneDir(root, "scribe"), files[0])).toMatch(/^<!-- maestro:run_id=[^\s>]+ -->\n/);
  return files[0];
}

describe("the 111 sequence: a gap survives a scribe that did not act on it (112)", () => {
  it("delivered, not acknowledged, session ended — a new session's scribe still has it inlined", async () => {
    const root = await installed();
    const gap = backendReportsGap(root, S1, "GAP-111-TOKEN");

    // Run 1's scribe is busy with its own documentation task: it receives the gap...
    const first = start(root, S1, "scribe", "s1");
    expect(first).toContain("GAP-111-TOKEN");
    // ...is told how to acknowledge it, naming the file...
    expect(first).toContain("SKILL_GAPS_HANDLED");
    expect(first).toContain(gap);
    // ...and the delivery does NOT retire it.
    expect(filesIn(laneDir(root, "scribe"))).toContain(gap);
    expect(filesIn(consumedDir(root, "scribe"))).not.toContain(gap);

    // It ends without an ack line.
    stop(root, S1, "scribe", "s1", "Updated docs/foo.md.\n\nHANDOFF: success");
    expect(filesIn(laneDir(root, "scribe"))).toContain(gap);

    // SessionEnd sweeps `.consumed/` — the gap is not there to be swept.
    sessionEnd(root, S1);
    expect(filesIn(laneDir(root, "scribe"))).toContain(gap);

    // A new session (new run_id): the stamped gap from a foreign run is still INLINED, not just mentioned.
    const later = start(root, S2, "scribe", "s2");
    expect(later).toContain("GAP-111-TOKEN");
    expect(later).toContain("SKILL_GAPS_HANDLED");
    expect(filesIn(laneDir(root, "scribe"))).toContain(gap);
  });

  it("an unacknowledged, delivered gap sits in the live lane, so sweep ages it out past CHANNEL_AGE_CAP_MS", async () => {
    const root = await installed();
    const gap = backendReportsGap(root, S1, "GAP-AGE-TOKEN");
    start(root, S1, "scribe", "s1");
    stop(root, S1, "scribe", "s1", "HANDOFF: success");
    const live = path.join(laneDir(root, "scribe"), gap);

    expect(sweep(root, { now: Date.now() + CHANNEL_AGE_CAP_MS - 60_000 }).removed).not.toContain(live);
    expect(fs.existsSync(live)).toBe(true);

    expect(sweep(root, { now: Date.now() + CHANNEL_AGE_CAP_MS + 60_000 }).removed).toContain(live);
    expect(fs.existsSync(live)).toBe(false);
  });
});

describe("an acknowledged gap is not delivered again (112)", () => {
  it("the scribe's SKILL_GAPS_HANDLED line retires it; the next scribe — same session or a new one — does not see it", async () => {
    const root = await installed();
    const gap = backendReportsGap(root, S1, "GAP-ACK-TOKEN");

    expect(start(root, S1, "scribe", "s1")).toContain("GAP-ACK-TOKEN");
    stop(root, S1, "scribe", "s1", `Ran update-single-concept-skill.\n\nSKILL_GAPS_HANDLED: ${gap}\nHANDOFF: success`);

    expect(filesIn(laneDir(root, "scribe"))).not.toContain(gap);
    expect(filesIn(consumedDir(root, "scribe"))).toContain(gap);

    expect(start(root, S1, "scribe", "s2")).not.toContain("GAP-ACK-TOKEN");
    sessionEnd(root, S1);
    expect(start(root, S2, "scribe", "s3")).not.toContain("GAP-ACK-TOKEN");
  });

  it("acknowledges only the files named — a second, unnamed gap stays for the next scribe", async () => {
    const root = await installed();
    const handled = backendReportsGap(root, S1, "GAP-NAMED");
    start(root, S1, "frontend", "f1");
    writeGap(root, "frontend", "GAP-UNNAMED");
    stop(root, S1, "frontend", "f1", "HANDOFF: success");
    const unnamed = laneFilesWith(root, "scribe", "GAP-UNNAMED");
    expect(unnamed).toHaveLength(1);

    const ctx = start(root, S1, "scribe", "s1");
    expect(ctx).toContain("GAP-NAMED");
    expect(ctx).toContain("GAP-UNNAMED");
    stop(root, S1, "scribe", "s1", `SKILL_GAPS_HANDLED: ${handled}\nHANDOFF: success`);

    expect(filesIn(laneDir(root, "scribe"))).toEqual(unnamed);
    sessionEnd(root, S1);
    const next = start(root, S2, "scribe", "s2");
    expect(next).toContain("GAP-UNNAMED");
    expect(next).not.toContain("GAP-NAMED");
  });

  it("a namespaced scribe (maestro:scribe) acknowledges through the same bare lane", async () => {
    const root = await installed();
    const gap = backendReportsGap(root, S1, "GAP-NS-TOKEN");
    expect(start(root, S1, "maestro:scribe", "s1")).toContain("GAP-NS-TOKEN");
    stop(root, S1, "maestro:scribe", "s1", `SKILL_GAPS_HANDLED: ${gap}\nHANDOFF: success`);
    expect(filesIn(laneDir(root, "scribe"))).not.toContain(gap);
  });

  it("a SKILL_GAPS_HANDLED line from a NON-scribe agent retires nothing", async () => {
    const root = await installed();
    const gap = backendReportsGap(root, S1, "GAP-IMPOSTOR");
    start(root, S1, "test", "t1");
    stop(root, S1, "test", "t1", `SKILL_GAPS_HANDLED: ${gap}\nHANDOFF: success`);
    expect(filesIn(laneDir(root, "scribe"))).toContain(gap);
    expect(filesIn(consumedDir(root, "scribe"))).not.toContain(gap);
  });

  it("a RESUMED scribe's SubagentStop does not retire a gap via resume deliveries — only its ack line does", async () => {
    const root = await installed();
    const gap = backendReportsGap(root, S1, "GAP-RESUME-TOKEN");
    start(root, S1, "scribe", "s1");
    stop(root, S1, "scribe", "s1", "HANDOFF: success");

    // The orchestrator resumes s1 (records any current-run deliveries for it), and it ends again without acking.
    const rt = script(root, S1, "maestro-resume-target.cjs", ["scribe"]);
    expect(rt.code, rt.stderr).toBe(0);
    start(root, S1, "scribe", "s1");
    stop(root, S1, "scribe", "s1", "Still on my own task.\nHANDOFF: success");
    expect(filesIn(laneDir(root, "scribe"))).toContain(gap);
    expect(filesIn(consumedDir(root, "scribe"))).not.toContain(gap);

    // Resumed once more, this time it acts on the gap and says so.
    script(root, S1, "maestro-resume-target.cjs", ["scribe"]);
    start(root, S1, "scribe", "s1");
    stop(root, S1, "scribe", "s1", `SKILL_GAPS_HANDLED: ${gap}\nHANDOFF: success`);
    expect(filesIn(laneDir(root, "scribe"))).not.toContain(gap);
    expect(filesIn(consumedDir(root, "scribe"))).toContain(gap);
  });
});

describe("deliver-once is unchanged for everything that is not a stamped gap (112)", () => {
  it("a non-gap scribe payload and another lane's payload are retired on first delivery; a gap beside them is kept", async () => {
    const root = await installed();
    start(root, S1, "backend", "b1");
    writeRaw(root, "test", "backend", '```json\n{"behaviors_to_test":["TEST-LANE-TOKEN"]}\n```\n');
    stop(root, S1, "backend", "b1", "HANDOFF: success");

    // The other lane: inlined once, retired, gone for the next start.
    expect(start(root, S1, "test", "t1")).toContain("TEST-LANE-TOKEN");
    expect(filesIn(laneDir(root, "test"))).toEqual([]);
    expect(filesIn(consumedDir(root, "test"))).toEqual(["backend.1.md"]);
    expect(start(root, S1, "test", "t2")).not.toContain("TEST-LANE-TOKEN");

    // The scribe lane: test's ordinary success payload, plus a gap from frontend.
    start(root, S1, "test", "t3");
    writeRaw(root, "scribe", "test", '```json\n{"docs_to_update":["NONGAP-SCRIBE-TOKEN"]}\n```\n');
    stop(root, S1, "test", "t3", "HANDOFF: success");
    start(root, S1, "frontend", "f1");
    writeGap(root, "frontend", "GAP-BESIDE-TOKEN");
    stop(root, S1, "frontend", "f1", "HANDOFF: success");
    const gap = laneFilesWith(root, "scribe", "GAP-BESIDE-TOKEN");
    expect(gap).toHaveLength(1);
    // The non-gap payload is not renamed by its stamp.
    expect(filesIn(laneDir(root, "scribe"))).toContain("test.1.md");

    const ctx = start(root, S1, "scribe", "s1");
    expect(ctx).toContain("NONGAP-SCRIBE-TOKEN");
    expect(ctx).toContain("GAP-BESIDE-TOKEN");
    expect(filesIn(consumedDir(root, "scribe"))).toEqual(["test.1.md"]);
    expect(filesIn(laneDir(root, "scribe"))).toEqual(gap);

    // Second scribe: the non-gap payload is not delivered again; the unacknowledged gap is.
    const again = start(root, S1, "scribe", "s2");
    expect(again).not.toContain("NONGAP-SCRIBE-TOKEN");
    expect(again).toContain("GAP-BESIDE-TOKEN");
  });

  it("an UNSTAMPED gap is still only mentioned, never inlined, and left on disk", async () => {
    const root = await installed();
    writeGap(root, "frontend", "GAP-UNSTAMPED-TOKEN"); // the sender died before its SubagentStop
    const ctx = start(root, S1, "scribe", "s1");
    expect(ctx).not.toContain("GAP-UNSTAMPED-TOKEN");
    expect(ctx).toContain(".claude/channels/scribe/frontend.1.md");
    expect(ctx).toContain("(unstamped)");
    expect(filesIn(laneDir(root, "scribe"))).toEqual(["frontend.1.md"]);
  });
});

describe("a second gap from the same sender does not clobber an unhandled first (112)", () => {
  it("both survive their stamps and both reach the next scribe", async () => {
    const root = await installed();
    const first = backendReportsGap(root, S1, "GAP-FIRST-TOKEN", "b1");
    expect(first).not.toBe("backend.1.md");

    // A later backend run reports another gap to the same literal path.
    const second = backendReportsGap(root, S1, "GAP-SECOND-TOKEN", "b2");
    expect(second).not.toBe(first);
    expect(laneFilesWith(root, "scribe", "GAP-FIRST-TOKEN")).toEqual([first]);

    sessionEnd(root, S1);
    const ctx = start(root, S2, "scribe", "s1");
    expect(ctx).toContain("GAP-FIRST-TOKEN");
    expect(ctx).toContain("GAP-SECOND-TOKEN");
    expect(ctx).toContain(first);
    expect(ctx).toContain(second);
  });
});

// Reviewer loop-back on 112, finding 1: the SHIPPED reviewer->scribe and refactor->scribe seed
// payloads carry a gap array that is `[]` when the sender found no gaps. Those are ordinary
// handoffs and keep deliver-once.
describe("seeded reviewer/refactor -> scribe payloads with no gaps keep deliver-once (112 review)", () => {
  for (const sender of ["reviewer", "refactor"] as const) {
    it(`a ${sender}->scribe payload with an empty gap array stays at ${sender}.1.md and is retired on first delivery`, async () => {
      const root = await installed();
      const token = `NOGAP-${sender.toUpperCase()}-TOKEN`;
      start(root, S1, sender, `${sender[0]}1`);
      writeRaw(root, "scribe", sender, noGapPayload(scribeSeedShapes(sender)[0], token));
      stop(root, S1, sender, `${sender[0]}1`, '"verdict": "SUCCESS"\nHANDOFF: success');

      // Not renamed by its stamp.
      expect(filesIn(laneDir(root, "scribe"))).toEqual([`${sender}.1.md`]);
      expect(read(laneDir(root, "scribe"), `${sender}.1.md`)).toMatch(/^<!-- maestro:run_id=/);

      // Inlined once, retired, and gone for the next scribe.
      const ctx = start(root, S1, "scribe", "s1");
      expect(ctx).toContain(token);
      expect(filesIn(laneDir(root, "scribe"))).toEqual([]);
      expect(filesIn(consumedDir(root, "scribe"))).toEqual([`${sender}.1.md`]);
      expect(start(root, S1, "scribe", "s2")).not.toContain(token);
    });
  }

  it("the same seed shape WITH a gap entry is kept like any gap report until acknowledged", async () => {
    const root = await installed();
    start(root, S1, "reviewer", "r1");
    writeRaw(root, "scribe", "reviewer", withGapPayload(scribeSeedShapes("reviewer")[0], "SEED-GAP-TOKEN"));
    stop(root, S1, "reviewer", "r1", '"verdict": "SUCCESS"\nHANDOFF: success');
    const [gap] = laneFilesWith(root, "scribe", "SEED-GAP-TOKEN");
    expect(gap).toMatch(/^reviewer\.\d+\.md$/);

    expect(start(root, S1, "scribe", "s1")).toContain("SEED-GAP-TOKEN");
    expect(filesIn(laneDir(root, "scribe"))).toEqual([gap]);
    stop(root, S1, "scribe", "s1", `SKILL_GAPS_HANDLED: ${gap}\nHANDOFF: success`);
    expect(filesIn(laneDir(root, "scribe"))).toEqual([]);
  });
});

// Reviewer loop-back on 112, finding 2: a gap payload on a route to scribe is renamed by the
// sender's SubagentStop stamp. If that run is resumed (say, to fix a bad HANDOFF label) and stops
// again on the route, the `087` payload check must still see the payload it wrote.
describe("the payload check sees a gap payload its stamp renamed (112 review)", () => {
  const reviewerCfg = {
    version: 3,
    agents_available: ["reviewer", "scribe"],
    skills_available: [],
    workflow_instances: [
      { name: "reviewer", agent: "reviewer", loaded_skills: [], referenced_skills: [] },
      { name: "scribe", agent: "scribe", loaded_skills: [], referenced_skills: [] },
    ],
    workflows: [
      {
        name: "review",
        nodes: [
          { id: "reviewer", type: "agent", instance: "reviewer", position: { x: 0, y: 100 } },
          { id: "scribe", type: "agent", instance: "scribe", position: { x: 0, y: 200 } },
        ],
        edges: [
          { from: "main-session", to: "reviewer", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
          { from: "reviewer", to: "scribe", kind: "success", sourceHandle: "bottom", targetHandle: "top" },
        ],
      },
    ],
    rules: [],
  } as unknown as MaestroConfigV3;

  const handoffsOf = (root: string, id: string): Record<string, any>[] => {
    const f = path.join(root, ".claude", "maestro_sessions", S1, "log.jsonl");
    return fs
      .readFileSync(f, "utf8")
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l))
      .filter((e) => e.kind === "handoff" && e.agent_id === id);
  };

  it("control: a single run that writes its gap payload and stops on the route raises no missing_payload", async () => {
    const root = await installed(reviewerCfg);
    start(root, S1, "reviewer", "r1");
    writeRaw(root, "scribe", "reviewer", withGapPayload(scribeSeedShapes("reviewer")[0], "CTRL"));
    stop(root, S1, "reviewer", "r1", '"verdict": "SUCCESS"\nHANDOFF: success');
    const [h] = handoffsOf(root, "r1");
    expect(h.status).toBe("success");
    expect(h.handoff_issue).toBeUndefined();
  });

  it("a resumed reviewer that stops again with a good label gets no spurious missing_payload", async () => {
    const root = await installed(reviewerCfg);
    start(root, S1, "reviewer", "r1");
    writeRaw(root, "scribe", "reviewer", withGapPayload(scribeSeedShapes("reviewer")[0], "RESUMED-GAP"));
    // First stop: a label the workflow has no edge for. The payload is stamped (and renamed) anyway.
    stop(root, S1, "reviewer", "r1", '"verdict": "SUCCESS"\nHANDOFF: looks good');
    const [gap] = laneFilesWith(root, "scribe", "RESUMED-GAP");
    expect(gap).toMatch(/^reviewer\.\d+\.md$/);
    expect(gap).not.toBe("reviewer.1.md"); // precondition: renamed away from the route's channel file
    expect(handoffsOf(root, "r1")[0].handoff_issue?.kind).not.toBe("missing_payload");

    // The orchestrator resumes r1 to fix the label; it stops again on the real route.
    start(root, S1, "reviewer", "r1");
    stop(root, S1, "reviewer", "r1", '"verdict": "SUCCESS"\nHANDOFF: success');

    const second = handoffsOf(root, "r1")[1];
    expect(second.status).toBe("success");
    expect(second.handoff_issue?.kind).not.toBe("missing_payload");
    const state = JSON.parse(
      fs.readFileSync(path.join(root, ".claude", "maestro_sessions", S1, "session.json"), "utf8")
    );
    expect((state.handoff_issues ?? []).filter((i: { kind: string }) => i.kind === "missing_payload")).toEqual([]);
  });
});
