// When a session asks a PERSON, and what the question shows.
//
// The properties under test are the ones that fail silently. A call that should have asked and was
// allowed instead leaves no trace at all — the model simply did the thing. A prompt rendered from a
// payload dump looks fine in a screenshot and is answered with a reflexive Allow. And a URL elided
// to its hostname reads as more careful than the full one while hiding the only part that matters:
// `example.com` and `example.com/collect?body=<the user's file>` are the same prompt.
//
// The other half is the one this module must NOT do: it composes `decideWrite` and `decideBoundary`
// rather than re-deciding, so a refused write still carries `write-scope.ts`'s reason and a tool the
// session never offered is still refused outright rather than offered to the user as a button.

import { describe, it, expect } from "vitest";
import {
  autoRefusal,
  decidePaneCall,
  describeCall,
  permissionReason,
  PANE_ASK_TOOLS,
} from "../../src/core/session-permission.js";

const project = "/home/dev/project";
const marketplace = "/home/dev/marketplaces/mine";
const directories = [project, marketplace];

const decide = (tool: string, input: Record<string, unknown>, writable: string[] = []) =>
  decidePaneCall({ tool, input, writable, directories, cwd: project });

describe("what a person is asked about", () => {
  it("asks before anything leaves the machine", () => {
    // Neither scope module has an opinion about these — they touch no path — so without an explicit
    // entry they fall through every check and are auto-approved. The session can read the user's
    // project, and an outbound request is how the contents of it leave.
    for (const tool of PANE_ASK_TOOLS) {
      expect(decide(tool, { url: "https://example.com", query: "q" }).outcome).toBe("ask");
    }
  });

  it("asks about a read the boundary stopped, carrying the boundary's own reason", () => {
    const verdict = decide("Read", { file_path: "/etc/passwd" });
    expect(verdict.outcome).toBe("ask");
    if (verdict.outcome !== "ask") return;
    expect(verdict.target).toBe("/etc/passwd");
    // The reason is `session-scope.ts`'s, verbatim — not a second sentence written here that could
    // drift from the one the model is given.
    expect(verdict.reason).toContain("outside what this session may read");
    expect(verdict.reason).toContain(project);
  });

  it("allows a read inside the scope with no ceremony", () => {
    expect(decide("Read", { file_path: `${project}/README.md` })).toEqual({
      outcome: "settled",
      decision: { behavior: "allow" },
    });
    expect(decide("Read", { file_path: `${marketplace}/plugins/x/SKILL.md` }).outcome).toBe("settled");
  });

  it("asks about a write instead of ending the matter, and keeps the ENGINE's reason for the model", () => {
    // The pane's write scope is empty and `decideWrite` still produces the refusal. What changed is
    // that the refusal is a question rather than the end of it — the branch where the answer comes
    // from a person instead of from the path list.
    const verdict = decide("Write", { file_path: `${project}/notes.md`, content: "hi" });
    expect(verdict.outcome).toBe("ask");
    if (verdict.outcome !== "ask") return;
    expect(verdict.target).toBe(`${project}/notes.md`);
    // TWO AUDIENCES, TWO SENTENCES. The prompt is read by a person, so `reason` names the file and
    // says what allowing it does. `decideWrite`'s message — written to steer a MODEL back to useful
    // work — is what that model is told if the user denies without typing anything, which is how
    // "a refused write still carries `decideWrite`'s reason" survives the write becoming a prompt.
    expect(verdict.reason).toContain(`${project}/notes.md`);
    expect(verdict.reason).toContain("grants nothing further");
    expect(verdict.denyReason).toContain("no write authority");
  });

  it("allows a write the write scope already covers, without asking", () => {
    const verdict = decide("Write", { file_path: `${project}/skills/a/SKILL.md`, content: "x" }, [`${project}/skills`]);
    expect(verdict).toEqual({ outcome: "settled", decision: { behavior: "allow" } });
  });

  it("describes a write scope that EXISTS rather than one that was never given", () => {
    // `022` made the scope non-empty, which gave this branch a second state to describe. Telling a
    // user "nothing has given this session write access" while the pane header lists a directory it
    // may write is the kind of wrong that teaches people to stop reading prompts.
    const scope = `${marketplace}/plugins/p/skills/a`;
    const verdict = decide("Write", { file_path: `${marketplace}/README.md`, content: "x" }, [scope]);
    expect(verdict.outcome).toBe("ask");
    if (verdict.outcome !== "ask") return;
    expect(verdict.reason).toContain(`${marketplace}/README.md`);
    expect(verdict.reason).toContain(scope);
    expect(verdict.reason).toContain("adds nothing to the list");
    expect(verdict.reason, "still claiming nothing was ever given").not.toContain("Nothing has given");
    // The model's sentence is still `decideWrite`'s, and it names what may be written.
    expect(verdict.denyReason).toContain(scope);
    // And allowing it is still a one-call answer: nothing here reports a wider scope back.
    expect(verdict.grantable).toBe(false);
  });

  it("REFUSES a tool the session never offered rather than offering it as a button", () => {
    // The line that keeps a permission prompt from becoming a hole with a dialog on it. "May I use
    // Bash" is not a question for a dialog box: the tool is absent from the session's context on
    // purpose, and reaching here means something is wrong rather than that consent is needed.
    const verdict = decide("Bash", { command: "rm -rf /" });
    expect(verdict.outcome).toBe("settled");
    if (verdict.outcome !== "settled") return;
    expect(verdict.decision.behavior).toBe("deny");
    if (verdict.decision.behavior !== "deny") return;
    expect(verdict.decision.message).toContain("does not offer the Bash tool");
  });

  it("never produces an empty reason", () => {
    expect(permissionReason("", "fallback")).toBe("fallback");
    expect(permissionReason("   ", "fallback")).toBe("fallback");
    expect(permissionReason(null, "fallback")).toBe("fallback");
    expect(permissionReason("because", "fallback")).toBe("because");

    for (const call of [
      decide("WebFetch", { url: "https://x.test" }),
      decide("Read", { file_path: "/etc/hosts" }),
      decide("Edit", { file_path: `${project}/a.md`, old_string: "a", new_string: "b" }),
    ]) {
      expect(call.outcome).toBe("ask");
      if (call.outcome !== "ask") continue;
      expect(call.reason.trim()).not.toBe("");
      expect(call.denyReason.trim()).not.toBe("");
    }
  });
});

describe("what the prompt renders", () => {
  it("shows the COMPLETE url, query string included", () => {
    const url = "https://example.com/collect?token=abc123&body=%2Fhome%2Fdev%2Fproject%2F.env";
    const detail = describeCall("WebFetch", { url, prompt: "summarise" }, project);
    expect(detail).toEqual({ kind: "fetch", url, prompt: "summarise" });
  });

  it("shows a write's path and what would change", () => {
    const detail = describeCall("Edit", { file_path: "notes.md", old_string: "one", new_string: "two" }, project);
    expect(detail.kind).toBe("write");
    if (detail.kind !== "write") return;
    // Resolved against the cwd, the way the CLI would — a relative path in a prompt is ambiguous
    // about the one thing the user is being asked to approve.
    expect(detail.path).toBe(`${project}/notes.md`);
    expect(detail.diff?.hunks).toEqual([{ before: "one", after: "two" }]);
  });

  it("shows a new file as a creation rather than as a change", () => {
    const detail = describeCall("Write", { file_path: `${project}/new.md`, content: "body" }, project);
    if (detail.kind !== "write") throw new Error("expected a write");
    expect(detail.diff?.hunks).toEqual([{ before: null, after: "body" }]);
  });

  it("caps a multi-part edit and says how much it left out", () => {
    const edits = Array.from({ length: 6 }, (_, i) => ({ old_string: `a${i}`, new_string: `b${i}` }));
    const detail = describeCall("MultiEdit", { file_path: `${project}/x.md`, edits }, project);
    if (detail.kind !== "write") throw new Error("expected a write");
    expect(detail.diff?.hunks).toHaveLength(3);
    expect(detail.diff?.more).toBe(3);
  });

  it("clips a body rather than pasting a whole file into a prompt", () => {
    const detail = describeCall("Write", { file_path: `${project}/x.md`, content: "x".repeat(5000) }, project);
    if (detail.kind !== "write") throw new Error("expected a write");
    expect(detail.diff?.clipped).toBe(true);
    expect(detail.diff?.hunks[0].after.length).toBeLessThan(1000);
  });

  it("keeps a search's root and its pattern apart, since either can leave the scope", () => {
    expect(describeCall("Grep", { path: "src", pattern: "../../*.env" }, project)).toEqual({
      kind: "scan",
      path: `${project}/src`,
      pattern: "../../*.env",
    });
  });

  it("NAMES an unrecognised tool rather than dumping its input", () => {
    const detail = describeCall("Skill", { skill: "super-help", extra: { nested: [1, 2, 3] } }, project);
    expect(detail).toEqual({ kind: "other", summary: "Skill(super-help)" });
    // The failure this rules out: a prompt whose body is the stringified payload. It is technically
    // correct, unreadable, and therefore answered with a reflexive Allow.
    expect(JSON.stringify(detail)).not.toContain("nested");
  });
});

describe("a call the permission system auto-denied", () => {
  // THE FOURTH ROUTE. This one never reaches `canUseTool` at all — a deny rule or the permission
  // mode answers first, and the only report is a stream event. It also cannot be provoked from a
  // window without a machine-wide administrator policy file, which is exactly why the mapping is a
  // function: the alternative is a branch nobody can test and everybody assumes works.
  it("names the tool, the reason and the component that decided", () => {
    expect(
      autoRefusal({
        tool_name: "WebFetch",
        decision_reason: "Blocked by a deny rule for WebFetch(domain:example.com)",
        decision_reason_type: "rule",
        message: "Permission to use WebFetch has been denied.",
      })
    ).toEqual({
      kind: "refusal",
      tool: "WebFetch",
      target: null,
      reason: "Blocked by a deny rule for WebFetch(domain:example.com)",
      source: "auto",
      decidedBy: "rule",
    });
  });

  it("falls back to the model-facing message, then to a sentence of its own", () => {
    // `decision_reason` is optional — the SDK types it as "when available" — so the fallback chain
    // is what keeps an auto-denial from rendering as an empty amber box.
    expect(autoRefusal({ tool_name: "Edit", message: "Denied by mode.", decision_reason_type: "mode" }).reason).toBe(
      "Denied by mode."
    );
    const bare = autoRefusal({ tool_name: "Edit" });
    expect(bare.kind === "refusal" && bare.reason).toContain("permission settings");
    expect(bare.kind === "refusal" && bare.decidedBy).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// WHICH PROMPTS MAY OFFER A SESSION GRANT — and, more importantly, which may not.
//
// `grantable` is one boolean and it decides whether a prompt grows a button that permanently (for
// the session) widens what the model can see. The dangerous direction is not "we forgot to offer
// one": it is offering one on a WRITE prompt, where the user reads "allow this folder", presses it,
// and widens the read scope from a question about writing. That is the accident `session-scope.ts`
// was deliberately kept able to check write tools in order to make visible, so it is pinned here.
// ─────────────────────────────────────────────────────────────────────────────

describe("which prompts may offer a session grant", () => {
  const outside = "/home/dev/.claude/skills/mine/SKILL.md";

  it("offers one for a read the boundary stopped — the case it exists for", () => {
    const verdict = decide("Read", { file_path: outside });
    expect(verdict.outcome).toBe("ask");
    if (verdict.outcome !== "ask") throw new Error("unreachable");
    expect(verdict.grantable).toBe(true);
    expect(verdict.target).toBe(outside);
  });

  it("offers one for an out-of-scope search too", () => {
    const verdict = decide("Grep", { path: "/home/dev/.claude/skills", pattern: "*.md" });
    expect(verdict.outcome === "ask" && verdict.grantable).toBe(true);
  });

  it("NEVER offers one on a write, however far outside the scope it is", () => {
    // Widening writes is the create-* handoff's, and `022` built that WITHOUT touching this: a
    // grant button here would widen READS from a write prompt, which is both the wrong surface and
    // the one the user did not think they were answering about.
    for (const tool of ["Write", "Edit", "MultiEdit"]) {
      const verdict = decide(tool, { file_path: outside, content: "x", new_string: "x" });
      expect(verdict.outcome).toBe("ask");
      expect(verdict.outcome === "ask" && verdict.grantable, `${tool} offered a grant`).toBe(false);
    }
  });

  it("never offers one on a network call, which has no path to grant", () => {
    for (const tool of PANE_ASK_TOOLS) {
      const verdict = decide(tool, { url: "https://example.com/x", query: "x" });
      expect(verdict.outcome === "ask" && verdict.grantable).toBe(false);
    }
  });

  it("offers nothing for the call the boundary cannot check at all", () => {
    // A bounded tool that named no path. The hook denies it outright rather than prompting, and if
    // it ever did prompt there would be nothing named for a person to authorise.
    const verdict = decidePaneCall({ tool: "Read", input: {}, writable: [], directories, cwd: project });
    expect(verdict.outcome).toBe("ask");
    expect(verdict.outcome === "ask" && verdict.grantable).toBe(false);
    expect(verdict.outcome === "ask" && verdict.target).toBeNull();
  });
});
