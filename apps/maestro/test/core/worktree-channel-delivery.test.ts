// `104` through the REAL installed scripts: a worktree run delivers channel payloads without a
// stall. Pins (1) the worktree note `handoff-issues` appends for a missing-payload issue, (2) the two
// bullets the SubagentStart worktree block gives subagents, (3) the orchestrator template wording.
// Real git repos under os.tmpdir(); HOME pinned and CLAUDE_CODE_SESSION_ID always set (never
// inherited) — see test-maestro's references/hook-script-tests.md.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { installRuntime, findUpPluginRoot } from "../../src/core/install.js";
import { writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;

vi.setConfig({ testTimeout: 30_000 });

const SESSION_A = "sess-104-aaa";
const SESSION_B = "sess-104-bbb";
const B_SCOPE = "session-sess-104";

let tmp: string;
beforeEach(() => {
  tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-104-")));
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

function hookEnv(projectDir: string, sessionId: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    CLAUDE_PROJECT_DIR: projectDir,
    HOME: tmp,
    CLAUDE_CODE_SESSION_ID: sessionId,
    GIT_AUTHOR_NAME: "t",
    GIT_AUTHOR_EMAIL: "t@t",
    GIT_COMMITTER_NAME: "t",
    GIT_COMMITTER_EMAIL: "t@t",
  };
}

function cli(dir: string, args: string[], sessionId: string) {
  const r = spawnSync("node", [path.join(dir, ".claude", "scripts", "maestro-task-status.cjs"), ...args], {
    encoding: "utf8",
    env: hookEnv(dir, sessionId),
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const sessionDir = (root: string, id: string) => path.join(root, ".claude", "maestro_sessions", id);
const stateFile = (root: string, id: string) => path.join(sessionDir(root, id), "session.json");

function liveSession(root: string, id: string) {
  fs.mkdirSync(sessionDir(root, id), { recursive: true });
  fs.writeFileSync(path.join(sessionDir(root, id), "log.jsonl"), '{"kind":"tool_call"}\n');
}

/** Session A (main checkout) holds 001; session B holds 002 in a worktree. */
async function setup(): Promise<{ root: string; wt: string }> {
  const root = path.join(tmp, "repo");
  fs.mkdirSync(root, { recursive: true });
  git(root, "init", "-q", "-b", "main");
  writeConfig(root, defaultish);
  await installRuntime(
    root,
    PLUGIN_ROOT,
    path.join(tmp, "report-defaults.sqlite"),
    path.join(tmp, "project-tags.sqlite"),
    path.join(tmp, "handoff-defaults.sqlite")
  );
  fs.writeFileSync(path.join(root, "app.txt"), "main\n");
  fs.mkdirSync(path.join(root, ".claude", "maestro-tasks"), { recursive: true });
  for (const f of ["001-a.md", "002-b.md"])
    fs.writeFileSync(path.join(root, ".claude", "maestro-tasks", f), `# ${f}\n\n## Blocked by\n\nNone\n`);
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
  liveSession(root, SESSION_A);
  liveSession(root, SESSION_B);
  cli(root, ["claim", "001-a.md"], SESSION_A);
  cli(root, ["claim", "002-b.md"], SESSION_B);
  cli(root, ["worktree", "002-b.md"], SESSION_B);
  return { root, wt: path.join(path.dirname(root), `${path.basename(root)}-task-002`) };
}

const missingPayload = {
  kind: "missing_payload",
  agent: "test",
  agent_id: "t1",
  label: "success",
  message: "Expected .claude/channels/reviewer/test.1.md.",
};

function seedIssues(root: string, id: string, issues: unknown[]) {
  const f = stateFile(root, id);
  const s = fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : {};
  s.handoff_issues = issues;
  fs.writeFileSync(stateFile(root, id), JSON.stringify(s));
}

describe("handoff-issues worktree note (104)", () => {
  it("a missing payload in a worktree run appends the note naming the main checkout's channels dir", async () => {
    const { root, wt } = await setup();
    seedIssues(wt, SESSION_B, [missingPayload]);

    const run = cli(wt, ["handoff-issues"], SESSION_B);
    expect(run.code, run.stderr).toBe(0);
    expect(run.stdout).toContain("NO PAYLOAD written for HANDOFF: success");
    expect(run.stdout).toContain("Worktree run");
    expect(run.stdout).toContain("YOU write the channel file");
    // `144`: the note names the main checkout and the scoped lane shape, scope included.
    expect(run.stdout).toContain(`${root}/<that path>`);
    expect(run.stdout).toContain(".claude/channels/<scope>/<receiver>/ path, scope included");
    expect(run.stdout).toContain("do not ask the user");
    expect(run.stdout).toContain("Never invent or reconstruct");
    expect(run.stdout).toContain("Name the file's path in the receiver's dispatch");
  });

  it("a worktree run with only a missing HANDOFF line gets no note", async () => {
    const { wt } = await setup();
    seedIssues(wt, SESSION_B, [{ kind: "missing", agent: "test", agent_id: "t1", message: "no line" }]);

    const run = cli(wt, ["handoff-issues"], SESSION_B);
    expect(run.stdout).toContain("NO HANDOFF line");
    expect(run.stdout).not.toContain("Worktree run");
  });

  it("a missing payload in a non-worktree session gets no note", async () => {
    const { root } = await setup();
    seedIssues(root, SESSION_A, [missingPayload]);

    const run = cli(root, ["handoff-issues"], SESSION_A);
    expect(run.stdout).toContain("NO PAYLOAD written");
    expect(run.stdout).not.toContain("Worktree run");
  });
});

describe("SubagentStart worktree block (104)", () => {
  function startHook(root: string, sessionId: string) {
    return spawnSync("node", [path.join(root, ".claude", "scripts", "maestro-inject-agent-context.cjs")], {
      encoding: "utf8",
      env: hookEnv(root, sessionId),
      input: JSON.stringify({
        hook_event_name: "SubagentStart",
        session_id: sessionId,
        agent_type: "backend",
        agent_id: "agent-1",
        cwd: root,
      }),
    });
  }

  it("gives the shell-starts-in-main bullet and the return-payload-in-final-message bullet", async () => {
    const { root, wt } = await setup();
    const run = startHook(root, SESSION_B);
    expect(run.status).toBe(0);
    const out = run.stdout;
    expect(out).toContain("Your shell does NOT start in the worktree");
    expect(out).toContain(`pnpm --dir ${wt}`);
    expect(out).toContain(`git -C ${wt}`);
    expect(out).toContain("Never `cd`");
    // `144`: B's own scoped lane. setup() claims 002 but never records `active_task`
    // (set-session-workflow --task), so B's scope is `session-<id8>`.
    expect(out).toContain(`${root}/.claude/channels/${B_SCOPE}/ is denied`);
    expect(out).toContain("include the full payload");
    expect(out).toContain("before your HANDOFF: line");
    expect(out).toContain("The orchestrator writes the channel file for you");
  });

  it("a non-worktree session gets neither bullet", async () => {
    const { root } = await setup();
    const out = startHook(root, SESSION_A).stdout;
    expect(out).not.toContain("Your shell does NOT start in the worktree");
    expect(out).not.toContain("The orchestrator writes the channel file for you");
  });
});

describe("orchestrator template Step 3 (104)", () => {
  it("tells the orchestrator not to resume for a retry in a worktree run, to write the file itself, and to name its path", () => {
    const tpl = fs.readFileSync(path.join(PLUGIN_ROOT, "templates", "maestro", "SKILL.md"), "utf8");
    expect(tpl).toContain("In a worktree run, don't resume it to retry the write");
    expect(tpl).toContain("`handoff-issues` then prints a worktree note");
    expect(tpl).toContain("You write the channel file yourself from the payload in the agent's final message");
    expect(tpl).toContain("name its path in the receiver's prompt");
    expect(tpl).toContain("It needs no user approval");
  });
});
