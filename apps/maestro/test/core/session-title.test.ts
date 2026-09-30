// session-title.ts (`068`): a Session Log tab's title = active task H1, else the `claude --resume`
// title from the transcript. Real fs against temp dirs; HOME and CLAUDE_CODE_SESSION_ID pinned.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  resolveSessionTitle,
  resolveSessionTitles,
  sessionTitleKey,
  projectSlug,
} from "../../src/core/session-title.js";

const ID = "11111111-aaaa-bbbb-cccc-222222222222";

let tmp: string;
let home: string;
let proj: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-title-"));
  home = path.join(tmp, "home");
  proj = path.join(tmp, "proj.with_odd chars");
  vi.stubEnv("HOME", home);
  vi.stubEnv("CLAUDE_CONFIG_DIR", "");
  vi.stubEnv("CLAUDE_CODE_SESSION_ID", "own-session-id");
  fs.mkdirSync(path.join(proj, ".claude", "maestro-tasks"), { recursive: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  fs.rmSync(tmp, { recursive: true, force: true });
});

function setActiveTask(task: unknown, id = ID): void {
  const dir = path.join(proj, ".claude", "maestro_sessions", id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "session.json"), JSON.stringify({ active_task: task }));
}

function writeTask(name: string, body: string): void {
  fs.writeFileSync(path.join(proj, ".claude", "maestro-tasks", name), body);
}

function writeTranscript(entries: unknown[], id = ID, raw = ""): string {
  const dir = path.join(home, ".claude", "projects", projectSlug(proj));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.jsonl`);
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n" + raw);
  return file;
}

describe("active task title", () => {
  it("uses the task file's H1", () => {
    setActiveTask("068-sweep.md");
    writeTask("068-sweep.md", "---\nx: 1\n---\n\n# Sweep stale session directories\n\nbody\n## not this\n");
    writeTranscript([{ type: "ai-title", aiTitle: "From transcript" }]);
    expect(resolveSessionTitle(proj, ID)).toBe("Sweep stale session directories");
  });

  it("falls back to the filename when the task has no H1 or is missing", () => {
    setActiveTask("069-no-heading.md");
    writeTask("069-no-heading.md", "just text\n");
    expect(resolveSessionTitle(proj, ID)).toBe("069-no-heading.md");
    setActiveTask("070-gone.md");
    expect(resolveSessionTitle(proj, ID)).toBe("070-gone.md");
  });

  it("only ever reads inside maestro-tasks (path traversal is reduced to a basename)", () => {
    fs.writeFileSync(path.join(proj, "secret.md"), "# Secret\n");
    setActiveTask("../../secret.md");
    expect(resolveSessionTitle(proj, ID)).toBe("secret.md");
  });

  it("ignores a null or non-string active_task and falls through to the transcript", () => {
    setActiveTask(null);
    writeTranscript([{ type: "ai-title", aiTitle: "AI one" }]);
    expect(resolveSessionTitle(proj, ID)).toBe("AI one");
  });
});

describe("transcript title", () => {
  it("returns the latest ai-title", () => {
    writeTranscript([
      { type: "ai-title", aiTitle: "First" },
      { type: "user", message: "x".repeat(100) },
      { type: "ai-title", aiTitle: "Latest" },
    ]);
    expect(resolveSessionTitle(proj, ID)).toBe("Latest");
  });

  it("a user rename (custom-title or agent-name) beats a later ai-title", () => {
    writeTranscript([
      { type: "custom-title", customTitle: "My rename" },
      { type: "ai-title", aiTitle: "AI later" },
    ]);
    expect(resolveSessionTitle(proj, ID)).toBe("My rename");
    writeTranscript([
      { type: "agent-name", agentName: "renamed-agent" },
      { type: "ai-title", aiTitle: "AI later" },
    ]);
    expect(resolveSessionTitle(proj, ID)).toBe("renamed-agent");
  });

  it("falls back to summary when there is no other title", () => {
    writeTranscript([{ type: "summary", summary: "Old summary" }]);
    expect(resolveSessionTitle(proj, ID)).toBe("Old summary");
  });

  it("skips garbage lines and a truncated tail", () => {
    writeTranscript([{ type: "ai-title", aiTitle: "Good" }], ID, '{"type":"ai-title","aiT');
    expect(resolveSessionTitle(proj, ID)).toBe("Good");
  });

  it("finds a title inside the tail of a transcript far larger than the read window", () => {
    const filler = { type: "user", message: "y".repeat(1000) };
    const entries: unknown[] = [{ type: "ai-title", aiTitle: "Ancient" }];
    for (let i = 0; i < 6000; i++) entries.push(filler);
    entries.push({ type: "ai-title", aiTitle: "Recent" });
    writeTranscript(entries);
    expect(resolveSessionTitle(proj, ID)).toBe("Recent");
  });

  it("re-reads when the transcript grows", () => {
    const f = writeTranscript([{ type: "ai-title", aiTitle: "One" }]);
    expect(resolveSessionTitle(proj, ID)).toBe("One");
    fs.appendFileSync(f, JSON.stringify({ type: "ai-title", aiTitle: "Two" }) + "\n");
    expect(resolveSessionTitle(proj, ID)).toBe("Two");
  });

  it("collapses whitespace and trims", () => {
    writeTranscript([{ type: "ai-title", aiTitle: "  a\n  b  " }]);
    expect(resolveSessionTitle(proj, ID)).toBe("a b");
  });
});

describe("null cases", () => {
  it("no task, no transcript", () => {
    expect(resolveSessionTitle(proj, ID)).toBeNull();
  });
  it("invalid session id", () => {
    writeTranscript([{ type: "ai-title", aiTitle: "x" }]);
    expect(resolveSessionTitle(proj, "../evil")).toBeNull();
  });
  it("unreadable transcript (a directory) and malformed session.json", () => {
    const dir = path.join(home, ".claude", "projects", projectSlug(proj), `${ID}.jsonl`);
    fs.mkdirSync(dir, { recursive: true });
    const sdir = path.join(proj, ".claude", "maestro_sessions", ID);
    fs.mkdirSync(sdir, { recursive: true });
    fs.writeFileSync(path.join(sdir, "session.json"), "{not json");
    expect(resolveSessionTitle(proj, ID)).toBeNull();
  });
});

describe("resolveSessionTitles", () => {
  it("keys by projectRoot::sessionId and includes nulls", () => {
    writeTranscript([{ type: "ai-title", aiTitle: "Hello" }]);
    const out = resolveSessionTitles([
      { projectRoot: proj, sessionId: ID },
      { projectRoot: proj, sessionId: "other" },
    ]);
    expect(out).toEqual({
      [sessionTitleKey(proj, ID)]: "Hello",
      [sessionTitleKey(proj, "other")]: null,
    });
    expect(sessionTitleKey("/p", "s")).toBe("/p::s");
  });
});
