// 151: adversarial cases for the current-run hand-back read in handoff-label.ts (scanHandbacks).
// Probes A and B record documented limitations of the run-boundary rule, not guarantees: A returns an
// earlier FAIL when the resume prompt has not been flushed yet; B drops a hand-back followed by a
// string-content user entry in the same run.
// Pure, fs-free: the transcript is built as JSONL text, the way Claude Code writes a subagent log.
import { describe, it, expect } from "vitest";
import { handbackHandoff, hasHandbackCall, awaitHandback } from "../../src/core/handoff-label.js";

const line = (o: unknown) => JSON.stringify(o) + "\n";
const userText = (text: string) => line({ type: "user", message: { role: "user", content: text } });
const userBlocks = (content: unknown[]) => line({ type: "user", message: { role: "user", content } });
const assistantText = (text: string) => line({ type: "assistant", message: { content: [{ type: "text", text }] } });
const handback = (input: unknown) =>
  line({
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "t", name: "SubagentHandback", input }] },
  });
const toolResult = userBlocks([{ type: "tool_result", tool_use_id: "t", content: "Delivered." }]);
const noSleep = () => Promise.resolve();

const FAIL = "verdict FAIL\nHANDOFF: tests failed";
const PASS = "verdict PASS\nHANDOFF: success";

describe("151 probes: run boundary", () => {
  it("probe A: resume prompt NOT yet flushed, earlier FAIL is the only hand-back in the file", async () => {
    // A resumed agent whose transcript shows run 1 only (the resume prompt not flushed yet). Nothing
    // in the file marks a run boundary after the FAIL, so the read cannot tell this apart from a
    // first run that handed back FAIL. Recorded as a known gap, not a passing guarantee.
    const run1 = userText("first prompt") + assistantText("working") + handback({ message: FAIL }) + toolResult;
    let reads = 0;
    const got = await awaitHandback(() => (reads++, run1), noSleep, 300, 100);
    expect(reads).toBe(1);
    expect(got).toContain("tests failed");
  });

  it("probe B: a text-bearing user entry AFTER the current run's hand-back starts a new run (by design)", async () => {
    // By the run-boundary rule, any non-tool_result user entry opens a run, so a late harness
    // reminder after the hand-back discards it. Documents the rule; not a failure of the rule.
    const transcript =
      userText("prompt") +
      handback({ message: PASS }) +
      toolResult +
      userText("<system-reminder>late</system-reminder>");
    expect(handbackHandoff(transcript)).toBeNull();
    expect(hasHandbackCall(transcript)).toBe(false);
  });

  it("probe C: resumed run whose hand-back is labelless, after an earlier labelled FAIL", async () => {
    const transcript =
      userText("first") +
      handback({ message: FAIL }) +
      toolResult +
      userText("resume") +
      handback({ message: "Done, no label here." }) +
      toolResult;
    expect(hasHandbackCall(transcript)).toBe(true);
    expect(handbackHandoff(transcript)).toBeNull();
    let reads = 0;
    expect(await awaitHandback(() => (reads++, transcript), noSleep)).toBeNull();
    expect(reads).toBe(1);
  });

  it("probe D: user entry with an empty content array starts a run (current behaviour)", () => {
    const transcript = userText("first") + handback({ message: FAIL }) + userBlocks([]);
    expect(handbackHandoff(transcript)).toBeNull();
  });

  it("probe E: mixed user content (tool_result plus text) starts a run", () => {
    const transcript =
      userText("first") +
      handback({ message: FAIL }) +
      userBlocks([
        { type: "tool_result", tool_use_id: "t", content: "ok" },
        { type: "text", text: "also" },
      ]);
    expect(handbackHandoff(transcript)).toBeNull();
  });

  it("probe F: torn and non-object lines between runs do not break the boundary", () => {
    const transcript =
      userText("first") +
      handback({ message: FAIL }) +
      toolResult +
      "null\n" +
      '{"type":"user","message":{"content":"half\n' +
      "42\n" +
      userText("resume") +
      handback({ message: PASS }) +
      toolResult;
    expect(handbackHandoff(transcript)).toContain("HANDOFF: success");
  });

  it('probe G: the word "user" inside an assistant line does not start a run', () => {
    const transcript =
      userText("first") +
      line({ type: "assistant", message: { content: [{ type: "text", text: "the user said hi" }] } }) +
      handback({ message: FAIL });
    expect(handbackHandoff(transcript)).toContain("HANDOFF: tests failed");
  });

  it("probe H: a hand-back whose message is a plain string input", () => {
    const transcript = userText("first") + handback(FAIL) + toolResult;
    expect(handbackHandoff(transcript)).toContain("HANDOFF: tests failed");
  });

  it("probe I: top-level content shape (no message wrapper) still starts a run", () => {
    const transcript =
      line({ type: "user", content: "first" }) +
      handback({ message: FAIL }) +
      line({ type: "user", content: "resume" }) +
      handback({ message: PASS }) +
      toolResult;
    expect(handbackHandoff(transcript)).toContain("HANDOFF: success");
  });
});
