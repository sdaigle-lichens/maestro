// Team meeting — the pure halves: `team-meeting.ts` (proposal schema, conflicts, tiers, tally,
// briefs), `meeting-mode.ts` (the session.json flag), `agent-runs.ts`'s meeting skip, and
// `workflow-spec.ts`'s `deleteWorkflow`. The hook-level leak tests that drive the real installed
// scripts live in `team-meeting-hooks.test.ts`.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  AUTO_KINDS,
  PROPOSAL_KINDS,
  buildAgentBrief,
  buildCommonBrief,
  currentPositions,
  findConflicts,
  parseProposalFile,
  placedAgents,
  renderDecision,
  tally,
  tierOf,
  type BriefInput,
  type ProposalFile,
} from "../../src/core/team-meeting.js";
import {
  endMeeting,
  meetingDirFor,
  meetingFor,
  meetingNotice,
  readMeeting,
  startMeeting,
  withoutMeeting,
} from "../../src/core/meeting-mode.js";
import { agentRunsFromLog, hasCompletedRun, resumeTarget } from "../../src/core/agent-runs.js";
import { deleteWorkflow } from "../../src/core/workflow-spec.js";
import { defaultish } from "./fixtures/configs.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

// ── helpers ────────────────────────────────────────────────────────────────

const prop = (agent: string, n: number, kind: string, target: string, change: string) => ({
  id: `${agent}-${n}`,
  kind,
  target,
  change,
  rationale: "r",
  evidence: "e",
});

const file = (
  agent: string,
  round: number,
  proposals: ReturnType<typeof prop>[],
  withdrawn: string[] = []
): ProposalFile => ({
  agent,
  round,
  proposals,
  withdrawn,
});

const ctx = { agentTiers: {}, configRuleIds: [] as string[] };

// ── parseProposalFile ──────────────────────────────────────────────────────

describe("parseProposalFile", () => {
  it("accepts a well-formed file and keeps every field", () => {
    const r = parseProposalFile(
      {
        agent: "backend",
        round: 2,
        proposals: [prop("backend", 1, "skill.placement", "instance:backend#expressjs", "move to referenced")],
        withdrawn: ["backend-9"],
      },
      "backend",
      2
    );
    expect(r.errors).toEqual([]);
    expect(r.file).toEqual({
      agent: "backend",
      round: 2,
      proposals: [
        {
          id: "backend-1",
          kind: "skill.placement",
          target: "instance:backend#expressjs",
          change: "move to referenced",
          rationale: "r",
          evidence: "e",
        },
      ],
      withdrawn: ["backend-9"],
    });
  });

  it("rejects a non-object, a missing agent, a foreign agent and a non-array proposals", () => {
    expect(parseProposalFile(null).file).toBeNull();
    expect(parseProposalFile([]).file).toBeNull();
    expect(parseProposalFile({ proposals: [] }).errors).toEqual(['missing "agent"']);
    const foreign = parseProposalFile({ agent: "frontend", proposals: [] }, "backend");
    expect(foreign.file).toBeNull();
    expect(foreign.errors[0]).toMatch(/belongs to "backend"/);
    expect(parseProposalFile({ agent: "backend", proposals: {} }).errors).toEqual(['"proposals" must be an array']);
  });

  it("takes the agent from the filename when the body omits it, and compares namespaced names bare", () => {
    expect(parseProposalFile({ proposals: [] }, "maestro:backend").file?.agent).toBe("backend");
    expect(parseProposalFile({ agent: "maestro:backend", proposals: [] }, "backend").file?.agent).toBe("backend");
  });

  it("drops a bad proposal with an error but keeps the good ones", () => {
    const r = parseProposalFile(
      {
        agent: "backend",
        proposals: [
          "nope",
          { kind: "bogus.kind", target: "x", change: "c" },
          { kind: "skill.edit", target: "agent:x", change: "c" }, // wrong prefix
          { kind: "skill.edit", target: "skill:", change: "c" }, // prefix with no name
          { kind: "gate.change", target: "gates:x", change: "c" }, // gates must be exact
          { kind: "skill.edit", target: "skill:a", change: "   " }, // empty change
          { id: "backend-ok", kind: "gate.change", target: "gates", change: "turn on confidence check" },
          { id: "backend-ok", kind: "skill.edit", target: "skill:b", change: "dup id" },
        ],
      },
      "backend"
    );
    expect(r.file?.proposals.map((p) => p.id)).toEqual(["backend-ok"]);
    expect(r.errors).toHaveLength(7);
    expect(r.errors.join("\n")).toMatch(/not an object/);
    expect(r.errors.join("\n")).toMatch(/unknown kind "bogus.kind"/);
    expect(r.errors.join("\n")).toMatch(/must be "skill:<name>"/);
    expect(r.errors.join("\n")).toMatch(/must be "gates"/);
    expect(r.errors.join("\n")).toMatch(/empty "change"/);
    expect(r.errors.join("\n")).toMatch(/duplicate id/);
  });

  it("prefixes ids with the agent name and generates missing ids", () => {
    const r = parseProposalFile({
      agent: "backend",
      proposals: [
        { kind: "skill.edit", target: "skill:a", change: "c" },
        { id: "7", kind: "skill.edit", target: "skill:b", change: "c" },
      ],
    });
    expect(r.file?.proposals.map((p) => p.id)).toEqual(["backend-1", "backend-7"]);
  });

  it("defaults the round to the expected one, and ignores non-string withdrawals", () => {
    const r = parseProposalFile({ agent: "a", proposals: [], round: -1, withdrawn: ["a-1", 3, null] }, "a", 3);
    expect(r.file?.round).toBe(3);
    expect(r.file?.withdrawn).toEqual(["a-1"]);
  });

  it("every kind maps to a target prefix, and only the two documented kinds are auto", () => {
    expect([...AUTO_KINDS].sort()).toEqual(["handoff.edit", "skill.placement"]);
    for (const k of AUTO_KINDS) expect(PROPOSAL_KINDS[k]).toBeDefined();
    for (const k of Object.keys(PROPOSAL_KINDS)) {
      expect(tierOf(k)).toBe(AUTO_KINDS.includes(k) ? "auto" : "approval");
    }
    expect(tierOf("unknown.kind")).toBe("approval");
  });
});

// ── currentPositions ───────────────────────────────────────────────────────

describe("currentPositions", () => {
  it("takes each agent's latest round wholesale, minus withdrawals", () => {
    const pos = currentPositions([
      file("backend", 1, [
        prop("backend", 1, "skill.edit", "skill:a", "x"),
        prop("backend", 2, "skill.edit", "skill:b", "y"),
      ]),
      file(
        "backend",
        2,
        [prop("backend", 2, "skill.edit", "skill:b", "y"), prop("backend", 3, "skill.edit", "skill:c", "z")],
        ["backend-3"]
      ),
      file("frontend", 1, [prop("frontend", 1, "skill.edit", "skill:a", "x")]),
    ]);
    expect(pos.get("backend")?.map((p) => p.id)).toEqual(["backend-2"]);
    expect(pos.get("frontend")?.map((p) => p.id)).toEqual(["frontend-1"]);
  });

  it("is order-independent: an earlier round listed last does not win", () => {
    const pos = currentPositions([
      file("backend", 2, [prop("backend", 2, "skill.edit", "skill:b", "late")]),
      file("backend", 1, [prop("backend", 1, "skill.edit", "skill:a", "early")]),
    ]);
    expect(pos.get("backend")?.map((p) => p.change)).toEqual(["late"]);
  });
});

// ── findConflicts ──────────────────────────────────────────────────────────

describe("findConflicts", () => {
  it("reports a target two agents want to change differently", () => {
    const c = findConflicts([
      file("backend", 1, [prop("backend", 1, "skill.edit", "skill:tdd", "shorten it")]),
      file("test", 1, [prop("test", 1, "skill.delete", "skill:tdd", "delete it")]),
    ]);
    expect(c).toHaveLength(1);
    expect(c[0].target).toBe("skill:tdd");
    expect(c[0].agents.sort()).toEqual(["backend", "test"]);
    expect(c[0].proposals).toHaveLength(2);
  });

  it("treats identical proposals (same kind, change equal up to case and whitespace) as agreement", () => {
    expect(
      findConflicts([
        file("backend", 1, [prop("backend", 1, "skill.edit", "skill:tdd", "Shorten  it")]),
        file("test", 1, [prop("test", 1, "skill.edit", "skill:tdd", "shorten it ")]),
      ])
    ).toEqual([]);
  });

  it("same change text but a different kind IS a conflict", () => {
    expect(
      findConflicts([
        file("backend", 1, [prop("backend", 1, "skill.edit", "skill:tdd", "x")]),
        file("test", 1, [prop("test", 1, "skill.delete", "skill:tdd", "x")]),
      ])
    ).toHaveLength(1);
  });

  it("never reports one agent conflicting with itself", () => {
    expect(
      findConflicts([
        file("backend", 1, [
          prop("backend", 1, "skill.edit", "skill:tdd", "a"),
          prop("backend", 2, "skill.delete", "skill:tdd", "b"),
        ]),
      ])
    ).toEqual([]);
  });

  it("a withdrawal in a later round resolves the conflict", () => {
    const r1 = [
      file("backend", 1, [prop("backend", 1, "skill.edit", "skill:tdd", "a")]),
      file("test", 1, [prop("test", 1, "skill.delete", "skill:tdd", "b")]),
    ];
    expect(findConflicts(r1)).toHaveLength(1);
    expect(findConflicts([...r1, file("test", 2, [], ["test-1"])])).toEqual([]);
  });
});

// ── tally / tiers ──────────────────────────────────────────────────────────

describe("tally", () => {
  it("assigns auto to skill.placement / handoff.edit and approval to everything else", () => {
    const rows = tally(
      [
        file("backend", 1, [
          prop("backend", 1, "skill.placement", "instance:backend#x", "move"),
          prop("backend", 2, "handoff.edit", "handoff:backend/test", "trim"),
          prop("backend", 3, "workflow.update", "workflow:default", "drop test"),
        ]),
      ],
      ctx
    );
    expect(rows.map((r) => [r.id, r.tier])).toEqual([
      ["backend-1", "auto"],
      ["backend-2", "auto"],
      ["backend-3", "approval"],
    ]);
  });

  it("downgrades an auto-kind row on a still-conflicted target to approval, with a note", () => {
    const rows = tally(
      [
        file("backend", 1, [prop("backend", 1, "skill.placement", "instance:backend#x", "move to referenced")]),
        file("test", 1, [prop("test", 1, "skill.placement", "instance:backend#x", "remove it")]),
      ],
      ctx
    );
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.tier).toBe("approval");
      expect(r.note).toMatch(/disagree/);
    }
  });

  it("merges identical proposals into one row with supporters", () => {
    const rows = tally(
      [
        file("test", 1, [prop("test", 1, "skill.placement", "instance:backend#x", "Move it")]),
        file("backend", 1, [prop("backend", 1, "skill.placement", "instance:backend#x", "move it")]),
        file("reviewer", 1, [prop("reviewer", 1, "skill.placement", "instance:backend#x", "move   it")]),
      ],
      ctx
    );
    expect(rows).toHaveLength(1);
    // Rows are built in sorted agent order, so backend owns the row.
    expect(rows[0]).toMatchObject({ agent: "backend", supporters: ["reviewer", "test"], tier: "auto" });
  });

  it("blocks edits to a plugin-tier agent but not its creation, and not a project-tier agent", () => {
    const rows = tally(
      [
        file("backend", 1, [
          prop("backend", 1, "agent.tools", "agent:maestro:reviewer", "drop Bash"),
          prop("backend", 2, "agent.edit", "agent:scribe", "tighten"),
          prop("backend", 3, "agent.create", "agent:reviewer", "new one"),
        ]),
      ],
      { agentTiers: { reviewer: "plugin", scribe: "project" }, configRuleIds: [] }
    );
    expect(rows.map((r) => [r.id, r.tier])).toEqual([
      ["backend-1", "blocked"],
      ["backend-2", "approval"],
      ["backend-3", "approval"],
    ]);
    expect(rows[0].note).toMatch(/plugin agent.*fork/);
  });

  it("blocks deleting or moving a rule that maestro.json lists, but not editing it", () => {
    const rows = tally(
      [
        file("backend", 1, [
          prop("backend", 1, "rule.delete", "rule:python", "delete"),
          prop("backend", 2, "rule.to-agent", "rule:python", "move to backend agent"),
          prop("backend", 3, "rule.edit", "rule:python", "reword"),
          prop("backend", 4, "rule.delete", "rule:other", "delete"),
        ]),
      ],
      { agentTiers: {}, configRuleIds: ["python"] }
    );
    expect(rows.map((r) => r.tier)).toEqual(["blocked", "blocked", "approval", "approval"]);
    expect(rows[0].note).toMatch(/\/rules view/);
  });

  it("a blocked row on a conflicted target stays blocked (the downgrade only touches auto rows)", () => {
    const rows = tally(
      [
        file("backend", 1, [prop("backend", 1, "agent.edit", "agent:reviewer", "a")]),
        file("test", 1, [prop("test", 1, "agent.edit", "agent:reviewer", "b")]),
      ],
      { agentTiers: { reviewer: "plugin" }, configRuleIds: [] }
    );
    expect(rows.map((r) => r.tier)).toEqual(["blocked", "blocked"]);
    expect(rows[0].note).toMatch(/plugin agent/);
  });

  it("renderDecision has all three sections, escapes pipes, and lists supporters", () => {
    const rows = tally(
      [
        file("backend", 1, [
          prop("backend", 1, "skill.placement", "instance:backend#x", "a | b"),
          prop("backend", 2, "agent.edit", "agent:reviewer", "c"),
        ]),
        file("test", 1, [prop("test", 1, "skill.placement", "instance:backend#x", "a | b")]),
      ],
      { agentTiers: { reviewer: "plugin" }, configRuleIds: [] }
    );
    const md = renderDecision(rows, { id: "m-1", mode: "review" });
    expect(md).toMatch(/^# Team meeting m-1 \(review\)/);
    expect(md).toMatch(/## Apply automatically \(1\)/);
    expect(md).toMatch(/## Needs approval \(0\)/);
    expect(md).toMatch(/## Needs a manual step first \(1\)/);
    expect(md).toContain("a \\| b");
    expect(md).toContain("| backend, test |");
    expect(md).toContain("_None._");
  });
});

// ── briefs ─────────────────────────────────────────────────────────────────

describe("placedAgents and the briefs", () => {
  it("placedAgents lists only agents placed on a workflow node, bare and deduplicated", () => {
    const cfg: MaestroConfigV3 = {
      ...defaultish,
      workflow_instances: [
        ...defaultish.workflow_instances,
        { name: "unplaced", agent: "maestro:refactor", loaded_skills: [], referenced_skills: [] },
        { name: "backend-2", agent: "maestro:backend", loaded_skills: [], referenced_skills: [] },
      ],
      workflows: [
        ...defaultish.workflows,
        { name: "two", nodes: [{ id: "b2", type: "agent", instance: "backend-2" }], edges: [] },
      ],
    };
    expect(placedAgents(cfg).sort()).toEqual(["backend", "scribe", "test"]);
  });

  const input = (over: Partial<BriefInput> = {}): BriefInput => ({
    cfg: defaultish,
    meeting: { id: "m-1", mode: "review", dir: "/x/maestro_sessions/s/meeting" },
    participants: ["backend", "test"],
    agents: [
      { name: "backend", tier: "project", path: ".claude/agents/backend.md", tools: "Read, Edit" },
      { name: "test", tier: "plugin", path: "plugin agent maestro:test", tools: null },
    ],
    rules: [{ id: "python", path: ".claude/rules/python.md", inConfig: true }],
    handoffFiles: [".claude/handoffs/backend/test.md"],
    reportFiles: [],
    evidence: { digest: null, postmortemsLog: null, taskPostMortems: [] },
    ...over,
  });

  it("the common brief names the round-file location, the workflows and every agent", () => {
    const md = buildCommonBrief(input());
    expect(md).toContain("/x/maestro_sessions/s/meeting/round-<n>/<your agent name>.json");
    expect(md).toMatch(/\*\*default\*\*/);
    expect(md).toContain("| backend | project | .claude/agents/backend.md | Read, Edit |");
    expect(md).toContain("| test | plugin | plugin agent maestro:test | all |");
    expect(md).toContain("(listed in maestro.json");
    expect(md).toContain("_No recorded evidence");
  });

  it("the common brief clips a long postmortems.log to its tail", () => {
    const log = "OLD".repeat(5000) + "NEWEST-LINE";
    const md = buildCommonBrief(input({ evidence: { digest: "# d", postmortemsLog: log, taskPostMortems: [] } }));
    expect(md).toContain("earlier entries clipped");
    expect(md).toContain("NEWEST-LINE");
    expect(md.length).toBeLessThan(log.length);
    expect(md).not.toContain("_No recorded evidence");
  });

  it("an agent's slice lists its instances, skills and its own handoff templates only", () => {
    const md = buildAgentBrief(input(), "maestro:backend");
    expect(md).toMatch(/^# Your slice — backend/);
    expect(md).toContain("loaded: expressjs");
    expect(md).toContain("referenced: confidence-check");
    expect(md).toContain(".claude/handoffs/backend/test.md");
    const unknown = buildAgentBrief(input(), "nobody");
    expect(unknown).toContain("(not found)");
    expect(unknown).toContain("_Not placed on any workflow._");
  });
});

// ── meeting-mode.ts ────────────────────────────────────────────────────────

describe("meeting-mode", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-meeting-"));
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  const good = { id: "m-1", mode: "review", dir: "/d", participants: ["maestro:backend", "test"], started_at: "t" };

  it("readMeeting treats every malformed value as no meeting, and bares participants", () => {
    expect(readMeeting(null)).toBeNull();
    expect(readMeeting({})).toBeNull();
    expect(readMeeting({ meeting: "yes" })).toBeNull();
    expect(readMeeting({ meeting: { ...good, id: "" } })).toBeNull();
    expect(readMeeting({ meeting: { ...good, mode: "party" } })).toBeNull();
    expect(readMeeting({ meeting: { ...good, dir: 3 } })).toBeNull();
    expect(readMeeting({ meeting: { ...good, participants: "backend" } })).toBeNull();
    expect(readMeeting({ meeting: { ...good, participants: ["a", 1] } })).toBeNull();
    expect(readMeeting({ meeting: good })?.participants).toEqual(["backend", "test"]);
  });

  it("meetingFor matches participants bare on both sides and never the main session", () => {
    const s = { meeting: good };
    expect(meetingFor(s, "backend")).not.toBeNull();
    expect(meetingFor(s, "maestro:test")).not.toBeNull();
    expect(meetingFor(s, "reviewer")).toBeNull();
    expect(meetingFor(s, "")).toBeNull();
    expect(meetingFor(s, null)).toBeNull();
    expect(meetingFor({}, "backend")).toBeNull();
  });

  it("withoutMeeting drops only the meeting key and does not mutate its input", () => {
    const s = { workflow: "w", run_id: "r", meeting: good, extra: 1 };
    expect(withoutMeeting(s)).toEqual({ workflow: "w", run_id: "r", extra: 1 });
    expect(s.meeting).toBe(good);
  });

  it("startMeeting/endMeeting keep run_id, worktree and unknown keys (leak test 8)", () => {
    const sessDir = path.join(tmp, "maestro_sessions", "s1");
    const state = path.join(sessDir, "session.json");
    fs.mkdirSync(sessDir, { recursive: true });
    const before = {
      workflow: "build",
      generated_instances: ["x"],
      run_id: "run-123",
      worktree: { path: "/wt", branch: "b", main_root: "/m" },
      active_task: "001-a.md",
      future_key: { nested: [1, 2] },
    };
    fs.writeFileSync(state, JSON.stringify(before));

    const m = startMeeting(state, sessDir, {
      mode: "post-mortem",
      participants: ["maestro:backend", "backend", "", "test"],
      now: new Date(1000),
    });
    expect(m).toEqual({
      id: "m-1000",
      mode: "post-mortem",
      dir: meetingDirFor(sessDir),
      participants: ["backend", "test"],
      started_at: new Date(1000).toISOString(),
    });
    expect(fs.statSync(meetingDirFor(sessDir)).isDirectory()).toBe(true);
    const during = JSON.parse(fs.readFileSync(state, "utf8"));
    expect(during).toEqual({ ...before, meeting: m });
    expect(fs.existsSync(state + ".tmp")).toBe(false);

    // A second start replaces the meeting and still keeps everything else.
    const m2 = startMeeting(state, sessDir, { mode: "review", participants: ["scribe"], now: new Date(2000) });
    expect(JSON.parse(fs.readFileSync(state, "utf8"))).toEqual({ ...before, meeting: m2 });

    expect(endMeeting(state)).toBe(true);
    expect(JSON.parse(fs.readFileSync(state, "utf8"))).toEqual(before);
    // The transcript directory survives an end.
    expect(fs.existsSync(meetingDirFor(sessDir))).toBe(true);
    // Idempotent.
    expect(endMeeting(state)).toBe(false);
    expect(JSON.parse(fs.readFileSync(state, "utf8"))).toEqual(before);
  });

  it("endMeeting on a missing file writes nothing; startMeeting creates one from nothing", () => {
    const sessDir = path.join(tmp, "maestro_sessions", "s2");
    const state = path.join(sessDir, "session.json");
    expect(endMeeting(state)).toBe(false);
    expect(fs.existsSync(state)).toBe(false);
    startMeeting(state, sessDir, { mode: "review", participants: ["a"] });
    expect(Object.keys(JSON.parse(fs.readFileSync(state, "utf8")))).toEqual(["meeting"]);
  });

  it("meetingNotice overrides routing, forbids channels and names the meeting directory", () => {
    const n = meetingNotice({ ...good, participants: ["backend"], mode: "review" }, "maestro:backend");
    expect(n).toMatch(/NOT a workflow step/);
    expect(n).toMatch(/Do not end with a HANDOFF: line/);
    expect(n).toMatch(/Do not write anything under \.claude\/channels\//);
    expect(n).toContain("/d/");
    expect(n).toContain("round-1/backend.json");
  });
});

// ── agent-runs (leak test 5) ───────────────────────────────────────────────

describe("agent-runs skip meeting turns (leak test 5)", () => {
  const log = [
    { kind: "dispatch", origin: "backend", agent_id: "wf-1" },
    { kind: "handoff", origin: "backend", agent_id: "wf-1", ts: "1" },
    { kind: "dispatch", origin: "backend", agent_id: "mt-1", meeting: true },
    { kind: "handoff", origin: "backend", agent_id: "mt-1", ts: "2", meeting: true },
    { kind: "handoff", origin: "maestro:test", agent_id: "mt-2", ts: "3", meeting: true },
  ];
  const session = { workflow: "default", generated_instances: [] };

  it("agentRunsFromLog leaves meeting entries out", () => {
    expect(agentRunsFromLog(log).map((r) => r.agentId)).toEqual(["wf-1"]);
  });

  it("resumeTarget returns the workflow run, never a later meeting run", () => {
    expect(resumeTarget(log, defaultish, session, "backend")).toBe("wf-1");
    // An agent whose ONLY completed run is a meeting turn has nothing to resume.
    expect(resumeTarget(log, defaultish, session, "test")).toBeNull();
  });

  it("only `meeting: true` exactly is skipped", () => {
    const truthy = [{ kind: "handoff", origin: "backend", agent_id: "x", meeting: "true" }];
    expect(agentRunsFromLog(truthy)).toHaveLength(1);
  });

  it("hasCompletedRun still counts a meeting run (a resumed participant is a resume)", () => {
    expect(hasCompletedRun(log, "mt-1")).toBe(true);
    expect(hasCompletedRun(log, "mt-2")).toBe(true);
    expect(hasCompletedRun(log, "nope")).toBe(false);
  });

  // A post-mortem meeting RESUMES a workflow agent by its existing agent_id, so the same id carries a
  // workflow handoff and then a meeting handoff. Its workflow run must no longer be resumable either.
  describe("an agent_id resumed into a meeting is dropped entirely", () => {
    const resumed = [
      { kind: "handoff", origin: "backend", agent_id: "A1" },
      { kind: "handoff", origin: "backend", agent_id: "A1", meeting: true },
    ];

    it("agentRunsFromLog returns [] and resumeTarget returns null", () => {
      expect(agentRunsFromLog(resumed)).toEqual([]);
      expect(resumeTarget(resumed, defaultish, session, "backend")).toBeNull();
      expect(resumeTarget(resumed, defaultish, session, "maestro:backend")).toBeNull();
    });

    it("the order of the two entries does not matter", () => {
      expect(agentRunsFromLog([...resumed].reverse())).toEqual([]);
    });

    it("control: an id that never had a meeting turn is still returned", () => {
      const mixed = [
        { kind: "handoff", origin: "backend", agent_id: "B0" },
        ...resumed,
        { kind: "handoff", origin: "frontend", agent_id: "F1" },
      ];
      expect(agentRunsFromLog(mixed).map((r) => r.agentId)).toEqual(["B0", "F1"]);
      // B0 is older than A1, but A1 is no longer a candidate — B0 is backend's latest workflow run.
      expect(resumeTarget(mixed, defaultish, session, "backend")).toBe("B0");
      expect(resumeTarget(mixed, defaultish, session, "frontend")).toBe("F1");
    });

    it("hasCompletedRun(lines, 'A1') is still true", () => {
      expect(hasCompletedRun(resumed, "A1")).toBe(true);
    });
  });
});

// ── deleteWorkflow ─────────────────────────────────────────────────────────

describe("deleteWorkflow", () => {
  const two: MaestroConfigV3 = {
    ...defaultish,
    workflow_instances: [
      ...defaultish.workflow_instances,
      { name: "docs-scribe", agent: "scribe", loaded_skills: [], referenced_skills: [] },
    ],
    workflows: [
      ...defaultish.workflows,
      {
        name: "docs",
        nodes: [
          { id: "s", type: "agent", instance: "docs-scribe" },
          { id: "b", type: "agent", instance: "backend" },
        ],
        edges: [],
      },
    ],
  };

  it("removes the workflow, keeps every instance and reports only the newly unplaced ones", () => {
    const r = deleteWorkflow(two, "docs");
    expect(r.errors).toEqual([]);
    expect(r.config.workflows.map((w) => w.name)).toEqual(["default"]);
    expect(r.config.workflow_instances).toEqual(two.workflow_instances);
    expect(r.unplacedInstances).toEqual(["docs-scribe"]);
    expect(two.workflows).toHaveLength(2); // pure
  });

  it("refuses an unknown name and the last workflow, returning the config unchanged", () => {
    const unknown = deleteWorkflow(two, "nope");
    expect(unknown.errors[0]).toMatch(/No workflow named "nope". Available: default, docs/);
    expect(unknown.config).toBe(two);
    const last = deleteWorkflow(defaultish, "default");
    expect(last.errors[0]).toMatch(/only workflow/);
    expect(last.config).toBe(defaultish);
  });
});
