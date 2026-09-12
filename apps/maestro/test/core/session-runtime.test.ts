// appendSessionLog's optional third argument: the hook's own raw payload, from which it derives
// ctx_pct/ctx_model (via session-usage.ts's deriveUsage) AND — since `064` — which session's
// directory the line is written into. Covers the seam every hook script now calls through; not
// deriveUsage's own edge cases (session-usage.test.ts owns those) nor session-paths.ts's
// resolution rules (session-paths.test.ts owns those).
//
// `CLAUDE_CODE_SESSION_ID` is pinned in beforeEach and restored in afterEach. It is set in the
// environment of a real Claude Code session, so a test that merely inherited it would write into
// the DEVELOPER'S own session directory and behave differently inside a session than outside one.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendSessionLog, sessionLogPath } from "../../src/core/session-runtime.js";
import { SESSION_ID_ENV } from "../../src/core/session-paths.js";

/** The id the environment fallback resolves to for every test in this file. */
const ENV_SESSION = "env-session-id";

let tmp: string;
let savedEnvId: string | undefined;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-runtime-"));
  savedEnvId = process.env[SESSION_ID_ENV];
  process.env[SESSION_ID_ENV] = ENV_SESSION;
});

afterEach(() => {
  if (savedEnvId === undefined) delete process.env[SESSION_ID_ENV];
  else process.env[SESSION_ID_ENV] = savedEnvId;
  fs.rmSync(tmp, { recursive: true, force: true });
});

function readEntries(claudeDir: string, sessionId: string = ENV_SESSION): unknown[] {
  const p = sessionLogPath(claudeDir, sessionId);
  expect(p, `no log path for session ${sessionId}`).not.toBeNull();
  const raw = fs.readFileSync(p!, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l));
}

const assistantLine = (model: string, usage: Record<string, number>) =>
  JSON.stringify({ type: "assistant", message: { model, usage } });

describe("appendSessionLog", () => {
  it("writes the entry unchanged when no payload is given", () => {
    appendSessionLog(tmp, { ts: "t", origin: "main_session", log: "x" });
    expect(readEntries(tmp)).toEqual([{ ts: "t", origin: "main_session", log: "x" }]);
  });

  it("writes the entry unchanged when the payload's transcript_path can't be read", () => {
    appendSessionLog(
      tmp,
      { ts: "t", origin: "main_session", log: "x" },
      { transcript_path: path.join(tmp, "missing.jsonl") }
    );
    expect(readEntries(tmp)).toEqual([{ ts: "t", origin: "main_session", log: "x" }]);
  });

  it("stamps ctx_pct/ctx_model when the payload's transcript_path resolves a usage line", () => {
    const transcript = path.join(tmp, "transcript.jsonl");
    fs.writeFileSync(
      transcript,
      assistantLine("claude-sonnet-5", {
        input_tokens: 100,
        cache_read_input_tokens: 19900,
        cache_creation_input_tokens: 0,
      }) + "\n"
    );
    appendSessionLog(tmp, { ts: "t", origin: "main_session", log: "x" }, { transcript_path: transcript });
    expect(readEntries(tmp)).toEqual([
      { ts: "t", origin: "main_session", log: "x", ctx_pct: 10, ctx_model: "claude-sonnet-5" },
    ]);
  });

  // `064`. The routing rules at the seam every writer goes through — so a caller that never
  // changed its call site still lands in the right directory.
  describe("session routing (064)", () => {
    it("routes by the payload's session_id in preference to the environment's", () => {
      appendSessionLog(tmp, { ts: "t", origin: "main_session", log: "payload" }, { session_id: "payload-session" });

      expect(readEntries(tmp, "payload-session")).toEqual([{ ts: "t", origin: "main_session", log: "payload" }]);
      // The environment's own directory was never even created.
      expect(fs.existsSync(path.join(tmp, "maestro_sessions", ENV_SESSION))).toBe(false);
    });

    it("routes by the environment's id when the payload carries none", () => {
      appendSessionLog(tmp, { ts: "t", origin: "main_session", log: "env" }, { transcript_path: "nope" });
      expect(readEntries(tmp)).toEqual([{ ts: "t", origin: "main_session", log: "env" }]);
    });

    it("is a silent no-op — no write, no throw — when neither source resolves an id", () => {
      delete process.env[SESSION_ID_ENV];
      expect(() => appendSessionLog(tmp, { ts: "t", origin: "main_session", log: "x" })).not.toThrow();
      expect(fs.existsSync(path.join(tmp, "maestro_sessions"))).toBe(false);
    });

    it("is a silent no-op for a payload id that fails validation, without falling back to the environment", () => {
      // A malformed payload id must not silently write into whatever the environment happens to
      // say — that would attribute one session's line to another.
      expect(() =>
        appendSessionLog(tmp, { ts: "t", origin: "main_session", log: "x" }, { session_id: "../escape" })
      ).not.toThrow();
      expect(fs.existsSync(path.join(tmp, "maestro_sessions"))).toBe(false);
    });

    it("keeps two sessions' logs wholly independent", () => {
      appendSessionLog(tmp, { ts: "1", origin: "main_session", log: "A1" }, { session_id: "sess-a" });
      appendSessionLog(tmp, { ts: "2", origin: "main_session", log: "B1" }, { session_id: "sess-b" });
      appendSessionLog(tmp, { ts: "3", origin: "main_session", log: "A2" }, { session_id: "sess-a" });

      expect(readEntries(tmp, "sess-a").map((e) => (e as { log: string }).log)).toEqual(["A1", "A2"]);
      expect(readEntries(tmp, "sess-b").map((e) => (e as { log: string }).log)).toEqual(["B1"]);
    });
  });
});
