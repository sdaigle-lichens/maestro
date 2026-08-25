// Picking up a conversation this app did not start (`025`).
//
// What is testable here is the filtering and the wording; what is NOT — that a resume honours the
// resuming query's cwd and `settingSources: []` rather than the recorded session's, and that
// `forkSession: true` leaves the source transcript byte-identical — was measured against a running
// CLI (probe A and B, recorded in `session-resume.ts`'s header and in CLAUDE.md) and pinned by
// `test/isolation.test.ts`. That split is the same one `024` drew and for the same reason: neither
// question has an answer a unit test can reach.

import { describe, it, expect } from "vitest";
import {
  readNote,
  replayNote,
  resumableFrom,
  resumeDisclosure,
  resumedNotice,
  CHARS_PER_TOKEN,
  RESUME_LIST_LIMIT,
  RESUME_READ_CAP,
  RESUME_SCOPE_NOTE,
  type StoredMessage,
  type StoredSession,
} from "../../src/core/session-resume.js";

const PROJECT = "/home/dev/project";

function row(over: Partial<StoredSession> = {}): StoredSession {
  return {
    sessionId: "s-1",
    summary: "Writing a skill",
    firstPrompt: "I want a skill that lints our migrations",
    gitBranch: "feature/skills",
    cwd: PROJECT,
    lastModified: 1_000,
    createdAt: 900,
    fileSize: 4_096,
    ...over,
  };
}

describe("which conversations may be offered", () => {
  it("keeps the ones recorded in the open project and drops everything else", () => {
    const rows = resumableFrom(
      [
        row({ sessionId: "mine" }),
        row({ sessionId: "elsewhere", cwd: "/home/dev/other" }),
        // A SUBDIRECTORY IS NOT THE PROJECT. Its transcript's relative paths meant something else
        // there, so every unqualified filename in it resolves somewhere the pane would not look.
        row({ sessionId: "below", cwd: `${PROJECT}/apps/web` }),
        row({ sessionId: "nowhere", cwd: null }),
      ],
      { projectRoot: PROJECT }
    );
    expect(rows.map((r) => r.id)).toEqual(["mine"]);
  });

  it("drops the ids the caller is already holding, because Continue is that door", () => {
    const rows = resumableFrom([row({ sessionId: "live" }), row({ sessionId: "other" })], {
      projectRoot: PROJECT,
      exclude: ["live"],
    });
    expect(rows.map((r) => r.id)).toEqual(["other"]);
  });

  it("offers nothing at all when no project is open", () => {
    expect(resumableFrom([row()], { projectRoot: "" })).toEqual([]);
  });

  it("sorts newest first and caps the list at something a person can read", () => {
    const many = Array.from({ length: RESUME_LIST_LIMIT + 8 }, (_, i) => row({ sessionId: `s${i}`, lastModified: i }));
    const rows = resumableFrom(many, { projectRoot: PROJECT });
    expect(rows).toHaveLength(RESUME_LIST_LIMIT);
    expect(rows[0].id).toBe(`s${many.length - 1}`);
    expect(rows[0].lastModified).toBeGreaterThan(rows[1].lastModified);
  });

  it("never shows the same sentence twice as both the title and the prompt", () => {
    // The store falls back to the first prompt when a conversation has no title of its own. Showing
    // it in both places reads as two facts about the conversation when it is one.
    const [same] = resumableFrom([row({ summary: null, customTitle: null, firstPrompt: "do a thing" })], {
      projectRoot: PROJECT,
    });
    expect(same.summary).toBe("do a thing");
    expect(same.firstPrompt).toBeNull();

    const [both] = resumableFrom([row({ customTitle: "Migration linter", firstPrompt: "do a thing" })], {
      projectRoot: PROJECT,
    });
    expect(both.summary).toBe("Migration linter");
    expect(both.firstPrompt).toBe("do a thing");
  });

  it("survives a store row with nothing on it but a path", () => {
    const [only] = resumableFrom([{ sessionId: "bare", cwd: PROJECT }], { projectRoot: PROJECT });
    expect(only.summary).toBe("Untitled conversation");
    expect(only.branch).toBeNull();
    expect(only.sizeBytes).toBe(0);
    expect(only.createdAt).toBeNull();
  });
});

describe("what the transcript already read", () => {
  const session = resumableFrom([row()], { projectRoot: PROJECT })[0];

  function assistant(...blocks: unknown[]): StoredMessage {
    return { type: "assistant", message: { role: "assistant", content: blocks } };
  }
  const toolUse = (name: string, input: Record<string, unknown>) => ({ type: "tool_use", name, input });

  it("lists the paths, marks the ones outside this session's reach, and puts those first", () => {
    const disclosure = resumeDisclosure({
      session,
      messages: [
        assistant(toolUse("Read", { file_path: `${PROJECT}/src/index.ts` })),
        assistant(toolUse("Read", { file_path: "/home/dev/secrets/.env" })),
        assistant(toolUse("Grep", { path: `${PROJECT}/src`, pattern: "token" })),
      ],
      directories: [PROJECT],
    });

    expect(disclosure.reads.map((r) => r.path)).toEqual([
      "/home/dev/secrets/.env",
      `${PROJECT}/src/index.ts`,
      `${PROJECT}/src`,
    ]);
    expect(disclosure.reads[0].inScope).toBe(false);
    expect(disclosure.reads[0].tool).toBe("Read");
    expect(disclosure.outside).toBe(1);
  });

  it("resolves a relative path against the RECORDED session's own directory", () => {
    // The transcript's paths meant something relative to where that session ran, not to where this
    // one will. Resolving against the pane's cwd would name files that were never read.
    const disclosure = resumeDisclosure({
      session,
      messages: [assistant(toolUse("Read", { file_path: "notes.md" }))],
      directories: [PROJECT],
    });
    expect(disclosure.reads[0].path).toBe(`${PROJECT}/notes.md`);
  });

  it("discloses an escaping search pattern as its own line", () => {
    // A search rooted inside the project can still be told to match `../../**`, and a list that only
    // showed the base would say the conversation stayed inside it.
    const disclosure = resumeDisclosure({
      session,
      messages: [assistant(toolUse("Grep", { path: PROJECT, pattern: "../../etc/**" }))],
      directories: [PROJECT],
    });
    expect(disclosure.reads.some((r) => r.path.endsWith("/etc/**"))).toBe(true);
    expect(disclosure.outside).toBe(1);
  });

  it("counts the reads it did not list rather than truncating in silence", () => {
    const messages = Array.from({ length: RESUME_READ_CAP + 5 }, (_, i) =>
      assistant(toolUse("Read", { file_path: `${PROJECT}/f${i}.ts` }))
    );
    const disclosure = resumeDisclosure({ session, messages, directories: [PROJECT] });
    expect(disclosure.reads).toHaveLength(RESUME_READ_CAP);
    expect(disclosure.more).toBe(5);
    expect(disclosure.readNote).toMatch(/5 more, not listed/);
  });

  it("estimates the replay from everything that goes back in front of the model", () => {
    // Tool RESULTS are most of a transcript, and they are replayed too — an estimate built from the
    // prose alone would understate a file-reading conversation by an order of magnitude.
    const body = "x".repeat(4_000);
    const disclosure = resumeDisclosure({
      session,
      messages: [
        { type: "user", message: { role: "user", content: "hello" } },
        { type: "user", message: { role: "user", content: [{ type: "tool_result", content: body }] } },
      ],
      directories: [PROJECT],
    });
    expect(disclosure.replayTokens).toBeGreaterThanOrEqual(4_005 / CHARS_PER_TOKEN - 1);
    expect(disclosure.replayUsd).toBeGreaterThan(0);
    expect(disclosure.messages).toBe(2);
  });

  it("says nothing at all rather than guessing when the records are unreadable", () => {
    const disclosure = resumeDisclosure({
      session,
      messages: [
        { type: "assistant", message: null },
        { type: "user", message: { role: "user" } },
      ],
      directories: [PROJECT],
    });
    expect(disclosure.reads).toEqual([]);
    expect(disclosure.replayTokens).toBe(0);
  });
});

describe("the sentences", () => {
  it("names the rate the dollar estimate rests on, and calls it an estimate", () => {
    const note = replayNote(120, 250_000, 0.75);
    expect(note).toMatch(/120 messages/);
    expect(note).toMatch(/250k tokens/);
    expect(note).toMatch(/estimate, not a bill/);
    expect(note).toMatch(/input tokens/);
  });

  it("admits what the read list cannot see", () => {
    // A disclosure built from recorded tool calls cannot see attached, pasted or auto-loaded text.
    // Implying completeness would be worse than admitting the edge.
    expect(readNote(3, 1, 0)).toMatch(/attached/);
    expect(readNote(3, 1, 0)).toMatch(/already in the transcript/);
    expect(readNote(0, 0, 0)).toMatch(/read no files/);
  });

  it("says what does not come across, because that is what the user will meet on the first turn", () => {
    expect(RESUME_SCOPE_NOTE).toMatch(/no grants/);
    expect(RESUME_SCOPE_NOTE).toMatch(/loads no settings files/);
    expect(RESUME_SCOPE_NOTE).toMatch(/raise a prompt/);
  });

  it("tells the transcript it forked, since that is the promise being kept", () => {
    const session = resumableFrom([row()], { projectRoot: PROJECT })[0];
    const notice = resumedNotice(session, null);
    expect(notice).toMatch(/FORKED/);
    expect(notice).toMatch(/original transcript is untouched/);
    expect(notice).toMatch(/Writing a skill/);
    expect(notice).toMatch(/feature\/skills/);
  });
});
