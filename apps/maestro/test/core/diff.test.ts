// The line diff both `031` surfaces render — the /agents review card as coloured rows, the
// maestro/maestro-update skills as `+`/`-` text. One producer, so they cannot disagree.

import { describe, expect, it } from "vitest";
import { diffLines, hasChanges, unifiedDiffText } from "../../src/core/diff.js";

describe("diffLines", () => {
  it("is all context when nothing changed", () => {
    const lines = diffLines("a\nb\nc\n", "a\nb\nc\n");
    expect(lines.map((l) => l.kind)).toEqual(["ctx", "ctx", "ctx"]);
    expect(hasChanges(lines)).toBe(false);
  });

  it("reports a changed line as a deletion followed by an addition", () => {
    expect(diffLines("a\nb\nc\n", "a\nB\nc\n")).toEqual([
      { kind: "ctx", text: "a" },
      { kind: "del", text: "b" },
      { kind: "add", text: "B" },
      { kind: "ctx", text: "c" },
    ]);
  });

  it("does not invent a trailing empty line from the final newline", () => {
    expect(diffLines("a\n", "a\n")).toEqual([{ kind: "ctx", text: "a" }]);
  });

  it("handles an insertion and a deletion at the ends", () => {
    expect(diffLines("b\n", "a\nb\nc\n").map((l) => `${l.kind}:${l.text}`)).toEqual(["add:a", "ctx:b", "add:c"]);
    expect(diffLines("a\nb\nc\n", "b\n").map((l) => `${l.kind}:${l.text}`)).toEqual(["del:a", "ctx:b", "del:c"]);
  });
});

describe("unifiedDiffText", () => {
  it("elides unchanged runs beyond the context window", () => {
    const before = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
    const after = before.replace("line 10", "line TEN");
    const text = unifiedDiffText(diffLines(before, after), 2);
    expect(text).toContain("-line 10");
    expect(text).toContain("+line TEN");
    expect(text).toContain("@@ 8 unchanged lines @@");
    expect(text).not.toContain("line 0");
  });

  it("renders an unchanged file as nothing but elision", () => {
    expect(unifiedDiffText(diffLines("a\nb\n", "a\nb\n"))).toBe("@@ 2 unchanged lines @@");
  });
});
