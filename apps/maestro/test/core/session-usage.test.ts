// Fixture transcripts for `deriveUsage`: normal usage, a missing/empty/unreadable file, a corrupt
// trailing line, a line with no `usage` field, an unrecognized model id, and a usage line that
// sits further back than the first tail chunk — proving the tail actually grows rather than just
// reading whatever the first window happens to contain.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { deriveUsage, DEFAULT_CONTEXT_WINDOW } from "../../src/core/session-usage.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-usage-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

const assistantLine = (model: string, usage: Record<string, number>) =>
  JSON.stringify({ type: "assistant", message: { model, usage } });

function writeTranscript(lines: string[]): string {
  const file = path.join(tmp, "transcript.jsonl");
  fs.writeFileSync(file, lines.join("\n") + "\n");
  return file;
}

describe("deriveUsage", () => {
  it("computes a percentage against the model's context window", () => {
    const file = writeTranscript([
      assistantLine("claude-sonnet-5", { input_tokens: 100, cache_read_input_tokens: 19900, cache_creation_input_tokens: 0 }),
    ]);
    expect(deriveUsage({ transcript_path: file })).toEqual({ ctx_pct: 10, ctx_model: "claude-sonnet-5" });
  });

  it("returns undefined when the payload has no transcript_path", () => {
    expect(deriveUsage({})).toBeUndefined();
  });

  it("returns undefined when the transcript file does not exist", () => {
    expect(deriveUsage({ transcript_path: path.join(tmp, "missing.jsonl") })).toBeUndefined();
  });

  it("returns undefined for an empty transcript file", () => {
    const file = path.join(tmp, "empty.jsonl");
    fs.writeFileSync(file, "");
    expect(deriveUsage({ transcript_path: file })).toBeUndefined();
  });

  it("skips a corrupt trailing line and uses the last valid one", () => {
    const file = writeTranscript([
      assistantLine("claude-sonnet-5", { input_tokens: 0, cache_read_input_tokens: 40000, cache_creation_input_tokens: 0 }),
      "{ this is not json",
    ]);
    expect(deriveUsage({ transcript_path: file })).toEqual({ ctx_pct: 20, ctx_model: "claude-sonnet-5" });
  });

  it("returns undefined when no assistant line carries a usage field", () => {
    const file = writeTranscript([JSON.stringify({ type: "assistant", message: { model: "claude-sonnet-5" } })]);
    expect(deriveUsage({ transcript_path: file })).toBeUndefined();
  });

  it("falls back to DEFAULT_CONTEXT_WINDOW for an unrecognized model id", () => {
    const file = writeTranscript([
      assistantLine("claude-future-model", { input_tokens: 0, cache_read_input_tokens: DEFAULT_CONTEXT_WINDOW / 2, cache_creation_input_tokens: 0 }),
    ]);
    expect(deriveUsage({ transcript_path: file })).toEqual({ ctx_pct: 50, ctx_model: "claude-future-model" });
  });

  it("grows the tail window to find a usage line further back than the first chunk", () => {
    const noise = JSON.stringify({ type: "user", message: { content: "x".repeat(2000) } });
    const padding = Array.from({ length: 60 }, () => noise); // ~120KB, past the 64KB first window
    const file = writeTranscript([
      assistantLine("claude-sonnet-5", { input_tokens: 0, cache_read_input_tokens: 60000, cache_creation_input_tokens: 0 }),
      ...padding,
    ]);
    expect(deriveUsage({ transcript_path: file })).toEqual({ ctx_pct: 30, ctx_model: "claude-sonnet-5" });
  });
});
