// `163` through the REAL installed scripts: in a git-worktree session every channel path shown to an
// agent or to the orchestrator is the ABSOLUTE main-checkout path (the agent would resolve a relative
// one against its worktree), and the channel write guard accepts exactly that path and still confines
// the writer to the session's own scope. Outside a worktree the text and the guard are unchanged.
// Real git repos and real worktrees under os.tmpdir(); HOME pinned and CLAUDE_CODE_SESSION_ID always
// set (never inherited). Nothing is mocked.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { channelPathFor } from "../../src/core/handoff-channels.js";
import { pinnedEnv } from "../helpers/env.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

vi.setConfig({ testTimeout: 60_000 });

const SA = "sess-163-aaa"; // main checkout, task 161
const SB = "sess-163-bbb"; // worktree, task 162
const A_TASK = "161-main.md";
const B_TASK = "162-worktree.md";
const A_SCOPE = "task-161";
const B_SCOPE = "task-162";

// main -> backend -> test -> scribe, test -> backend on "tests failed"; backend and test both have
// a report (the skill-gap note is part of the report injection).
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
  reports: { backend: { id: "backend" }, test: { id: "test" } },
  rules: [],
} as unknown as MaestroConfigV3;

let tmp: string;
let home: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-163-")));
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

function liveSession(root: string, id: string) {
  const dir = path.join(root, ".claude", "maestro_sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "log.jsonl"), '{"kind":"tool_call"}\n');
}

/** Session SA holds A_TASK in the main checkout; session SB holds B_TASK in a worktree. */
async function setup(): Promise<{ root: string; wt: string }> {
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
  fs.mkdirSync(path.join(root, ".claude", "reports"), { recursive: true });
  for (const id of ["backend", "test"])
    fs.writeFileSync(path.join(root, ".claude", "reports", `${id}.md`), `Report ${id}.\n`);
  fs.writeFileSync(path.join(root, "app.txt"), "main\n");
  fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
  for (const f of [A_TASK, B_TASK])
    fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", f), `# ${f}\n\n## Blocked by\n\nNone\n`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  liveSession(root, SA);
  liveSession(root, SB);
  ok(script(root, SA, "maestro-task-status.cjs", ["claim", A_TASK]));
  ok(script(root, SB, "maestro-task-status.cjs", ["claim", B_TASK]));
  ok(script(root, SB, "maestro-task-status.cjs", ["worktree", B_TASK]));
  ok(script(root, SA, "maestro-set-session-workflow.cjs", ["feature", "--task", A_TASK]));
  ok(script(root, SB, "maestro-set-session-workflow.cjs", ["feature", "--task", B_TASK]));
  return { root, wt: path.join(path.dirname(root), `${path.basename(root)}-task-162`) };
}

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

function resume(root: string, sess: string, agent: string): string[] {
  return ok(script(root, sess, "maestro-resume-target.cjs", [agent]))
    .stdout.split("\n")
    .filter(Boolean);
}

const lane = (root: string, ...parts: string[]) => path.join(root, ".claude", "channels", ...parts);
const rel = (...parts: string[]) => path.posix.join(".claude", "channels", ...parts);
function put(file: string, body: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

describe("channelPathFor (163)", () => {
  it("is absolute in a worktree session and the relative path unchanged anywhere else", () => {
    const r = rel("task-1", "test", "backend.1.md");
    expect(channelPathFor(r, { main_root: "/repo" })).toBe(`/repo/${r}`);
    expect(channelPathFor(r, { main_root: "/repo/" })).toBe(`/repo/${r}`);
    expect(channelPathFor(r)).toBe(r);
    expect(channelPathFor(r, null)).toBe(r);
    expect(channelPathFor(r, { main_root: "" })).toBe(r);
  });
});

describe("injected channel paths (163)", () => {
  it("a worktree session is told the absolute main-checkout path for routes, waiting payloads and the skill-gap note", async () => {
    const { root } = await setup();
    // A payload waiting for backend that is not from this run: it is MENTIONED, by path.
    put(lane(root, B_SCOPE, "backend", "test.1.md"), "not stamped by this run\n");

    const ctx = start(root, SB, "backend", "b1");
    const abs = (...p: string[]) => `${root}/${rel(...p)}`;

    // Route to write.
    expect(ctx).toContain(`write this to \`${abs(B_SCOPE, "test", "backend.1.md")}\``);
    // Payload to read.
    expect(ctx).toContain(`\`${abs(B_SCOPE, "backend", "test.1.md")}\``);
    // Skill-gap note.
    expect(ctx).toContain(`goes under \`${abs(B_SCOPE)}/\``);
    expect(ctx).toContain(`a skill-gap report is \`${abs(B_SCOPE, "scribe", "backend.1.md")}\``);
    // No channel path is shown relative: every backticked occurrence is the absolute one.
    expect(ctx).not.toMatch(/`\.claude\/channels\//);
  });

  it("a cold start's delivered-lane heading is the absolute lane directory", async () => {
    const { root } = await setup();
    start(root, SB, "backend", "b1");
    put(lane(root, B_SCOPE, "test", "backend.1.md"), "payload\n");
    stop(root, SB, "backend", "b1", '"verdict": "SUCCESS"\nHANDOFF: success');
    const ctx = start(root, SB, "test", "t1");
    expect(ctx).toContain(`Delivered to your channel (\`${root}/${rel(B_SCOPE, "test")}/\`)`);
  });

  it("outside a worktree the injected text keeps the relative paths, byte for byte", async () => {
    const { root } = await setup();
    put(lane(root, A_SCOPE, "backend", "test.1.md"), "not stamped by this run\n");
    const ctx = start(root, SA, "backend", "a1");
    expect(ctx).toContain(`write this to \`${rel(A_SCOPE, "test", "backend.1.md")}\``);
    expect(ctx).toContain(`\`${rel(A_SCOPE, "backend", "test.1.md")}\``);
    expect(ctx).toContain(`a skill-gap report is \`${rel(A_SCOPE, "scribe", "backend.1.md")}\``);
    expect(ctx).not.toContain(`${root}/.claude/channels/`);
  });
});

describe("resume-target paths (163)", () => {
  /** test runs and fails, backend then writes its payload for test: the next resume of test is handed it. */
  function testFailedThenBackendWrites(root: string, sess: string, scope: string) {
    start(root, sess, "test", "t1");
    stop(root, sess, "test", "t1", '"verdict": "FAIL"\nHANDOFF: tests failed');
    start(root, sess, "backend", "b1");
    put(lane(root, scope, "test", "backend.1.md"), '{"fix":"x"}\n');
    stop(root, sess, "backend", "b1", '"verdict": "SUCCESS"\nHANDOFF: success');
  }

  it("every deliver: line in a worktree session is the absolute main-checkout path", async () => {
    const { root } = await setup();
    testFailedThenBackendWrites(root, SB, B_SCOPE);
    expect(resume(root, SB, "test")).toEqual(["t1", `deliver: ${root}/${rel(B_SCOPE, "test", "backend.1.md")}`]);
  });

  it("a missing: line in a worktree session is absolute too, and the stored issue stays relative", async () => {
    const { root, wt } = await setup();
    start(root, SB, "test", "t1");
    stop(root, SB, "test", "t1", '"verdict": "FAIL"\nHANDOFF: tests failed');
    start(root, SB, "backend", "b1");
    // backend ends without writing its payload for test.
    stop(root, SB, "backend", "b1", '"verdict": "SUCCESS"\nHANDOFF: success');
    const lines = resume(root, SB, "test");
    expect(lines).toEqual(["t1", `missing: ${root}/${rel(B_SCOPE, "test", "backend.1.md")} (from backend)`]);
    const state = JSON.parse(
      fs.readFileSync(path.join(wt, ".claude", "maestro_sessions", SB, "session.json"), "utf8")
    ) as { handoff_issues?: { kind: string; files?: string[] }[] };
    const files = (state.handoff_issues ?? []).flatMap((i) => (i.kind === "missing_payload" ? (i.files ?? []) : []));
    expect(files).toContain(rel(B_SCOPE, "test", "backend.1.md"));
    expect(files.every((f) => !path.isAbsolute(f))).toBe(true);
  });

  it("a payload restored after a resumable session end is delivered as an absolute path, and recorded relative", async () => {
    const { root, wt } = await setup();
    testFailedThenBackendWrites(root, SB, B_SCOPE);
    expect(resume(root, SB, "test")[1]).toBe(`deliver: ${root}/${rel(B_SCOPE, "test", "backend.1.md")}`);
    // The resumed run is cut off by the restart: no HANDOFF line, its delivered file is retired.
    stop(root, SB, "test", "t1", "Cut off by the restart before the report.");
    expect(fs.existsSync(lane(root, B_SCOPE, ".consumed", "test", "backend.1.md"))).toBe(true);
    ok(
      script(root, SB, "maestro-session-cleanup.cjs", [], {
        cwd: root,
        session_id: SB,
        hook_event_name: "SessionEnd",
        reason: "resume",
      })
    );

    const lines = resume(root, SB, "test");
    expect(lines).toEqual(["t1", `deliver: ${root}/${rel(B_SCOPE, "test", "backend.1.md")}`]);
    expect(lines.some((l) => l.startsWith("missing:"))).toBe(false);
    const state = JSON.parse(
      fs.readFileSync(path.join(wt, ".claude", "maestro_sessions", SB, "session.json"), "utf8")
    ) as { resume_deliveries?: Record<string, { file: string }[]> };
    expect(state.resume_deliveries?.t1?.map((d) => d.file)).toEqual([rel(B_SCOPE, "test", "backend.1.md")]);
  });

  it("outside a worktree the deliver: line stays project-relative", async () => {
    const { root } = await setup();
    testFailedThenBackendWrites(root, SA, A_SCOPE);
    expect(resume(root, SA, "test")).toEqual(["t1", `deliver: ${rel(A_SCOPE, "test", "backend.1.md")}`]);
  });
});

describe("channel write guard (163)", () => {
  function guard(root: string, sess: string, cwd: string, agent: string, file: string) {
    const r = ok(
      script(root, sess, "maestro-channel-write-guard.cjs", [], {
        cwd,
        session_id: sess,
        hook_event_name: "PreToolUse",
        agent_type: agent,
        tool_name: "Write",
        tool_input: { file_path: file },
      })
    );
    return r.stdout.trim() ? (JSON.parse(r.stdout).hookSpecificOutput.permissionDecision as string) : "allow";
  }

  it.each(["backend", "reviewer"])(
    "a %s in a worktree session may write its payload at the absolute main-checkout path",
    async (agent) => {
      const { root, wt } = await setup();
      const own = lane(root, B_SCOPE, "test", `${agent}.1.md`);
      expect(guard(root, SB, wt, agent, own)).toBe("allow");
      expect(guard(root, SB, root, agent, own)).toBe("allow");
    }
  );

  it.each(["backend", "reviewer"])(
    "a %s in a worktree session is still denied another scope, the legacy layout and the main checkout's other files",
    async (agent) => {
      const { root, wt } = await setup();
      expect(guard(root, SB, wt, agent, lane(root, A_SCOPE, "test", `${agent}.1.md`))).toBe("deny");
      expect(guard(root, SB, wt, agent, lane(root, "test", `${agent}.1.md`))).toBe("deny");
      expect(guard(root, SB, wt, agent, path.join(root, "app.txt"))).toBe("deny");
      expect(guard(root, SB, wt, agent, lane(root, B_SCOPE, "..", A_SCOPE, "test", "x.md"))).toBe("deny");
    }
  );

  it("a worktree reviewer may still not write outside the channels, in the worktree itself", async () => {
    const { root, wt } = await setup();
    expect(guard(root, SB, wt, "reviewer", path.join(wt, "app.txt"))).toBe("deny");
  });

  it("a worktree backend's raw path with a '..' segment is denied even when it resolves into its own scope", async () => {
    // Not built with path.join, which would normalise the '..' away before the guard sees it.
    const { root, wt } = await setup();
    const raw = `${root}/.claude/channels/${B_SCOPE}/../${A_SCOPE}/test/backend.1.md`;
    expect(guard(root, SB, wt, "backend", raw)).toBe("deny");
    expect(guard(root, SB, root, "backend", raw)).toBe("deny");
  });

  it("a worktree backend cannot reach its own scope's absolute path through a symlinked scope in the main checkout", async () => {
    // The main checkout's scope directory for task 162 is a symlink to task 161's lane: the absolute
    // route is inside the lane by name but not inside the session's own scope.
    const { root, wt } = await setup();
    fs.mkdirSync(lane(root, A_SCOPE), { recursive: true });
    fs.rmSync(lane(root, B_SCOPE), { recursive: true, force: true });
    fs.symlinkSync(lane(root, A_SCOPE), lane(root, B_SCOPE), "dir");
    expect(guard(root, SB, wt, "backend", lane(root, B_SCOPE, "test", "backend.1.md"))).toBe("deny");
    expect(guard(root, SB, wt, "backend", lane(root, A_SCOPE, "test", "backend.1.md"))).toBe("deny");
  });

  it("outside a worktree the guard is unchanged: own scope allowed, another denied, nothing else", async () => {
    const { root } = await setup();
    expect(guard(root, SA, root, "reviewer", lane(root, A_SCOPE, "scribe", "reviewer.1.md"))).toBe("allow");
    expect(guard(root, SA, root, "reviewer", lane(root, B_SCOPE, "scribe", "reviewer.1.md"))).toBe("deny");
    expect(guard(root, SA, root, "reviewer", path.join(root, "app.txt"))).toBe("deny");
    expect(guard(root, SA, root, "backend", path.join(root, "app.txt"))).toBe("allow");
  });
});
