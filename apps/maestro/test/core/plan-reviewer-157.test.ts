// `157` — the read-only plan-reviewer agent, through the REAL installed hooks, the REAL tracker and
// the REAL fork code. Nothing is mocked: the SubagentStart / SubagentStop / SessionEnd scripts are
// spawned from the copies `installRuntime` writes into `<project>/.claude/scripts/`, and the plugin's
// own copies are spawned from `plugins/maestro/scripts/` against a project that was never installed.
//
// The reviewer is on NO workflow. Every assertion here is about what the hooks must NOT do to it
// (routing, payload protocol, report format, handoff judgement) and what they must still do for a
// workflow agent — the control cases stop a silent harness from passing these vacuously.
//
// Every spawn pins HOME at this test's tmp dir and SETS or DELETES CLAUDE_CODE_SESSION_ID (`064`).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { forkAgent } from "../../src/core/agent-fork.js";
import { listTasks } from "../../src/core/tasks.js";
import { pinnedEnv } from "../helpers/env.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const AGENT_FILE = path.join(PLUGIN_ROOT, "agents", "plan-reviewer.md");
const PLUGIN_SCRIPTS = path.join(PLUGIN_ROOT, "scripts");
const SKILL_DIR = path.join(PLUGIN_ROOT, "skills", "to-maestro-tasks");

const SESS = "sess-157-review";
const TASK = "157-plan-review.md";

const succ = (from: string, to: string) =>
  ({ from, to, kind: "success", sourceHandle: "bottom", targetHandle: "top" }) as const;

// backend -> test is a real route with a payload, so the workflow-agent control has something to see.
const CFG = {
  version: 3,
  agents_available: ["backend", "test"],
  skills_available: [],
  workflow_instances: [
    { name: "backend", agent: "backend", loaded_skills: [], referenced_skills: [] },
    { name: "test", agent: "test", loaded_skills: [], referenced_skills: [] },
  ],
  workflows: [
    {
      name: "feature",
      nodes: [
        { id: "backend", type: "agent", instance: "backend", position: { x: 0, y: 100 } },
        { id: "test", type: "agent", instance: "test", position: { x: 0, y: 220 } },
      ],
      edges: [succ("main-session", "backend"), succ("backend", "test")],
    },
  ],
  rules: [],
} as unknown as MaestroConfigV3;

const REVIEW_TEXT = "F1 [coverage] Epic 2 owns no acceptance criterion.\nFindings: 1";

let tmp: string;
let home: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-157-")));
  home = path.join(tmp, "home");
  fs.mkdirSync(home, { recursive: true });
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────

function frontmatter(text: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  const out: Record<string, string> = {};
  if (!m) return out;
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function runHook(script: string, root: string, payload: Record<string, unknown>) {
  const r = spawnSync("node", [script], {
    input: JSON.stringify(payload),
    encoding: "utf8",
    env: pinnedEnv(home, { CLAUDE_PROJECT_DIR: root }),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function projectScript(root: string, name: string, args: string[], payload?: Record<string, unknown>) {
  const r = spawnSync("node", [path.join(root, ".claude", "scripts", name), ...args], {
    encoding: "utf8",
    env: pinnedEnv(home, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: SESS }),
    ...(payload !== undefined ? { input: JSON.stringify(payload) } : {}),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** The additionalContext a SubagentStart printed, or "" when it printed nothing. */
function ctxOf(stdout: string): string {
  if (!stdout.trim()) return "";
  return JSON.parse(stdout).hookSpecificOutput.additionalContext as string;
}

const sessionDir = (root: string) => path.join(root, ".claude", "maestro_sessions", SESS);
function setSession(root: string, state: Record<string, unknown>) {
  fs.mkdirSync(sessionDir(root), { recursive: true });
  fs.writeFileSync(path.join(sessionDir(root), "session.json"), JSON.stringify(state));
}
const readState = (root: string): Record<string, any> => {
  const f = path.join(sessionDir(root), "session.json");
  return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
};
const readLog = (root: string): Record<string, any>[] => {
  const f = path.join(sessionDir(root), "log.jsonl");
  if (!fs.existsSync(f)) return [];
  return fs
    .readFileSync(f, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
};
const handoffEntries = (root: string, id: string) =>
  readLog(root).filter((e) => e.kind === "handoff" && e.agent_id === id);

async function installed(): Promise<string> {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeConfig(root, CFG);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  return root;
}

/** A project with maestro.json and NO install: only the plugin's own copies can run in it. */
function bare(): string {
  const root = path.join(tmp, "bare");
  fs.mkdirSync(root, { recursive: true });
  execFileSync("git", ["init", "-q"], { cwd: root });
  writeConfig(root, CFG);
  return root;
}

const startPayload = (root: string, agent: string, id: string) => ({
  cwd: root,
  session_id: SESS,
  hook_event_name: "SubagentStart",
  agent_type: agent,
  agent_id: id,
});
const stopPayload = (root: string, agent: string, id: string, extra: Record<string, unknown>) => ({
  cwd: root,
  session_id: SESS,
  hook_event_name: "SubagentStop",
  agent_type: agent,
  agent_id: id,
  ...extra,
});
const startProject = (root: string, agent: string, id: string) =>
  runHook(
    path.join(root, ".claude", "scripts", "maestro-inject-agent-context.cjs"),
    root,
    startPayload(root, agent, id)
  );
const stopProject = (root: string, agent: string, id: string, extra: Record<string, unknown>) =>
  runHook(path.join(root, ".claude", "scripts", "maestro-subagent-log.cjs"), root, stopPayload(root, agent, id, extra));

const handoffIssues = (root: string) => projectScript(root, "maestro-task-status.cjs", ["handoff-issues"]);

// ── the agent file ────────────────────────────────────────────────────────────────────────────────

describe("plan-reviewer agent file (157)", () => {
  const text = fs.readFileSync(AGENT_FILE, "utf8");
  const fm = frontmatter(text);
  const WRITE_CAPABLE = ["Write", "Edit", "MultiEdit", "NotebookEdit", "Bash", "Agent"];

  it("is named plan-reviewer and pinned to Opus", () => {
    expect(fm.name).toBe("plan-reviewer");
    expect(fm.model).toBe("opus");
  });

  it("grants exactly the read-only tools, with no write-capable or shell tool", () => {
    const tools = (fm.tools ?? "")
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean)
      .sort();
    expect(tools).toEqual(["Glob", "Grep", "Read"]);
    for (const t of WRITE_CAPABLE) expect(tools, t).not.toContain(t);
  });

  it("is described as a plan critic, not a code architect or designer", () => {
    expect(fm.description).toMatch(/plan critic/i);
    expect(fm.description).toMatch(/not a code architect/i);
    expect(fm.description).toMatch(/not a designer/i);
  });

  it("states in its body that it is read-only and writes no files", () => {
    expect(text).toMatch(/\*\*read-only\*\*/);
    expect(text).toMatch(/writes no files/i);
  });

  it("a fork through the real forkAgent keeps the model and tools lines byte-for-byte", async () => {
    const root = path.join(tmp, "fork-root");
    fs.mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
    const stores = path.join(tmp, "stores");
    fs.mkdirSync(stores);
    const dbPaths = {
      avatar: path.join(stores, "avatars.sqlite"),
      agentTypes: path.join(stores, "agent-types.sqlite"),
      agentProjectTags: path.join(stores, "agent-project-tags.sqlite"),
    };
    await forkAgent(root, AGENTS_DIR(), "0.14.0", "plan-reviewer", undefined, dbPaths);
    const forked = fs.readFileSync(path.join(root, ".claude", "agents", "plan-reviewer.md"), "utf8");
    expect(forked).toBe(text);
    expect(frontmatter(forked).model).toBe("opus");
    expect(frontmatter(forked).tools).toBe(fm.tools);
  });
});

function AGENTS_DIR(): string {
  return path.dirname(AGENT_FILE);
}

// ── SubagentStart: off-workflow injection ─────────────────────────────────────────────────────────

describe.each(["plan-reviewer", "maestro:plan-reviewer"])(
  "SubagentStart for %s, installed project copy (157)",
  (agent) => {
    it("no active workflow: prints nothing at all", async () => {
      const root = await installed();
      const r = startProject(root, agent, "pr-1");
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe("");
    }, 60_000);

    it("an active workflow that does not place the reviewer: prints nothing", async () => {
      const root = await installed();
      setSession(root, { workflow: "feature" });
      const r = startProject(root, agent, "pr-2");
      expect(r.code, r.stderr).toBe(0);
      expect(r.stdout).toBe("");
    }, 60_000);

    it("a broken active workflow name (union fallback) still injects no routing or payload", async () => {
      const root = await installed();
      setSession(root, { workflow: "ghost-workflow" });
      const ctx = ctxOf(startProject(root, agent, "pr-3").stdout);
      expect(ctx).not.toMatch(/HANDOFF/);
      expect(ctx).not.toMatch(/Handoff routing/);
      expect(ctx).not.toMatch(/channels\//);
      expect(ctx).not.toMatch(/Skills (to load|available)/);
    }, 60_000);

    it("a worktree session gets only the worktree notice, as its single part", async () => {
      const root = await installed();
      const wt = path.join(tmp, "wt-157");
      setSession(root, {
        workflow: "feature",
        worktree: { path: wt, branch: "task-157", main_root: root },
      });
      const ctx = ctxOf(startProject(root, agent, "pr-4").stdout);
      expect(ctx.startsWith("Git worktree:")).toBe(true);
      expect(ctx.split("\n\n---\n\n")).toHaveLength(1);
      expect(ctx).not.toMatch(/Handoff routing|HANDOFF: (success|tests_failed)/);
      expect(ctx).not.toMatch(/Mandatory output format/);
    }, 60_000);

    it("a resumed run (already stopped once) repeats no routing and no payload protocol", async () => {
      const root = await installed();
      setSession(root, { workflow: "feature" });
      startProject(root, agent, "pr-5");
      stopProject(root, agent, "pr-5", { last_assistant_message: REVIEW_TEXT });
      const resumed = ctxOf(startProject(root, agent, "pr-5").stdout);
      expect(resumed).not.toMatch(/HANDOFF/);
      expect(resumed).not.toMatch(/Handoff routing/);
      expect(resumed).not.toMatch(/channels\//);
    }, 60_000);
  }
);

describe("SubagentStart: the explicit report mapping is the only format that reaches the reviewer (157)", () => {
  it("with no reports mapping and no global default, nothing is injected", async () => {
    const root = await installed();
    const r = startProject(root, "plan-reviewer", "pr-6");
    expect(r.stdout).toBe("");
  }, 60_000);

  it("a project that deliberately maps reports.plan-reviewer gets that format (the project's own choice)", async () => {
    const root = await installed();
    const cfg = JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8"));
    cfg.reports = { "plan-reviewer": { id: "plan-reviewer-report" } };
    fs.writeFileSync(path.join(root, ".claude", "maestro.json"), JSON.stringify(cfg));
    fs.mkdirSync(path.join(root, ".claude", "reports"), { recursive: true });
    fs.writeFileSync(path.join(root, ".claude", "reports", "plan-reviewer-report.md"), "REPORT-PLAN-REVIEWER-157");
    const ctx = ctxOf(startProject(root, "plan-reviewer", "pr-7").stdout);
    expect(ctx).toContain("REPORT-PLAN-REVIEWER-157");
    expect(ctx).not.toMatch(/HANDOFF/);
  }, 60_000);
});

// ── SubagentStart: the plugin's own copy, in a project that was never installed ──────────────────

describe("SubagentStart plugin copy in a non-installed project (157)", () => {
  const plugin = path.join(PLUGIN_SCRIPTS, "maestro-inject-agent-context.js");

  it("prints nothing for the reviewer, with or without an active workflow", () => {
    const root = bare();
    expect(runHook(plugin, root, startPayload(root, "plan-reviewer", "pb-1")).stdout).toBe("");
    setSession(root, { workflow: "feature" });
    expect(runHook(plugin, root, startPayload(root, "plan-reviewer", "pb-2")).stdout).toBe("");
  }, 60_000);

  it("control: the same copy does route a workflow agent, so the harness is not silent", () => {
    const root = bare();
    setSession(root, { workflow: "feature" });
    const ctx = ctxOf(runHook(plugin, root, startPayload(root, "backend", "pb-3")).stdout);
    expect(ctx).toMatch(/HANDOFF: success/);
    expect(ctx).toMatch(/Handoff routing/);
  }, 60_000);
});

// ── SubagentStop: judged never, logged as unknown ─────────────────────────────────────────────────

describe("SubagentStop for the reviewer is logged, never judged (157)", () => {
  it("a final message with no HANDOFF line: logged unknown, no issue, handoff-issues clean", async () => {
    const root = await installed();
    setSession(root, { workflow: "feature" });
    startProject(root, "plan-reviewer", "ps-1");
    const r = stopProject(root, "plan-reviewer", "ps-1", { last_assistant_message: REVIEW_TEXT });
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).not.toMatch(/systemMessage|handoff problem/);
    const entries = handoffEntries(root, "ps-1");
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("unknown");
    expect(entries[0].handoff_issue).toBeUndefined();
    expect(entries[0].interim).toBeUndefined();
    expect(readState(root).handoff_issues ?? []).toEqual([]);
    expect(readState(root).pending_interim ?? {}).toEqual({});
    expect(handoffIssues(root).stdout).toMatch(/no problems recorded/);
  }, 60_000);

  it("a stop with no hand-back call in its transcript is not an interim stop and not an issue", async () => {
    const root = await installed();
    setSession(root, { workflow: "feature" });
    startProject(root, "plan-reviewer", "ps-2");
    const transcript = path.join(tmp, "reviewer-ps-2.jsonl");
    fs.writeFileSync(
      transcript,
      JSON.stringify({
        type: "user",
        promptId: "P",
        timestamp: "2099-01-01T00:00:00.000Z",
        message: { role: "user", content: "review" },
      }) +
        "\n" +
        JSON.stringify({
          type: "assistant",
          timestamp: "2099-01-01T00:00:01.000Z",
          message: { content: [{ type: "text", text: "Still reading the repo." }] },
        }) +
        "\n"
    );
    const r = stopProject(root, "plan-reviewer", "ps-2", {
      last_assistant_message: "Still reading the repo.",
      agent_transcript_path: transcript,
    });
    expect(r.code, r.stderr).toBe(0);
    const [e] = handoffEntries(root, "ps-2");
    expect(e.interim).toBeUndefined();
    expect(e.handoff_issue).toBeUndefined();
    expect(readState(root).pending_interim ?? {}).toEqual({});
    expect(handoffIssues(root).stdout).toMatch(/no problems recorded/);
  }, 60_000);

  it("a HANDOFF line the reviewer should not write is logged, not judged", async () => {
    const root = await installed();
    setSession(root, { workflow: "feature" });
    startProject(root, "plan-reviewer", "ps-3");
    stopProject(root, "plan-reviewer", "ps-3", { last_assistant_message: `${REVIEW_TEXT}\nHANDOFF: tests_failed` });
    const [e] = handoffEntries(root, "ps-3");
    expect(e.status).toBe("condition");
    expect(e.handoff_issue).toBeUndefined();
    expect(readState(root).handoff_issues ?? []).toEqual([]);
  }, 60_000);

  it("a resumed reviewer that stops again is still never judged", async () => {
    const root = await installed();
    setSession(root, { workflow: "feature" });
    startProject(root, "plan-reviewer", "ps-4");
    stopProject(root, "plan-reviewer", "ps-4", { last_assistant_message: "F1 [assumption] sketch only" });
    startProject(root, "plan-reviewer", "ps-4");
    stopProject(root, "plan-reviewer", "ps-4", { last_assistant_message: REVIEW_TEXT });
    expect(handoffEntries(root, "ps-4")).toHaveLength(2);
    expect(readState(root).handoff_issues ?? []).toEqual([]);
    expect(readState(root).pending_interim ?? {}).toEqual({});
    expect(handoffIssues(root).stdout).toMatch(/no problems recorded/);
  }, 60_000);

  it("control: a workflow agent with no HANDOFF line IS flagged, so the judgement path is live", async () => {
    const root = await installed();
    setSession(root, { workflow: "feature" });
    startProject(root, "backend", "ps-ctl");
    stopProject(root, "backend", "ps-ctl", { last_assistant_message: "done, no label" });
    expect((readState(root).handoff_issues ?? []).length).toBeGreaterThan(0);
    expect(handoffIssues(root).stdout).not.toMatch(/no problems recorded/);
  }, 60_000);
});

// ── the tracker never reads views/ as a task ──────────────────────────────────────────────────────

describe("the .claude/maestro-tasks/views/ folder is not a task (157)", () => {
  async function queueWithViews(): Promise<string> {
    const root = await installed();
    const dir = path.join(root, ".claude", "maestro-tasks");
    fs.mkdirSync(path.join(dir, "views", "nested"), { recursive: true });
    fs.writeFileSync(path.join(dir, TASK), "# Plan review\n\n## Blocked by\n\nNone\n");
    fs.writeFileSync(path.join(dir, "157-plan-review.review.md"), "## Changed\n");
    fs.writeFileSync(path.join(dir, "views", "plan-view-157.html"), "<!doctype html><title>plan</title>");
    fs.writeFileSync(path.join(dir, "views", "stray.md"), "# not a task\n");
    fs.writeFileSync(path.join(dir, "views", "nested", "deep.md"), "# not a task\n");
    return root;
  }

  it("the app's listTasks returns only the top-level task file", async () => {
    const root = await queueWithViews();
    const tasks = listTasks(root);
    expect(tasks.map((t) => t.filename)).toEqual([TASK]);
  }, 60_000);

  it("the maestro-tasks.cjs sync (the orchestrator's twin) writes status.json for that task alone", async () => {
    const root = await queueWithViews();
    const r = projectScript(root, "maestro-task-status.cjs", ["sync"]);
    expect(r.code, r.stderr).toBe(0);
    const status = JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro-tasks", "status.json"), "utf8"));
    expect(Object.keys(status)).toEqual([TASK]);
  }, 60_000);

  it.each([
    ["the project-local .cjs copy", false],
    ["the plugin's .sh", true],
  ])(
    "SessionEnd via %s keeps views/ on a final end and on a resumable end",
    async (_name, isSh) => {
      for (const reason of ["clear", "prompt_input_exit"]) {
        const root = await queueWithViews();
        setSession(root, { workflow: "feature" });
        const payload = { cwd: root, session_id: SESS, hook_event_name: "SessionEnd", reason };
        if (isSh) {
          const r = spawnSync("bash", [path.join(PLUGIN_SCRIPTS, "maestro-session-cleanup.sh")], {
            input: JSON.stringify(payload),
            encoding: "utf8",
            env: pinnedEnv(home, { CLAUDE_PROJECT_DIR: root, CLAUDE_CODE_SESSION_ID: SESS }),
          });
          expect(r.status, `${reason}: ${r.stderr}`).toBe(0);
        } else {
          const r = projectScript(root, "maestro-session-cleanup.cjs", [], payload);
          expect(r.code, `${reason}: ${r.stderr}`).toBe(0);
        }
        const views = path.join(root, ".claude", "maestro-tasks", "views");
        expect(fs.existsSync(path.join(views, "plan-view-157.html")), reason).toBe(true);
        expect(fs.existsSync(path.join(views, "nested", "deep.md")), reason).toBe(true);
        // Vacuity guard: the same end does remove the per-session directory on a final reason.
        if (reason === "clear") expect(fs.existsSync(sessionDir(root))).toBe(false);
      }
    },
    120_000
  );
});

// ── skill prose the acceptance criteria name ──────────────────────────────────────────────────────

describe("to-maestro-tasks reference files (157)", () => {
  const read = (rel: string) => fs.readFileSync(path.join(SKILL_DIR, rel), "utf8");

  it("the skill description triggers on explain, show and visualize requests", () => {
    const fmBlock = /^---\n([\s\S]*?)\n---/.exec(read("SKILL.md"))?.[1] ?? "";
    expect(fmBlock).toMatch(/explain/i);
    expect(fmBlock).toMatch(/show/i);
    expect(fmBlock).toMatch(/visualize/i);
  });

  it("plan-review.md covers every topic the acceptance criteria name", () => {
    const text = read("references/plan-review.md");
    const topics: [string, RegExp][] = [
      ["triggers", /trigger|when review runs/i],
      ["Gate 1", /Gate 1/],
      ["Gate 2", /Gate 2/],
      ["equal footing / fresh reviewer", /equal footing|fresh/i],
      ["blind sketch", /blind sketch/i],
      ["numbered findings", /numbered/i],
      ["planner's answer per finding", /answer/i],
      ["verbatim relay", /verbatim/i],
      ["questions only on disputes", /disput/i],
      ["reopen by ID", /reopen/i],
      ["one automatic response", /one automatic response/i],
      ["user-controlled rounds", /rounds?/i],
      ["Continue review", /\bContinue\b/],
      ["Fresh review", /\bFresh\b/],
      ["fallback when follow-up is unavailable", /unavailable|can(?:not|'t) (?:send|follow)|no follow-up/i],
    ];
    for (const [name, re] of topics) expect(text, name).toMatch(re);
  });

  it("plan-view.md's HTML skeleton has no external asset, script or stylesheet", () => {
    const text = read("references/plan-view.md");
    const html = /```html\n([\s\S]*?)```/.exec(text)?.[1];
    expect(html, "skeleton block present").toBeTruthy();
    expect(html!).toMatch(/<!doctype html>/i);
    expect(html!).not.toMatch(/<script\b|<link\b|<img\b|@import|url\(\s*['"]?https?:|(?:src|href)\s*=\s*["']?https?:/i);
  });

  it("no plan-view renderer script ships under plugins/maestro/scripts", () => {
    const names = fs.readdirSync(PLUGIN_SCRIPTS);
    expect(names.filter((n) => /plan[-_]?view|plan[-_]?render/i.test(n))).toEqual([]);
  });
});
