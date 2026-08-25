// What a live session may READ — the boundary a `PreToolUse` hook enforces.
//
// This is the half `write-scope.ts` structurally cannot cover, and the reason it is a separate
// module rather than a branch: `decideWrite` never sees a `Read`, because reads are auto-approved
// by the permission system and `canUseTool` fires only for calls that would otherwise prompt. So a
// path check added to `decideWrite`'s read branch would look like the fix and would run zero times.
//
// The properties under test: everything inside the scope is allowed with no ceremony, everything
// outside carries a reason the MODEL can act on, and the ways out of a directory that are not a
// plain absolute path — `..`, a relative climb, a search pattern rooted in scope but pointed out of
// it — are all closed. That last one is the interesting case and the one a hand-written check
// misses: `Grep({ path: <in scope>, pattern: "../../../**" })` reads as in-scope until you look at
// both fields together.

import { describe, it, expect } from "vitest";
import path from "node:path";
import {
  boundaryTargetOf,
  decideBoundary,
  grantOptionFor,
  grantOptionsFor,
  BOUNDED_TOOLS,
  UNBOUNDED_TOOLS,
} from "../../src/core/session-scope.js";

const project = "/home/dev/project";
const marketplace = "/home/dev/marketplaces/mine";
const directories = [project, marketplace];

const decide = (tool: string, input: Record<string, unknown>) =>
  decideBoundary({ tool, input, directories, cwd: project });

describe("the target of a bounded call", () => {
  it("is read from whichever key the tool used", () => {
    expect(boundaryTargetOf("Read", { file_path: "/a" }).base).toBe("/a");
    expect(boundaryTargetOf("NotebookEdit", { notebook_path: "/b" }).base).toBe("/b");
    expect(boundaryTargetOf("Read", { path: "/c" }).base).toBe("/c");
  });

  it("keeps a search's root and its pattern apart", () => {
    const target = boundaryTargetOf("Grep", { path: project, pattern: "../secrets/**" });
    expect(target.base).toBe(project);
    expect(target.pattern).toBe("../secrets/**");
  });

  it("ignores a search pattern that cannot escape its root", () => {
    // A relative pattern with no `..` can only match under `path`, which is checked on its own. If
    // every pattern were checked, an ordinary `**/*.ts` would be resolved against the cwd and
    // start producing refusals for searches that were always in scope.
    expect(boundaryTargetOf("Glob", { path: project, pattern: "**/*.ts" }).pattern).toBeNull();
  });
});

describe("a call inside the scope", () => {
  it("is allowed, in the working directory and in an app-opened one alike", () => {
    expect(decide("Read", { file_path: path.join(project, "src/index.ts") })).toEqual({ decision: "allow" });
    expect(decide("Read", { file_path: path.join(marketplace, "plugins/x/SKILL.md") })).toEqual({
      decision: "allow",
    });
  });

  it("resolves a relative path the way the CLI would", () => {
    expect(decide("Read", { file_path: "src/index.ts" })).toEqual({ decision: "allow" });
  });

  it("allows a directory itself, not only what is under it", () => {
    expect(decide("Glob", { path: marketplace })).toEqual({ decision: "allow" });
  });

  it("allows a search that names no root — it defaults to the working directory", () => {
    expect(decide("Grep", { pattern: "TODO" })).toEqual({ decision: "allow" });
  });
});

describe("a call outside the scope", () => {
  it("is out of scope, with the resolved path and every readable tree in the reason", () => {
    const verdict = decide("Read", { file_path: "/etc/passwd" });
    expect(verdict.decision).toBe("out-of-scope");
    if (verdict.decision !== "out-of-scope") throw new Error("unreachable");
    expect(verdict.path).toBe("/etc/passwd");
    // The reason is what the MODEL is handed, so it has to say where it MAY look — a bare "denied"
    // wastes the one channel there is for steering it back to work it can do.
    expect(verdict.reason).toContain("/etc/passwd");
    expect(verdict.reason).toContain(project);
    expect(verdict.reason).toContain(marketplace);
  });

  it("closes the climb out of a directory, not only the absolute path in", () => {
    const verdict = decide("Read", { file_path: "../../.ssh/id_rsa" });
    expect(verdict.decision).toBe("out-of-scope");
    if (verdict.decision !== "out-of-scope") throw new Error("unreachable");
    // Reported RESOLVED. `../../.ssh/id_rsa` in a message tells the user nothing about which file.
    expect(verdict.path).toBe("/home/.ssh/id_rsa");
  });

  it("is not fooled by a sibling directory that shares a prefix", () => {
    // `/home/dev/project-secrets` starts with `/home/dev/project`. A `startsWith` check would let
    // it through; the boundary is a path-segment comparison for exactly this.
    expect(decide("Read", { file_path: "/home/dev/project-secrets/keys" }).decision).toBe("out-of-scope");
  });

  it("closes a search rooted in scope but pointed out of it", () => {
    const verdict = decide("Grep", { path: project, pattern: "../../*.pem" });
    expect(verdict.decision).toBe("out-of-scope");
    if (verdict.decision !== "out-of-scope") throw new Error("unreachable");
    // Resolved through the root the search named, so the reported path is where it would actually
    // have looked — `/home/dev/project` + `../../` is `/home`.
    expect(verdict.path).toBe("/home/*.pem");
  });

  it("closes an absolute search pattern with no root at all", () => {
    expect(decide("Glob", { pattern: "/etc/**" }).decision).toBe("out-of-scope");
  });

  it("refuses a file tool that named no path, rather than waving through what it cannot check", () => {
    const verdict = decide("Read", {});
    expect(verdict.decision).toBe("out-of-scope");
    if (verdict.decision !== "out-of-scope") throw new Error("unreachable");
    expect(verdict.reason).toMatch(/without a path/);
  });
});

describe("the fall-through", () => {
  it("allows tools this boundary is not about", () => {
    // The OPPOSITE of `decideWrite`'s fall-through, and deliberately. That function is the whole
    // permission decision for a call and must refuse what it does not understand; this one runs in
    // FRONT of a permission model that still applies. A tool with no path in it has not left the
    // boundary, and refusing it here would quietly make this a second tool allowlist, drifting from
    // the one in `agent-sdk.ts`.
    for (const tool of UNBOUNDED_TOOLS) expect(decide(tool, {})).toEqual({ decision: "allow" });
    expect(decide("SomeToolNobodyHasWrittenYet", { file_path: "/etc/passwd" })).toEqual({ decision: "allow" });
  });

  it("checks every write tool too, even though the empty write scope refuses them first", () => {
    // The hook runs the boundary only on read-only tools today, because `decideWrite` owns writes
    // and a refused write must carry ITS reason rather than a second one. This module still knows
    // how to check them, so `023` — which adds a writable directory — cannot widen reads by
    // accident when it widens writes.
    for (const tool of ["Write", "Edit", "MultiEdit", "NotebookEdit"]) {
      expect(BOUNDED_TOOLS as readonly string[]).toContain(tool);
      expect(decide(tool, { file_path: "/etc/passwd" }).decision).toBe("out-of-scope");
    }
  });
});

describe("an empty scope", () => {
  it("reads nothing, and says so in words rather than as an empty list", () => {
    const verdict = decideBoundary({ tool: "Read", input: { file_path: "/a" }, directories: [], cwd: project });
    expect(verdict.decision).toBe("out-of-scope");
    if (verdict.decision !== "out-of-scope") throw new Error("unreachable");
    expect(verdict.reason).toContain("nothing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "unless authorised" — what a PERSON could open in answer to one of those refusals.
//
// The boundary above is only half a boundary. A user authoring a skill will reasonably say "make it
// like my existing one", and their own global skills live outside the project and outside every
// marketplace; denying that outright is wrong and granting it silently is worse. What is tested
// here is the offer, not the answer: which options exist, what each of them actually costs, and the
// cases where offering anything at all would be wrong.
// ─────────────────────────────────────────────────────────────────────────────

describe("what a person could grant", () => {
  const skill = "/home/dev/.claude/skills/mine/SKILL.md";

  it("offers the file and its directory, and they are different things", () => {
    const options = grantOptionsFor(skill, false, directories);
    expect(options.map((o) => o.scope)).toEqual(["file", "directory"]);
    expect(options[0].path).toBe(skill);
    expect(options[1].path).toBe("/home/dev/.claude/skills/mine");
  });

  it("names the path in each option, because the two are the same sentence otherwise", () => {
    // The whole point of two buttons is that the user can see which one says the containing folder.
    for (const option of grantOptionsFor(skill, false, directories)) {
      expect(option.note).toContain(option.scope === "file" ? "SKILL.md" : "/home/dev/.claude/skills/mine");
    }
  });

  it("offers a directory only as itself — never its parent", () => {
    // Climbing to the parent of a directory the model asked about answers a question nobody asked,
    // and the parent of `~/.claude/skills` is every piece of Claude configuration the user has.
    const options = grantOptionsFor("/home/dev/.claude/skills", true, directories);
    expect(options.map((o) => o.scope)).toEqual(["directory"]);
    expect(options[0].path).toBe("/home/dev/.claude/skills");
  });

  it("offers nothing for a path already in scope", () => {
    // A button that changes nothing is worse than no button: it reads as consent to something.
    expect(grantOptionsFor(`${project}/src/index.ts`, false, directories)).toEqual([]);
    expect(grantOptionsFor(project, true, directories)).toEqual([]);
  });

  it("offers nothing when there is no path to grant", () => {
    // The call the hook still denies outright. There is nothing here for a person to authorise.
    expect(grantOptionsFor("", false, directories)).toEqual([]);
    expect(grantOptionsFor("relative/path.md", false, directories)).toEqual([]);
  });

  it("flags a shallow directory as broad rather than quietly offering it", () => {
    // A home directory and a filesystem root are still offerable — the user may genuinely mean it —
    // but never in the same visual weight as one more skill folder.
    expect(grantOptionsFor("/home/dev/notes.md", false, directories)[1]).toMatchObject({
      path: "/home/dev",
      broad: true,
    });
    expect(grantOptionsFor("/home/dev", true, directories)[0].broad).toBe(true);
    expect(grantOptionsFor("/home/dev/.claude/skills/mine", true, directories)[0].broad).toBe(false);
  });

  it("flags a directory that would swallow something already in scope, and names what", () => {
    // `/home/dev/marketplaces` is three segments deep and looks ordinary; granting it opens the
    // marketplace the session was already reading AND every other one beside it.
    const option = grantOptionsFor("/home/dev/marketplaces/README.md", false, directories)[1];
    expect(option).toMatchObject({ path: "/home/dev/marketplaces", broad: true });
    expect(option.note).toContain(marketplace);
  });

  it("does not offer a directory that is already in scope beside a file that is not", () => {
    // A file the boundary stopped inside a readable tree cannot happen today, but a `..`-shaped
    // target can resolve to one — and the directory arm would then be a no-op button.
    const options = grantOptionsFor("/home/dev/project/../project/x", false, directories);
    expect(options).toEqual([]);
  });

  it("resolves an answer against the options that were published, and nothing else", () => {
    const options = grantOptionsFor(skill, false, directories);
    expect(grantOptionFor(options, "directory")?.path).toBe("/home/dev/.claude/skills/mine");
    expect(grantOptionFor(options, "file")?.path).toBe(skill);
    // A scope the prompt never offered grants nothing — which is what makes the wire's missing path
    // safe rather than merely tidy.
    expect(grantOptionFor([], "directory")).toBeNull();
    expect(grantOptionFor(options, "everything")).toBeNull();
    expect(grantOptionFor(options, undefined)).toBeNull();
  });
});
