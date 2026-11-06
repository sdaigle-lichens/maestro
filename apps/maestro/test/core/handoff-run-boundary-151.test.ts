// 151/153: adversarial cases for the current-run hand-back read in handoff-label.ts (scanHandbacks).
// 153 closed probes A and B: the boundary is a promptId change (the coordinator's resume prompt), a
// string isMeta reminder is no boundary, and a hand-back older than the run's dispatch is rejected.
// Pure, fs-free: the transcript is built as JSONL text, the way Claude Code writes a subagent log.
import { describe, it, expect } from "vitest";
import { handbackHandoff, hasHandbackCall, awaitHandback, runProfile } from "../../src/core/handoff-label.js";

const line = (o: unknown) => JSON.stringify(o) + "\n";
// Real shapes (153): the resume prompt is isMeta + origin.kind "coordinator" + string content + a new promptId.
const promptUser = (promptId: string, text: string) =>
  line({ type: "user", promptId, message: { role: "user", content: text } });
const metaUser = (promptId: string, text: string) =>
  line({ type: "user", promptId, isMeta: true, message: { role: "user", content: text } });
const coordinatorUser = (promptId: string, text: string) =>
  line({
    type: "user",
    promptId,
    isMeta: true,
    origin: { kind: "coordinator" },
    message: { role: "user", content: text },
  });
const toolResult2 = (promptId: string) =>
  line({
    type: "user",
    promptId,
    message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] },
  });
const stamped = (timestamp: string, input: unknown) =>
  line({
    type: "assistant",
    timestamp,
    message: { content: [{ type: "tool_use", id: "t", name: "SubagentHandback", input }] },
  });
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
  it("probe A (153): resume prompt NOT yet flushed: the earlier FAIL is older than this run's dispatch, so it is rejected and the read keeps waiting", async () => {
    const dispatch = Date.parse("2026-11-06T10:00:00.000Z");
    const run1 =
      userText("first prompt") +
      assistantText("working") +
      stamped("2026-11-06T09:00:00.000Z", { message: FAIL }) +
      toolResult;
    expect(handbackHandoff(run1, dispatch)).toBeNull();
    expect(hasHandbackCall(run1, dispatch)).toBe(false);
    let reads = 0;
    const got = await awaitHandback(() => (reads++, run1), noSleep, 300, 100, dispatch);
    expect(reads).toBe(4);
    expect(got).toBeNull();
    // Without a known start the old read is unchanged (first-run behaviour).
    expect(handbackHandoff(run1)).toContain("tests failed");
  });

  it("probe B (153): a string isMeta user entry AFTER the current run's hand-back is not a boundary", () => {
    const transcript =
      promptUser("P1", "prompt") +
      handback({ message: PASS }) +
      toolResult +
      metaUser("P1", "[handback-send-enforce] Your report has not been delivered.") +
      handback({ message: PASS });
    expect(handbackHandoff(transcript)).toContain("HANDOFF: success");
    // even when the reminder is the last entry the earlier hand-back survives
    const trailing = promptUser("P1", "prompt") + handback({ message: PASS }) + toolResult + metaUser("P1", "late");
    expect(handbackHandoff(trailing)).toContain("HANDOFF: success");
    // and a harness reminder carrying its own promptId is no boundary either
    const own = promptUser("P1", "prompt") + handback({ message: PASS }) + metaUser("P9", "late");
    expect(handbackHandoff(own)).toContain("HANDOFF: success");
  });

  it("promptId boundary (153): the coordinator's resume prompt with a new promptId opens the run", async () => {
    const resume = (extra: string) =>
      promptUser("P1", "first") +
      handback({ message: FAIL }) +
      toolResult +
      coordinatorUser("P2", "The coordinator sent a message while you were working: fix it") +
      extra;
    // prompt written, nothing after it yet: the old FAIL is not this run's
    expect(handbackHandoff(resume(""))).toBeNull();
    expect(hasHandbackCall(resume(""))).toBe(false);
    // later tool_results repeat P2 and are not boundaries
    const done = resume(assistantText("working") + toolResult2("P2") + handback({ message: PASS }));
    expect(handbackHandoff(done)).toContain("HANDOFF: success");
    expect(handbackHandoff(done)).not.toContain("tests failed");
    expect(await awaitHandback(() => done, noSleep)).toContain("HANDOFF: success");
  });

  it("a stale hand-back older than the dispatch is rejected, a current one kept (153)", () => {
    const dispatch = Date.parse("2026-11-06T10:00:00.000Z");
    const t = (iso: string, msg: string) => stamped(iso, { message: msg });
    const run = userText("p") + t("2026-11-06T09:00:00.000Z", FAIL);
    expect(handbackHandoff(run, dispatch)).toBeNull();
    // slack: within 1 s before the dispatch still counts
    expect(handbackHandoff(userText("p") + t("2026-11-06T09:59:59.500Z", PASS), dispatch)).toContain("success");
    // at or after the dispatch is kept
    expect(handbackHandoff(userText("p") + t("2026-11-06T10:00:05.000Z", PASS), dispatch)).toContain("success");
    // an entry with no timestamp is kept
    expect(handbackHandoff(userText("p") + handback({ message: PASS }), dispatch)).toContain("success");
    // old FAIL then new PASS, resume prompt not even needed
    const both = userText("p") + t("2026-11-06T09:00:00.000Z", FAIL) + t("2026-11-06T10:00:02.000Z", PASS);
    expect(handbackHandoff(both, dispatch)).toContain("success");
  });

  it("first run unchanged (153): no promptId, no timestamp, no start", () => {
    const first = userText("first") + assistantText("hi") + handback({ message: PASS }) + toolResult;
    expect(handbackHandoff(first)).toContain("HANDOFF: success");
    expect(handbackHandoff(first, Date.now())).toContain("HANDOFF: success");
    expect(runProfile(first)).toEqual({ resumed: false, wroteFiles: false });
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

// ── 153 gap cases: real resumed-run shape, the 1 s slack edges, and writes from an earlier run ──────
describe("153 gaps: resumed-run shape and the dispatch slack", () => {
  const DISPATCH = Date.parse("2026-11-06T15:15:20.000Z");
  const writeAt = (timestamp: string) =>
    line({
      type: "assistant",
      timestamp,
      message: { content: [{ type: "tool_use", id: "w", name: "Edit", input: { file_path: "a.ts" } }] },
    });
  const toolResultOf = (promptId: string) =>
    line({
      type: "user",
      promptId,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "t", content: "ok" }] },
    });
  // The first run, shaped like the real log: a user prompt with its own promptId, then the hand-back.
  const firstRun = (writes: boolean) =>
    promptUser("p-first", "first prompt") +
    assistantText("working") +
    (writes ? writeAt("2026-11-06T14:40:00.000Z") + toolResultOf("p-first") : "") +
    stamped("2026-11-06T14:48:00.000Z", { message: FAIL }) +
    toolResultOf("p-first");

  it("slack edge: a hand-back exactly 1 s before the dispatch is kept, 1 ms earlier is rejected", () => {
    const at = (ms: number) => new Date(DISPATCH + ms).toISOString();
    expect(handbackHandoff(userText("p") + stamped(at(-1000), { message: PASS }), DISPATCH)).toContain("success");
    expect(handbackHandoff(userText("p") + stamped(at(-1001), { message: PASS }), DISPATCH)).toBeNull();
  });

  it("no dispatch time: an old-dated hand-back is kept, as a first run always did", () => {
    const old = userText("p") + stamped("2001-01-01T00:00:00.000Z", { message: FAIL });
    expect(handbackHandoff(old, null)).toContain("tests failed");
    expect(handbackHandoff(old)).toContain("tests failed");
    expect(runProfile(old, null)).toEqual({ resumed: false, wroteFiles: false });
  });

  it("a user message typed after the hand-back (own promptId, not meta) opens a run", () => {
    const transcript = promptUser("P1", "first") + handback({ message: FAIL }) + toolResult + promptUser("P2", "typed");
    expect(handbackHandoff(transcript)).toBeNull();
  });

  it("real shape: the resume prompt not yet flushed, the earlier run's hand-back is rejected by its timestamp", () => {
    const transcript = firstRun(false) + assistantText("re-running") + toolResultOf("p-first");
    expect(handbackHandoff(transcript, DISPATCH)).toBeNull();
    expect(hasHandbackCall(transcript, DISPATCH)).toBe(false);
    expect(runProfile(transcript, DISPATCH)).toEqual({ resumed: true, wroteFiles: false });
  });

  it("real shape: a re-verify with no resume prompt must not count an EARLIER run's writes as its own", () => {
    const transcript = firstRun(true) + assistantText("re-verifying") + toolResultOf("p-first");
    expect(runProfile(transcript, DISPATCH)).toEqual({ resumed: true, wroteFiles: false });
  });

  it("real shape: a resumed run whose resume prompt has flushed, with the real text and hand-backs, reads its own result", () => {
    // The lines of the real resumed transcript (agent ae484f28…), trimmed to the fields the hook reads.
    const resumePrompt = line({
      type: "user",
      promptId: "c4e296b9-3189-477b-9139-f806478743ab",
      isMeta: true,
      origin: { kind: "coordinator" },
      message: {
        role: "user",
        content:
          "The coordinator sent a message while you were working:\nThis is a dummy resume to generate a resumed-run transcript for task 153's Gap 1 check. Reply with the single word OK. Do not write or edit any files, run no commands, and end with `HANDOFF: success`.\n\nAddress this before completing your current task.",
      },
      timestamp: "2026-11-06T15:15:38.425Z",
    });
    const textTurn = line({
      type: "assistant",
      timestamp: "2026-11-06T15:15:42.378Z",
      message: {
        model: "claude-sonnet-5-5",
        role: "assistant",
        content: [{ type: "text", text: "OK\n\nHANDOFF: success" }],
      },
    });
    const handbackCall = line({
      type: "assistant",
      timestamp: "2026-11-06T15:15:44.261Z",
      message: {
        model: "claude-sonnet-5-5",
        role: "assistant",
        stop_reason: "tool_use",
        content: [
          {
            type: "tool_use",
            id: "toolu_01RrMafUEpvbVxPSrAUhWPKV",
            name: "SubagentHandback",
            input: { message: "OK\n\nHANDOFF: success" },
          },
        ],
      },
    });
    const transcript =
      firstRun(false) + resumePrompt + textTurn + toolResultOf("c4e296b9-3189-477b-9139-f806478743ab") + handbackCall;
    expect(handbackHandoff(transcript, DISPATCH)).toBe("OK\n\nHANDOFF: success");
    expect(handbackHandoff(transcript)).toBe("OK\n\nHANDOFF: success");
    expect(runProfile(transcript, DISPATCH)).toEqual({ resumed: true, wroteFiles: false });
  });

  it("resume prompt not flushed, the current run writes AFTER its dispatch: wroteFiles is set, the earlier run's write is not", () => {
    const transcript = firstRun(true) + writeAt("2026-11-06T15:16:00.000Z") + toolResultOf("p-first");
    expect(runProfile(transcript, DISPATCH)).toEqual({ resumed: true, wroteFiles: true });
  });

  it("write slack edge (153): an edit exactly 1 s before the dispatch counts, 1 ms earlier does not", () => {
    const at = (ms: number) => new Date(DISPATCH + ms).toISOString();
    const editOnly = (iso: string) => promptUser("p-first", "first") + writeAt(iso) + toolResultOf("p-first");
    expect(runProfile(editOnly(at(-1000)), DISPATCH).wroteFiles).toBe(true);
    expect(runProfile(editOnly(at(-1001)), DISPATCH).wroteFiles).toBe(false);
  });

  it("an isMeta string reminder with NO promptId after a hand-back is not a boundary (old-fixture path, 153)", () => {
    const reminder = line({
      type: "user",
      isMeta: true,
      message: { role: "user", content: "[handback-send-enforce] Your report has not been delivered." },
    });
    const transcript = userText("first") + handback({ message: PASS }) + toolResult + reminder;
    expect(handbackHandoff(transcript)).toContain("HANDOFF: success");
  });
});
