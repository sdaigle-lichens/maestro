import { describe, it, expect } from "vitest";

import { isInterimStop, lastHandoffLabel } from "../../src/core/handoff-label.js";

const call = (message: string) =>
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-01-01T00:00:00.000Z",
    message: { content: [{ type: "tool_use", name: "SendMessage", input: { to: "x", message } }] },
  }) + "\n";

describe("160: HANDOFF separators never span a newline", () => {
  it("a wrapped 'HANDOFF:' then label on the next line is not a malformed final", () => {
    expect(isInterimStop(call("Build running.\nHANDOFF:\nsuccess"))).toBe(true);
  });

  it("'HANDOFF success' on its own line is still a malformed final", () => {
    expect(isInterimStop(call("Build green.\nHANDOFF success"))).toBe(false);
    expect(isInterimStop(call("Build green.\n`HANDOFF success.`"))).toBe(false);
  });

  it("a trailing line break after the malformed word does not hide it", () => {
    expect(isInterimStop(call("Build green.\nHANDOFF success\n\nthanks"))).toBe(false);
  });

  it("lastHandoffLabel does not read a label from the next line", () => {
    expect(lastHandoffLabel("HANDOFF:\nsuccess")).toBeNull();
    expect(lastHandoffLabel("HANDOFF: success")).toBe("success");
    expect(lastHandoffLabel("done\n**HANDOFF:   success**")).toBe("success");
  });
});
