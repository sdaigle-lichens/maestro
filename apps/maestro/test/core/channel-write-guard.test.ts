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

const check = (agentType: string, file: string, tool = "Write") =>
  checkChannelWrite({ cwd: root, agentType, toolName: tool, toolInput: { file_path: file } });

describe("checkChannelWrite", () => {
  it("allows a channel file for reviewer and refactor, absolute or relative, existing dir or not", () => {
    expect(check("reviewer", path.join(root, ".claude/channels/scribe/reviewer.1.md")).allow).toBe(true);
    expect(check("maestro:refactor", ".claude/channels/backend/refactor.1.md").allow).toBe(true);
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
    expect(check("reviewer", ".claude/channels/scribe/../scribe/a.md").allow).toBe(false);
  });

  it("refuses a symlinked lane directory pointing out of the project", () => {
    fs.symlinkSync(outside, path.join(root, ".claude", "channels", "evil"));
    expect(check("reviewer", ".claude/channels/evil/x.md").allow).toBe(false);
  });

  it("refuses a symlink file, live or dangling, pointing out of the lanes", () => {
    const live = path.join(outside, "target.md");
    fs.writeFileSync(live, "x");
    fs.symlinkSync(live, path.join(root, ".claude/channels/scribe/live.md"));
    fs.symlinkSync(path.join(outside, "nope.md"), path.join(root, ".claude/channels/scribe/dangling.md"));
    expect(check("reviewer", ".claude/channels/scribe/live.md").allow).toBe(false);
    expect(check("reviewer", ".claude/channels/scribe/dangling.md").allow).toBe(false);
  });

  it("refuses when .claude/channels itself is a symlink out of the project", () => {
    fs.rmSync(path.join(root, ".claude", "channels"), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ".claude", "channels"));
    expect(check("reviewer", ".claude/channels/a.md").allow).toBe(false);
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

  it("is silent for a channel write and for another agent", () => {
    expect(
      run({
        agent_type: "reviewer",
        tool_name: "Write",
        tool_input: { file_path: ".claude/channels/scribe/reviewer.1.md" },
      }).stdout
    ).toBe("");
    expect(
      run({ agent_type: "backend", tool_name: "Write", tool_input: { file_path: path.join(root, "src/a.ts") } }).stdout
    ).toBe("");
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
