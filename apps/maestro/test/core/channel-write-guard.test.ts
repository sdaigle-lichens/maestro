// `078`: the reviewer/refactor agents may write ONLY under .claude/channels/. Pure module first,
// then the real hook script spawned against a temp project, then the SendMessage hand-back digest.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { checkChannelWrite } from "../../src/core/channel-write-guard.js";
import { sendMessageHandoff, lastHandoffLabel } from "../../src/core/handoff-label.js";
import { pinnedEnv } from "../helpers/env.js";

let root: string;
let outside: string;

beforeEach(() => {
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-guard-")));
  outside = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-guard-out-")));
  fs.mkdirSync(path.join(root, ".claude", "channels", "scribe"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(outside, { recursive: true, force: true });
});

/** This session's own channel scope (`144`) in every pure-module check below. */
const SCOPE = "task-045";
const OTHER = "task-048";

const check = (agentType: string, file: string, tool = "Write", channelScope: string | null = SCOPE) =>
  checkChannelWrite({ cwd: root, agentType, toolName: tool, toolInput: { file_path: file }, channelScope });

describe("checkChannelWrite", () => {
  it("allows a channel file in the session's own scope for reviewer and refactor, absolute or relative, existing dir or not", () => {
    expect(check("reviewer", path.join(root, `.claude/channels/${SCOPE}/scribe/reviewer.1.md`)).allow).toBe(true);
    expect(check("maestro:refactor", `.claude/channels/${SCOPE}/backend/refactor.1.md`).allow).toBe(true);
    expect(
      check("reviewer", `.claude/channels/session-abc12345/scribe/reviewer.1.md`, "Write", "session-abc12345").allow
    ).toBe(true);
  });

  // `144`: the 045/048 collision on the write side — a confined agent can never plant a payload in
  // a concurrent session's scope, nor in the legacy unscoped root nothing delivers any more.
  it("refuses another scope's lane, the legacy unscoped root, and the channels root itself", () => {
    for (const f of [
      `.claude/channels/${OTHER}/scribe/reviewer.1.md`,
      path.join(root, `.claude/channels/${OTHER}/backend/reviewer.1.md`),
      ".claude/channels/scribe/reviewer.1.md",
      ".claude/channels/backend/refactor.1.md",
      ".claude/channels/.consumed/scribe/reviewer.1.md",
      `.claude/channels/${SCOPE}`,
      ".claude/channels/a.md",
      `.claude/channels/session-none/scribe/reviewer.1.md`,
    ]) {
      const v = check("reviewer", f);
      expect(v.allow, f).toBe(false);
      if (!v.allow) expect(v.reason).toContain(`.claude/channels/${SCOPE}/`);
    }
  });

  it("fails closed when the scope is missing or not a scope", () => {
    for (const bad of [null, "", "scribe", ".consumed", "../task-045", "task-045/scribe"]) {
      const v = check("reviewer", `.claude/channels/${SCOPE}/scribe/reviewer.1.md`, "Write", bad);
      expect(v.allow, String(bad)).toBe(false);
    }
    expect(
      checkChannelWrite({
        cwd: root,
        agentType: "reviewer",
        toolName: "Write",
        toolInput: { file_path: `.claude/channels/${SCOPE}/scribe/reviewer.1.md` },
      }).allow
    ).toBe(false);
  });

  it("refuses a scope directory that is a symlink to another scope", () => {
    fs.mkdirSync(path.join(root, ".claude", "channels", OTHER, "scribe"), { recursive: true });
    fs.symlinkSync(path.join(root, ".claude", "channels", OTHER), path.join(root, ".claude", "channels", SCOPE));
    expect(check("reviewer", `.claude/channels/${SCOPE}/scribe/reviewer.1.md`).allow).toBe(false);
  });

  it("refuses a receiver dir inside the own scope that symlinks into another scope", () => {
    fs.mkdirSync(path.join(root, ".claude", "channels", OTHER, "scribe"), { recursive: true });
    fs.mkdirSync(path.join(root, ".claude", "channels", SCOPE), { recursive: true });
    fs.symlinkSync(
      path.join(root, ".claude", "channels", OTHER, "scribe"),
      path.join(root, ".claude", "channels", SCOPE, "scribe")
    );
    expect(check("reviewer", `.claude/channels/${SCOPE}/scribe/reviewer.1.md`).allow).toBe(false);
  });

  it("refuses everything outside the lanes, with a message naming the rule", () => {
    for (const f of [
      "src/app.ts",
      path.join(root, "CLAUDE.md"),
      ".claude/maestro.json",
      "/etc/passwd",
      ".claude/channelsX/a.md",
    ]) {
      const v = check("reviewer", f);
      expect(v.allow).toBe(false);
      if (!v.allow) expect(v.reason).toMatch(/\.claude\/channels/);
    }
  });

  it("refuses .. segments, even ones that land back inside", () => {
    expect(check("reviewer", ".claude/channels/../../src/x.ts").allow).toBe(false);
    expect(check("reviewer", `.claude/channels/${SCOPE}/scribe/../scribe/a.md`).allow).toBe(false);
    expect(check("reviewer", `.claude/channels/${OTHER}/../${SCOPE}/scribe/a.md`).allow).toBe(false);
  });

  it("refuses a symlinked lane directory pointing out of the project", () => {
    fs.mkdirSync(path.join(root, ".claude", "channels", SCOPE), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ".claude", "channels", SCOPE, "evil"));
    expect(check("reviewer", `.claude/channels/${SCOPE}/evil/x.md`).allow).toBe(false);
  });

  it("refuses a symlink file, live or dangling, pointing out of the lanes", () => {
    const lane = path.join(root, ".claude", "channels", SCOPE, "scribe");
    fs.mkdirSync(lane, { recursive: true });
    const live = path.join(outside, "target.md");
    fs.writeFileSync(live, "x");
    fs.symlinkSync(live, path.join(lane, "live.md"));
    fs.symlinkSync(path.join(outside, "nope.md"), path.join(lane, "dangling.md"));
    expect(check("reviewer", `.claude/channels/${SCOPE}/scribe/live.md`).allow).toBe(false);
    expect(check("reviewer", `.claude/channels/${SCOPE}/scribe/dangling.md`).allow).toBe(false);
  });

  it("refuses when .claude/channels itself is a symlink out of the project", () => {
    fs.rmSync(path.join(root, ".claude", "channels"), { recursive: true });
    fs.mkdirSync(path.join(outside, SCOPE), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ".claude", "channels"));
    expect(check("reviewer", ".claude/channels/a.md").allow).toBe(false);
    expect(check("reviewer", `.claude/channels/${SCOPE}/scribe/a.md`).allow).toBe(false);
  });

  it("covers Edit, MultiEdit and NotebookEdit; reads and other tools pass", () => {
    expect(check("reviewer", "src/a.ts", "Edit").allow).toBe(false);
    expect(check("reviewer", "src/a.ts", "MultiEdit").allow).toBe(false);
    expect(
      checkChannelWrite({
        cwd: root,
        agentType: "reviewer",
        toolName: "NotebookEdit",
        toolInput: { notebook_path: "n.ipynb" },
      }).allow
    ).toBe(false);
    expect(check("reviewer", "src/a.ts", "Read").allow).toBe(true);
  });

  it("refuses a write with no resolvable path", () => {
    expect(checkChannelWrite({ cwd: root, agentType: "reviewer", toolName: "Write", toolInput: {} }).allow).toBe(false);
  });

  it("leaves every other agent alone", () => {
    for (const a of ["backend", "test", "scribe", "frontend", "", "main"]) {
      expect(check(a, "src/app.ts").allow).toBe(true);
    }
  });
});

describe("maestro-channel-write-guard.js (real script)", () => {
  const script = path.resolve(__dirname, "../../../../plugins/maestro/scripts/maestro-channel-write-guard.js");
  const run = (payload: object) =>
    spawnSync("node", [script], {
      input: JSON.stringify({ cwd: root, hook_event_name: "PreToolUse", ...payload }),
      encoding: "utf8",
      env: pinnedEnv(root),
    });

  it("denies an out-of-lane write with a PreToolUse deny decision", () => {
    const r = run({
      agent_type: "reviewer",
      tool_name: "Edit",
      tool_input: { file_path: path.join(root, "src/a.ts") },
    });
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.hookSpecificOutput.permissionDecision).toBe("deny");
    expect(out.hookSpecificOutput.permissionDecisionReason).toMatch(/\.claude\/channels/);
  });

  /** A session whose session.json claims `task` (`144`: its channel scope is `task-<NNN>`). */
  function claim(sessionId: string, task: string | null): void {
    const dir = path.join(root, ".claude", "maestro_sessions", sessionId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "session.json"),
      JSON.stringify({ workflow: "build", generated_instances: [], run_id: `run-${sessionId}`, active_task: task })
    );
  }
  const writeAs = (sessionId: string | null, file: string, agent = "reviewer") =>
    run({
      ...(sessionId ? { session_id: sessionId } : {}),
      agent_type: agent,
      tool_name: "Write",
      tool_input: { file_path: file },
    });
  const decision = (r: ReturnType<typeof run>) =>
    r.stdout === "" ? "allow" : JSON.parse(r.stdout).hookSpecificOutput.permissionDecision;

  it("is silent for a channel write in the session's own scope and for another agent", () => {
    claim("sess-045", "045-a.md");
    expect(writeAs("sess-045", ".claude/channels/task-045/scribe/reviewer.1.md").stdout).toBe("");
    expect(
      run({ agent_type: "backend", tool_name: "Write", tool_input: { file_path: path.join(root, "src/a.ts") } }).stdout
    ).toBe("");
  });

  it("two concurrent sessions: each reviewer may write only its own task scope (144)", () => {
    claim("sess-045", "045-a.md");
    claim("sess-048", "048-b.md");
    expect(decision(writeAs("sess-045", ".claude/channels/task-045/scribe/reviewer.1.md"))).toBe("allow");
    expect(decision(writeAs("sess-048", ".claude/channels/task-048/scribe/reviewer.1.md"))).toBe("allow");
    expect(decision(writeAs("sess-045", ".claude/channels/task-048/scribe/reviewer.1.md"))).toBe("deny");
    expect(decision(writeAs("sess-048", path.join(root, ".claude/channels/task-045/scribe/reviewer.1.md")))).toBe(
      "deny"
    );
    // The legacy unscoped root and anything outside the lanes stay denied.
    expect(decision(writeAs("sess-045", ".claude/channels/scribe/reviewer.1.md"))).toBe("deny");
    expect(decision(writeAs("sess-045", path.join(root, "src/a.ts")))).toBe("deny");
    expect(decision(writeAs("sess-045", path.join(outside, "x.md")))).toBe("deny");
    const reason = JSON.parse(writeAs("sess-045", ".claude/channels/task-048/scribe/reviewer.1.md").stdout)
      .hookSpecificOutput.permissionDecisionReason;
    expect(reason).toContain(".claude/channels/task-045/");
  });

  it("a session with no claimed task is confined to session-<id8>; the scope follows the env id too", () => {
    claim("abcdefgh-1234", null);
    expect(decision(writeAs("abcdefgh-1234", ".claude/channels/session-abcdefgh/scribe/reviewer.1.md"))).toBe("allow");
    expect(decision(writeAs("abcdefgh-1234", ".claude/channels/task-045/scribe/reviewer.1.md"))).toBe("deny");
    // No payload id: the pinned env id resolves the same scope.
    const viaEnv = spawnSync("node", [script], {
      input: JSON.stringify({
        cwd: root,
        hook_event_name: "PreToolUse",
        agent_type: "refactor",
        tool_name: "Write",
        tool_input: { file_path: ".claude/channels/session-abcdefgh/backend/refactor.1.md" },
      }),
      encoding: "utf8",
      env: pinnedEnv(root, { CLAUDE_CODE_SESSION_ID: "abcdefgh-1234" }),
    });
    expect(viaEnv.stdout).toBe("");
  });

  it("with no resolvable session id the scope is session-none: only that scope is writable", () => {
    expect(decision(writeAs(null, ".claude/channels/session-none/scribe/reviewer.1.md"))).toBe("allow");
    expect(decision(writeAs(null, ".claude/channels/task-045/scribe/reviewer.1.md"))).toBe("deny");
    expect(decision(writeAs(null, ".claude/channels/scribe/reviewer.1.md"))).toBe("deny");
  });
});

describe("SendMessage hand-back recovery", () => {
  const line = (name: string, input: object) =>
    JSON.stringify({ type: "assistant", message: { content: [{ type: "tool_use", name, input }] } });

  it("finds the last SendMessage carrying a HANDOFF line", () => {
    const t = [
      line("SendMessage", { message: "early\nHANDOFF: failure" }),
      "not json SendMessage",
      line("Read", {}),
      line("SendMessage", { message: "done\n`HANDOFF: success`" }),
    ].join("\n");
    expect(lastHandoffLabel(sendMessageHandoff(t))).toBe("success");
  });

  it("returns null when no SendMessage carries one", () => {
    expect(sendMessageHandoff(line("SendMessage", { message: "hi" }))).toBeNull();
  });

  it("the real SubagentStop hook logs it as a handoff, not unknown", () => {
    fs.writeFileSync(path.join(root, ".claude", "maestro.json"), "{}");
    const tp = path.join(root, "agent.jsonl");
    fs.writeFileSync(tp, line("SendMessage", { message: "ok\nHANDOFF: success" }));
    const hook = path.resolve(__dirname, "../../../../plugins/maestro/scripts/maestro-subagent-log.js");
    const childEnv: NodeJS.ProcessEnv = pinnedEnv(root);
    delete childEnv.CLAUDE_CODE_SESSION_ID;
    const r = spawnSync("node", [hook], {
      env: childEnv,
      encoding: "utf8",
      input: JSON.stringify({
        cwd: root,
        session_id: "s1",
        hook_event_name: "SubagentStop",
        agent_type: "backend",
        agent_id: "a1",
        last_assistant_message: "Sent it.",
        agent_transcript_path: tp,
      }),
    });
    expect(r.status).toBe(0);
    const log = fs
      .readFileSync(path.join(root, ".claude/maestro_sessions/s1/log.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(log.find((e) => e.kind === "handoff")).toMatchObject({ status: "success", label: "success" });
  });
});
