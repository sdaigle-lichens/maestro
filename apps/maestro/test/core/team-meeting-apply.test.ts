// Team meeting apply phase: `applyAutoTier` (the auto tier, pure), `ownerOf` / `planOwnerRuns`
// (who applies each approved row), and the plugin CLI's `apply-placement` / `owner-runs` commands,
// including the guard that no owner run is planned while the meeting flag is set. The leak suites
// that drive the hooks are in `team-meeting-hooks.test.ts`.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import {
  applyAutoTier,
  ownerOf,
  planOwnerRuns,
  type DecisionRecord,
  type TallyRow,
} from "../../src/core/team-meeting.js";
import { findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const row = (id: string, kind: string, target: string, extra: Partial<TallyRow> = {}): TallyRow => ({
  id,
  agent: id.split("-")[0],
  supporters: [],
  kind,
  target,
  tier: kind === "skill.placement" || kind === "handoff.edit" ? "auto" : "approval",
  change: "c",
  rationale: "r",
  ...extra,
});

const CFG = {
  version: 3,
  agents_available: ["backend", "frontend"],
  skills_available: ["expressjs", "react"],
  workflow_instances: [
    { name: "backend", agent: "backend", loaded_skills: ["expressjs"], referenced_skills: ["react"] },
    { name: "frontend", agent: "frontend", loaded_skills: ["react"], referenced_skills: [] },
  ],
  workflows: [],
  rules: [{ id: "r1", paths: [] }],
  gates: { confidence_check: true },
  use_maestro_tasks: true,
  project_tags: ["x"],
} as unknown as MaestroConfigV3;

describe("applyAutoTier", () => {
  it("moves a skill between lists and leaves every other key and instance untouched", () => {
    const record: DecisionRecord = {
      meetingId: "m",
      conflictTargets: [],
      rows: [row("backend-1", "skill.placement", "instance:backend#expressjs", { to: "referenced" })],
    };
    const res = applyAutoTier(CFG, record);
    expect(res.applied).toEqual(["backend-1"]);
    const inst = res.cfg.workflow_instances!;
    expect(inst[0].loaded_skills).toEqual([]);
    expect(inst[0].referenced_skills).toEqual(["react", "expressjs"]);
    expect(inst[1]).toEqual(CFG.workflow_instances![1]);
    expect({ ...res.cfg, workflow_instances: null }).toEqual({ ...CFG, workflow_instances: null });
    // the input is not mutated
    expect(CFG.workflow_instances![0].loaded_skills).toEqual(["expressjs"]);
  });

  it("skips conflicted targets, vetoed ids, missing fields, and non-auto rows", () => {
    const record: DecisionRecord = {
      meetingId: "m",
      conflictTargets: ["instance:backend#expressjs"],
      rows: [
        row("backend-1", "skill.placement", "instance:backend#expressjs", { to: "referenced" }),
        row("frontend-1", "skill.placement", "instance:frontend#react", { to: "referenced" }),
        row("frontend-2", "skill.placement", "instance:backend#react", {}),
        row("frontend-3", "agent.edit", "agent:backend"),
      ],
    };
    const res = applyAutoTier(CFG, record, { skipIds: ["frontend-1"] });
    expect(res.applied).toEqual([]);
    expect(res.cfg).toBe(CFG);
    expect(Object.fromEntries(res.skipped.map((s) => [s.id, s.reason]))).toEqual({
      "backend-1": "target is in conflict",
      "frontend-1": "vetoed by the user",
      "frontend-2": 'no "to" field (loaded|referenced)',
    });
  });

  it("returns handoff writes only for an existing template with content, and rejects path tricks", () => {
    const record: DecisionRecord = {
      meetingId: "m",
      conflictTargets: [],
      rows: [
        row("backend-1", "handoff.edit", "handoff:backend/frontend", { content: "NEW" }),
        row("backend-2", "handoff.edit", "handoff:backend/missing", { content: "NEW" }),
        row("backend-3", "handoff.edit", "handoff:../x/frontend", { content: "NEW" }),
        row("backend-4", "handoff.edit", "handoff:backend/reviewer", {}),
      ],
    };
    const res = applyAutoTier(CFG, record, { handoffExists: (p) => p === ".claude/handoffs/backend/frontend.md" });
    expect(res.handoffWrites).toEqual([{ id: "backend-1", path: ".claude/handoffs/backend/frontend.md", content: "NEW" }]);
    expect(res.skipped.map((s) => s.id)).toEqual(["backend-2", "backend-3", "backend-4"]);
    expect(res.cfg).toBe(CFG);
  });
});

describe("ownerOf / planOwnerRuns", () => {
  it("keeps workflow changes, rule moves, forks and gates with the main session", () => {
    expect(ownerOf(row("a-1", "workflow.update", "workflow:build"))).toBeNull();
    expect(ownerOf(row("a-1", "rule.to-agent", "rule:x"))).toBeNull();
    expect(ownerOf(row("a-1", "gate.change", "gates"))).toBeNull();
    expect(ownerOf(row("a-1", "agent.edit", "agent:backend", { tier: "blocked" }))).toBeNull();
  });

  it("assigns the target agent, handoff sender, or single proposer", () => {
    expect(ownerOf(row("a-1", "agent.tools", "agent:backend"))).toBe("backend");
    expect(ownerOf(row("a-1", "handoff.edit", "handoff:backend/frontend"))).toBe("backend");
    expect(ownerOf(row("scribe-1", "skill.edit", "skill:x"))).toBe("scribe");
    expect(ownerOf(row("scribe-1", "skill.edit", "skill:x", { supporters: ["backend"] }))).toBeNull();
  });

  it("groups approved rows per owner, leaves unapproved and already-applied ones out", () => {
    const record: DecisionRecord = {
      meetingId: "m",
      conflictTargets: [],
      rows: [
        row("backend-1", "agent.edit", "agent:backend"),
        row("backend-2", "agent.tools", "agent:backend"),
        row("scribe-1", "skill.edit", "skill:x"),
        row("scribe-2", "workflow.update", "workflow:build"),
        row("scribe-3", "rule.edit", "rule:z"),
        row("scribe-4", "handoff.edit", "handoff:backend/frontend", { tier: "auto" }),
      ],
    };
    const r = planOwnerRuns(record, ["backend-1", "backend-2", "scribe-1", "scribe-2", "scribe-4"], ["scribe-4"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.plan.runs.map((x) => [x.agent, x.rows.map((y) => y.id)])).toEqual([
      ["backend", ["backend-1", "backend-2"]],
      ["scribe", ["scribe-1"]],
    ]);
    expect(r.plan.main).toEqual(["scribe-2"]);
  });

  it("refuses to plan while two approved proposals sit on one conflicted target", () => {
    const record: DecisionRecord = {
      meetingId: "m",
      conflictTargets: ["agent:backend"],
      rows: [row("backend-1", "agent.edit", "agent:backend"), row("frontend-1", "agent.edit", "agent:backend")],
    };
    const bad = planOwnerRuns(record, ["backend-1", "frontend-1"]);
    expect(bad.ok).toBe(false);
    expect(planOwnerRuns(record, ["backend-1"]).ok).toBe(true);
  });
});

// ── the CLI: apply-placement and the owner-run ordering guard ──────────────

const PLUGIN_SCRIPTS = path.join(findUpPluginRoot(path.dirname(new URL(import.meta.url).pathname))!, "scripts");
const SESSION = "sess-apply-1";
let tmp: string;

beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-meeting-apply-")));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function cli(root: string, args: string[]) {
  const e: NodeJS.ProcessEnv = { ...process.env, CLAUDE_PROJECT_DIR: root, HOME: tmp, CLAUDE_CODE_SESSION_ID: SESSION };
  const r = spawnSync("node", [path.join(PLUGIN_SCRIPTS, "maestro-team-meeting.cjs"), ...args, root], {
    encoding: "utf8",
    env: e,
  });
  return { code: r.status ?? -1, out: JSON.parse(r.stdout || "{}") };
}

function project(record: DecisionRecord, meetingOpen: boolean): string {
  const root = path.join(tmp, "p");
  fs.mkdirSync(root, { recursive: true });
  writeConfig(root, CFG);
  const sess = path.join(root, ".claude", "maestro_sessions", SESSION);
  const dir = path.join(sess, "meeting");
  fs.mkdirSync(dir, { recursive: true });
  const state: Record<string, unknown> = { run_id: "keep-me" };
  if (meetingOpen) {
    state.meeting = { id: "m-1", mode: "review", dir, participants: ["backend"], started_at: "2026-01-01T00:00:00Z" };
  }
  fs.writeFileSync(path.join(sess, "session.json"), JSON.stringify(state));
  fs.writeFileSync(path.join(dir, "decision.json"), JSON.stringify(record));
  fs.mkdirSync(path.join(root, ".claude", "handoffs", "backend"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude", "handoffs", "backend", "frontend.md"), "OLD");
  return root;
}

const readCfg = (root: string) => fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8");

describe("maestro-team-meeting.cjs apply-placement", () => {
  const record: DecisionRecord = {
    meetingId: "m-1",
    conflictTargets: ["instance:frontend#react"],
    rows: [
      row("backend-1", "skill.placement", "instance:backend#expressjs", { to: "referenced" }),
      row("frontend-1", "skill.placement", "instance:frontend#react", { to: "referenced" }),
      row("backend-2", "handoff.edit", "handoff:backend/frontend", { content: "NEW TEMPLATE" }),
    ],
  };

  it("applies the auto tier, skips the conflict, preserves other slices and the byte format", () => {
    const root = project(record, false);
    const r = cli(root, ["apply-placement"]);
    expect(r.code).toBe(0);
    expect(r.out.applied).toEqual(["backend-1", "backend-2"]);
    expect(r.out.skipped).toEqual([{ id: "frontend-1", reason: "target is in conflict" }]);

    const text = readCfg(root);
    expect(text.endsWith("\n")).toBe(false);
    const cfg = JSON.parse(text);
    expect(cfg.workflow_instances[0].loaded_skills).toEqual([]);
    expect(cfg.workflow_instances[0].referenced_skills).toEqual(["react", "expressjs"]);
    expect(cfg.workflow_instances[1].loaded_skills).toEqual(["react"]);
    expect({ ...cfg, workflow_instances: null }).toEqual({ ...JSON.parse(JSON.stringify(CFG)), workflow_instances: null });
    expect(fs.readFileSync(path.join(root, ".claude", "handoffs", "backend", "frontend.md"), "utf8")).toBe("NEW TEMPLATE\n");
  });

  it("reads maestro.json at apply time, so an edit made after the tally survives", () => {
    const root = project(record, false);
    const cfg = JSON.parse(readCfg(root));
    cfg.gates = { confidence_check: false, use_code_architecture_design_check: true };
    cfg.rules = [{ id: "added-later", paths: [] }];
    fs.writeFileSync(path.join(root, ".claude", "maestro.json"), JSON.stringify(cfg, null, 2));
    expect(cli(root, ["apply-placement"]).code).toBe(0);
    const after = JSON.parse(readCfg(root));
    expect(after.gates).toEqual(cfg.gates);
    expect(after.rules).toEqual(cfg.rules);
  });

  it("honours --skip and refuses without a tally", () => {
    const root = project(record, false);
    const r = cli(root, ["apply-placement", "--skip", "backend-1"]);
    expect(r.out.applied).toEqual(["backend-2"]);
    expect(JSON.parse(readCfg(root)).workflow_instances[0].loaded_skills).toEqual(["expressjs"]);
    fs.rmSync(path.join(root, ".claude", "maestro_sessions", SESSION, "meeting", "decision.json"));
    expect(cli(root, ["apply-placement"]).code).toBe(1);
  });
});

describe("maestro-team-meeting.cjs owner-runs ordering", () => {
  const record: DecisionRecord = {
    meetingId: "m-1",
    conflictTargets: ["agent:backend"],
    rows: [
      row("backend-1", "agent.edit", "agent:backend"),
      row("frontend-1", "agent.edit", "agent:backend"),
      row("frontend-2", "skill.edit", "skill:react"),
      row("backend-2", "workflow.update", "workflow:build"),
    ],
  };

  it("refuses while the meeting flag is set, and plans once it is closed", () => {
    const root = project(record, true);
    const during = cli(root, ["owner-runs", "--approved", "backend-1,frontend-2"]);
    expect(during.code).toBe(1);
    expect(during.out.ok).toBe(false);
    expect(during.out.reason).toMatch(/still open/);

    expect(cli(root, ["end"]).out).toEqual({ ok: true, ended: true });
    const after = cli(root, ["owner-runs", "--approved", "backend-1,frontend-2,backend-2"]);
    expect(after.code).toBe(0);
    expect(after.out.runs.map((x: { agent: string }) => x.agent)).toEqual(["backend", "frontend"]);
    expect(after.out.main).toEqual(["backend-2"]);
  });

  it("refuses until each conflicted target has a single approved proposal", () => {
    const root = project(record, false);
    const both = cli(root, ["owner-runs", "--approved", "backend-1,frontend-1"]);
    expect(both.code).toBe(1);
    expect(both.out.reason).toMatch(/still in conflict/);
    expect(cli(root, ["owner-runs", "--approved", "backend-1"]).code).toBe(0);
  });
});

// Extra coverage: conflict skipping on handoffs, no-op writes, the applied.json hand-off.

describe("apply-placement: further edges", () => {
  const mk = (rows: TallyRow[], conflictTargets: string[] = []): DecisionRecord => ({ meetingId: "m-1", conflictTargets, rows });

  it("moves a skill referenced to loaded", () => {
    const res = applyAutoTier(CFG, mk([row("backend-1", "skill.placement", "instance:backend#react", { to: "loaded" })]));
    expect(res.applied).toEqual(["backend-1"]);
    expect(res.cfg.workflow_instances![0].loaded_skills).toEqual(["expressjs", "react"]);
    expect(res.cfg.workflow_instances![0].referenced_skills).toEqual([]);
  });

  it("skips an unknown instance, a skill not in the source list, and a malformed target", () => {
    const res = applyAutoTier(
      CFG,
      mk([
        row("a-1", "skill.placement", "instance:nope#react", { to: "loaded" }),
        row("a-2", "skill.placement", "instance:backend#expressjs", { to: "loaded" }),
        row("a-3", "skill.placement", "backend-react", { to: "loaded" }),
      ])
    );
    expect(res.applied).toEqual([]);
    expect(res.skipped.map((s) => s.id)).toEqual(["a-1", "a-2", "a-3"]);
    expect(res.cfg).toBe(CFG);
  });

  it("skips a conflicted handoff target and returns no write for it", () => {
    const res = applyAutoTier(
      CFG,
      mk([row("backend-1", "handoff.edit", "handoff:backend/frontend", { content: "X" })], ["handoff:backend/frontend"])
    );
    expect(res.handoffWrites).toEqual([]);
    expect(res.skipped).toEqual([{ id: "backend-1", reason: "target is in conflict" }]);
  });

  it("leaves maestro.json byte-identical when only a handoff is applied", () => {
    const root = project(mk([row("backend-2", "handoff.edit", "handoff:backend/frontend", { content: "NEW" })]), false);
    const before = readCfg(root);
    expect(cli(root, ["apply-placement"]).out.applied).toEqual(["backend-2"]);
    expect(readCfg(root)).toBe(before);
  });

  it("writes no handoff for a conflicted target or a missing template", () => {
    const root = project(
      mk(
        [
          row("backend-1", "handoff.edit", "handoff:backend/frontend", { content: "NEW" }),
          row("backend-2", "handoff.edit", "handoff:backend/ghost", { content: "NEW" }),
        ],
        ["handoff:backend/frontend"]
      ),
      false
    );
    const r = cli(root, ["apply-placement"]);
    expect(r.out.applied).toEqual([]);
    expect(r.out.skipped.map((s: { id: string }) => s.id)).toEqual(["backend-1", "backend-2"]);
    expect(fs.readFileSync(path.join(root, ".claude", "handoffs", "backend", "frontend.md"), "utf8")).toBe("OLD");
    expect(fs.existsSync(path.join(root, ".claude", "handoffs", "backend", "ghost.md"))).toBe(false);
  });

  it("is idempotent: a second run applies nothing and leaves the config unchanged", () => {
    const root = project(mk([row("backend-1", "skill.placement", "instance:backend#expressjs", { to: "referenced" })]), false);
    cli(root, ["apply-placement"]);
    const once = readCfg(root);
    expect(cli(root, ["apply-placement"]).out.applied).toEqual([]);
    expect(readCfg(root)).toBe(once);
  });

  it("works after the meeting is closed (reads the persisted tally)", () => {
    const root = project(mk([row("backend-1", "skill.placement", "instance:backend#expressjs", { to: "referenced" })]), true);
    cli(root, ["end"]);
    expect(cli(root, ["apply-placement"]).out.applied).toEqual(["backend-1"]);
  });
});

describe("owner-runs: ordering after apply-placement", () => {
  it("excludes rows apply-placement applied, and keeps main-session kinds with the main session", () => {
    const rec: DecisionRecord = {
      meetingId: "m-1",
      conflictTargets: [],
      rows: [
        row("backend-1", "skill.placement", "instance:backend#expressjs", { to: "referenced" }),
        row("backend-2", "handoff.edit", "handoff:backend/frontend", { content: "NEW" }),
        row("backend-3", "agent.edit", "agent:backend"),
        row("frontend-1", "rule.to-agent", "rule:r1"),
      ],
    };
    const root = project(rec, false);
    cli(root, ["apply-placement"]);
    const r = cli(root, ["owner-runs", "--approved", "backend-1,backend-2,backend-3,frontend-1"]);
    expect(r.code).toBe(0);
    expect(r.out.runs).toEqual([{ agent: "backend", rows: [expect.objectContaining({ id: "backend-3" })] }]);
    expect(r.out.main).toEqual(["frontend-1"]);
  });

  it("plans nothing for no approvals and refuses without a tally", () => {
    const rec: DecisionRecord = { meetingId: "m-1", conflictTargets: [], rows: [row("backend-1", "agent.edit", "agent:backend")] };
    const root = project(rec, false);
    expect(cli(root, ["owner-runs", "--approved", ""]).out.runs).toEqual([]);
    fs.rmSync(path.join(root, ".claude", "maestro_sessions", SESSION, "meeting", "decision.json"));
    expect(cli(root, ["owner-runs", "--approved", "backend-1"]).code).toBe(1);
  });

  it("refuses while the meeting is open even when nothing is conflicted", () => {
    const rec: DecisionRecord = { meetingId: "m-1", conflictTargets: [], rows: [row("backend-1", "agent.edit", "agent:backend")] };
    expect(cli(project(rec, true), ["owner-runs", "--approved", "backend-1"]).code).toBe(1);
  });
});
