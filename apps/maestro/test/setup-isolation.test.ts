import { describe, it, expect } from "vitest";
import os from "node:os";
import { pinnedEnv } from "./helpers/env.js";

describe("test environment isolation", () => {
  it("runs with a temp HOME and no inherited session id", () => {
    expect(os.homedir()).toContain("maestro-test-home-");
    expect(process.env.CLAUDE_CODE_SESSION_ID).toBeUndefined();
  });

  it("pinnedEnv pins HOME and deletes the session id unless one is passed", () => {
    process.env.CLAUDE_CODE_SESSION_ID = "leaked";
    try {
      expect(pinnedEnv("home-x").HOME).toBe("home-x");
      expect("CLAUDE_CODE_SESSION_ID" in pinnedEnv("home-x")).toBe(false);
      expect(pinnedEnv("home-x", { CLAUDE_CODE_SESSION_ID: "x" }).CLAUDE_CODE_SESSION_ID).toBe("x");
    } finally {
      delete process.env.CLAUDE_CODE_SESSION_ID;
    }
  });
});
