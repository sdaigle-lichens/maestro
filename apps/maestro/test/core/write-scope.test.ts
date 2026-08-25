// What a run may WRITE — the decision that replaced `--permission-mode acceptEdits`.
//
// The flag it replaced needed no tests: it meant "yes" to every edit anywhere under the working
// directory. This is a real decision made per tool call, and the whole reason it is a pure function
// in its own module is so it can be checked exhaustively here rather than inferred from a session
// that costs money to run.
//
// The property under test throughout: a decision is either an allow or a deny WITH A MESSAGE.
// Never undefined, never null — the SDK reads null as "the host answered out of band" and a tool
// call that gets one blocks forever, with nothing on screen and no timeout behind it.

import { describe, it, expect } from "vitest";
import path from "node:path";
import { decideWrite, targetPathOf, READ_ONLY_TOOLS, WRITE_TOOLS } from "../../src/core/write-scope.js";

const cwd = "/home/dev/marketplace";
const skill = path.join(cwd, "plugins", "thing", "skills", "do-it", "SKILL.md");

const decide = (tool: string, input: Record<string, unknown>, writable: string[] = [skill]) =>
  decideWrite({ tool, input, writable, cwd });

describe("the target path", () => {
  it("is read from whichever key the tool used", () => {
    expect(targetPathOf({ file_path: "/a" })).toBe("/a");
    expect(targetPathOf({ notebook_path: "/b" })).toBe("/b");
    expect(targetPathOf({ path: "/c" })).toBe("/c");
  });

  it("is null when the input names none, rather than an empty string that would resolve to the cwd", () => {
    // `path.resolve(cwd, "")` is the cwd, which is inside a directory target — so a blank path
    // would be ALLOWED by a check that did not distinguish it from an absent one.
    expect(targetPathOf({})).toBeNull();
    expect(targetPathOf({ file_path: "   " })).toBeNull();
    expect(targetPathOf({ file_path: 42 })).toBeNull();
  });
});

describe("a write inside the scope", () => {
  it("is allowed silently — there is no prompt and nothing for the user to notice", () => {
    expect(decide("Write", { file_path: skill })).toEqual({ behavior: "allow" });
    expect(decide("Edit", { file_path: skill })).toEqual({ behavior: "allow" });
  });

  it("resolves a relative path the way the CLI would, against the run's own cwd", () => {
    expect(decide("Edit", { file_path: "plugins/thing/skills/do-it/SKILL.md" })).toEqual({ behavior: "allow" });
  });

  it("treats a DIRECTORY target as everything under it, and a FILE target as itself", () => {
    // Both shapes are real: a create-* flow names one file, a maestro-task names the project root.
    const dir = decideWrite({ tool: "Write", input: { file_path: path.join(cwd, "a", "b.md") }, writable: [cwd], cwd });
    expect(dir).toEqual({ behavior: "allow" });

    const file = decide("Write", { file_path: path.join(path.dirname(skill), "OTHER.md") });
    expect(file.behavior).toBe("deny");
  });
});

describe("a write outside the scope", () => {
  it("is denied with a reason the model can act on, naming both paths", () => {
    const decision = decide("Write", { file_path: "/etc/passwd" });
    expect(decision.behavior).toBe("deny");
    if (decision.behavior !== "deny") return;
    // The model READS denials and adapts. "denied" would waste the one channel for steering it.
    expect(decision.message).toContain("/etc/passwd");
    expect(decision.message).toContain(skill);
    expect(decision.message).toMatch(/Finish the file you were asked to write/);
  });

  it("is denied even when it is inside the working directory", () => {
    // The whole point of the slice: `acceptEdits` allowed anything anywhere under the cwd, and for
    // a marketplace target that cwd is an entire repository the user did not think they opened up.
    const decision = decide("Edit", { file_path: path.join(cwd, ".git", "config") });
    expect(decision.behavior).toBe("deny");
  });

  it("is denied when the path escapes upward through the cwd", () => {
    expect(decide("Write", { file_path: "../../etc/hosts" }).behavior).toBe("deny");
  });

  it("is denied when the tool named no path at all", () => {
    // Unparseable input is not a reason to allow: an unchecked write is the failure this prevents.
    const decision = decide("Write", {});
    expect(decision.behavior).toBe("deny");
    if (decision.behavior !== "deny") return;
    expect(decision.message).toContain("without a file path");
  });
});

describe("a run with no write authority", () => {
  // The help chat. It used to be the ABSENCE of a flag; it is now an empty list that is enforced.
  it("denies every write, and says what the run is for instead", () => {
    const decision = decideWrite({ tool: "Write", input: { file_path: skill }, writable: [], cwd });
    expect(decision.behavior).toBe("deny");
    if (decision.behavior !== "deny") return;
    expect(decision.message).toMatch(/no write authority/);
  });

  it("still allows it to read and search — answering is the whole job", () => {
    for (const tool of READ_ONLY_TOOLS) {
      expect(decideWrite({ tool, input: {}, writable: [], cwd }), tool).toEqual({ behavior: "allow" });
    }
  });
});

describe("the fall-through", () => {
  it("denies a tool this module has never heard of, rather than allowing it", () => {
    // A tool added to the session's tool set without anyone working out its filesystem reach fails
    // loudly on its first call. The alternative — allow-by-default — is silent and permanent.
    const decision = decide("Bash", { command: "rm -rf /" });
    expect(decision.behavior).toBe("deny");
    if (decision.behavior !== "deny") return;
    expect(decision.message).toContain("does not offer the Bash tool");
  });

  it("checks every write tool it knows, including ones the session is not offered", () => {
    // Wider than the offered set on purpose: `NotebookEdit` is disallowed, and if something ever
    // put it back it should arrive here as a path check rather than as an unknown-tool refusal.
    for (const tool of WRITE_TOOLS) {
      expect(decide(tool, { file_path: skill }), tool).toEqual({ behavior: "allow" });
      expect(decide(tool, { file_path: "/tmp/elsewhere" }).behavior, tool).toBe("deny");
    }
  });

  it("never produces anything but an allow or a deny with a message", () => {
    const inputs: Array<[string, Record<string, unknown>]> = [
      ["Write", {}],
      ["Edit", { file_path: null as unknown as string }],
      ["Unknown", {}],
      ["Read", { file_path: "/etc/shadow" }],
    ];
    for (const [tool, input] of inputs) {
      const decision = decide(tool, input);
      expect(["allow", "deny"]).toContain(decision.behavior);
      if (decision.behavior === "deny") expect(decision.message.length).toBeGreaterThan(0);
    }
  });
});
