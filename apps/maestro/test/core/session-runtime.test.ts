// The ephemeral session file helpers, and `036`'s run_id mint — the stamp channel files are
// compared against.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readSession, writeSession, ensureSessionRunId } from "../../src/core/session-runtime.js";

let dir: string;
let sessionPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-session-runtime-"));
  sessionPath = path.join(dir, "maestro_session.json");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("readSession", () => {
  it("defaults to a null run_id alongside workflow/generated_instances when the file is absent", () => {
    expect(readSession(sessionPath)).toEqual({ workflow: null, generated_instances: [], run_id: null });
  });
});

describe("ensureSessionRunId", () => {
  it("mints a run_id on a session with none, and persists it", () => {
    writeSession(sessionPath, { workflow: "default", generated_instances: ["a"] });
    const id = ensureSessionRunId(sessionPath);
    expect(id).toBeTruthy();
    expect(readSession(sessionPath).run_id).toBe(id);
    // Every other field survives the write.
    expect(readSession(sessionPath)).toMatchObject({ workflow: "default", generated_instances: ["a"] });
  });

  it("returns the SAME run_id on a second call, and writes nothing new", () => {
    const first = ensureSessionRunId(sessionPath);
    const mtimeBefore = fs.statSync(sessionPath).mtimeMs;
    const second = ensureSessionRunId(sessionPath);
    expect(second).toBe(first);
    expect(fs.statSync(sessionPath).mtimeMs).toBe(mtimeBefore);
  });

  it("mints a fresh id for a session file that does not exist yet", () => {
    const id = ensureSessionRunId(sessionPath);
    expect(id).toBeTruthy();
    expect(fs.existsSync(sessionPath)).toBe(true);
  });

  it("mints a DIFFERENT id after the session file is deleted (the SessionEnd case)", () => {
    const first = ensureSessionRunId(sessionPath);
    fs.rmSync(sessionPath);
    const second = ensureSessionRunId(sessionPath);
    expect(second).not.toBe(first);
  });
});
