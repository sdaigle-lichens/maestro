// appendSessionLog's optional third argument: the hook's own raw payload, from which it derives
// ctx_pct/ctx_model (via session-usage.ts's deriveUsage) before writing. Covers the seam every
// hook script now calls through — not deriveUsage's own edge cases, which session-usage.test.ts
// already owns.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { appendSessionLog, sessionLogPath } from "../../src/core/session-runtime.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-runtime-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function readEntries(claudeDir: string): unknown[] {
  const raw = fs.readFileSync(sessionLogPath(claudeDir), "utf8");
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
    appendSessionLog(tmp, { ts: "t", origin: "main_session", log: "x" }, { transcript_path: path.join(tmp, "missing.jsonl") });
    expect(readEntries(tmp)).toEqual([{ ts: "t", origin: "main_session", log: "x" }]);
  });

  it("stamps ctx_pct/ctx_model when the payload's transcript_path resolves a usage line", () => {
    const transcript = path.join(tmp, "transcript.jsonl");
    fs.writeFileSync(
      transcript,
      assistantLine("claude-sonnet-5", { input_tokens: 100, cache_read_input_tokens: 19900, cache_creation_input_tokens: 0 }) + "\n"
    );
    appendSessionLog(tmp, { ts: "t", origin: "main_session", log: "x" }, { transcript_path: transcript });
    expect(readEntries(tmp)).toEqual([{ ts: "t", origin: "main_session", log: "x", ctx_pct: 10, ctx_model: "claude-sonnet-5" }]);
  });
});
