// `152` items 3 and 4: `readSessionLog` (no caller) is gone from the module, the core barrel and the
// log-view skill, while `tailSessionLog` (kept on purpose for differential coverage) is still
// exported and still works. `SessionTitleRef` is gone and `resolveSessionTitles` takes the one
// remaining `SessionRef` shape. Checked against the real module namespaces and the real files.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import * as sessionLog from "../../src/core/session-log.js";
import * as core from "../../src/core/index.js";
import { resolveSessionTitles, sessionTitleKey } from "../../src/core/session-title.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(here, "..", "..");

describe("readSessionLog is removed, tailSessionLog is kept (152 item 4)", () => {
  it("is not exported from session-log.ts", () => {
    expect("readSessionLog" in sessionLog).toBe(false);
  });

  it("is not re-exported from the core barrel", () => {
    expect("readSessionLog" in core).toBe(false);
  });

  it("tailSessionLog and the rest of the live tail are still exported from both", () => {
    expect(typeof sessionLog.tailSessionLog).toBe("function");
    expect(typeof sessionLog.tailSessionLogs).toBe("function");
    expect(typeof core.tailSessionLog).toBe("function");
    expect(typeof core.tailSessionLogs).toBe("function");
    expect(typeof core.parseLogLines).toBe("function");
  });

  it("is not mentioned in the log-view skill, which still documents tailSessionLog", () => {
    const skill = fs.readFileSync(path.join(APP, ".claude", "skills", "log-view", "SKILL.md"), "utf8");
    expect(skill).not.toContain("readSessionLog");
    expect(skill).toContain("tailSessionLog");
  });

  it("is not defined anywhere in the app source", () => {
    const src = fs.readFileSync(path.join(APP, "src", "core", "session-log.ts"), "utf8");
    expect(src).not.toMatch(/\breadSessionLog\b/);
  });
});

describe("one session reference interface remains (152 item 3)", () => {
  it("SessionTitleRef is not defined in session-title.ts (type-only, so checked against the source)", () => {
    const src = fs.readFileSync(path.join(APP, "src", "core", "session-title.ts"), "utf8");
    expect(src).not.toMatch(/\bSessionTitleRef\b/);
  });

  it("resolveSessionTitles accepts the SessionRef shape and keys its answer by projectRoot::sessionId", () => {
    const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "maestro-152-title-")));
    try {
      const root = path.join(tmp, "proj");
      fs.mkdirSync(root, { recursive: true });
      const ref = { projectRoot: root, sessionId: "abcdef12-0000" };
      const out = resolveSessionTitles([ref], { HOME: path.join(tmp, "home") });
      expect(Object.keys(out)).toEqual([sessionTitleKey(root, "abcdef12-0000")]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
