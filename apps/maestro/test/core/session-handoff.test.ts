// What a create-* form says to the session it hands off into.
//
// Two audiences and two failures worth pinning. The MODEL's copy exists so the conversation does not
// re-ask for a name the form captured, does not rewrite frontmatter the user approved, and does not
// offer to `git init` a directory that already is a repository — each of which is a thing that
// happened before the context existed and would come back the moment a field stopped reaching it.
// The USER's copy exists because a write scope that grew silently is a write scope nobody agreed to,
// so the announcement has to name the directory rather than say that something was opened.

import { describe, it, expect } from "vitest";
import { handoffNotice, handoffSeed, handoffTitle, writeScopeNote } from "../../src/core/session-handoff.js";
import type { HandoffContext } from "../../src/core/contracts.js";

const skill: HandoffContext = {
  kind: "create-skill",
  name: "release-notes",
  artifact: "/home/dev/mk/plugins/p/skills/release-notes/SKILL.md",
  writeScope: "/home/dev/mk/plugins/p/skills/release-notes",
  scope: "directory",
  state: "---\nname: release-notes\ndescription: Writes release notes.\n---",
  repo: "already inside the git repository at /home/dev/mk, with the scaffold's work committed or staged there — do not run git init.",
};

const agent: HandoffContext = {
  ...skill,
  kind: "create-subagent",
  name: "reviewer",
  artifact: "/home/dev/project/.claude/agents/reviewer.md",
  writeScope: "/home/dev/project/.claude/agents/reviewer.md",
  scope: "file",
};

const prompt = "Author the body of that SKILL.md from the idea below.\nIdea: summarise a release.";

describe("the context a handoff seeds", () => {
  it("names the artifact, the write scope and the repository state", () => {
    const seed = handoffSeed(skill, prompt);
    expect(seed).toContain(skill.artifact);
    expect(seed).toContain(skill.writeScope);
    expect(seed).toContain("do not run git init");
  });

  it("carries the frontmatter the form captured, and says not to ask for it again", () => {
    // The whole reason a seed exists rather than a "continue where we left off" sentence: a model
    // that cannot see the description the user approved will ask for one, and then write its own.
    const seed = handoffSeed(skill, prompt);
    expect(seed).toContain("description: Writes release notes.");
    expect(seed).toContain("do not ask for them again");
    expect(seed).toContain("do not rewrite the frontmatter");
  });

  it("carries the previewed prompt verbatim as what is left to write", () => {
    // NOTHING NEW IS INVENTED. Every line of the seed is something the confirmation displayed, which
    // is what makes "the session starts from what you approved" a property rather than a hope — so
    // the prompt goes in whole, not summarised into a sentence of this module's own.
    const seed = handoffSeed(skill, prompt);
    for (const line of prompt.split("\n")) expect(seed).toContain(line);
  });

  it("tells the model an outside write ASKS rather than that it is impossible", () => {
    // MEASURED IN A LIVE SESSION, and it is why this line is worded the way it is. An earlier draft
    // said writes outside the scope were "refused, or come back to the user as a question", and the
    // session refused to attempt one at all — it explained that it could not bypass the app's
    // boundary and offered to write somewhere else instead. That silently deletes `020`: the user
    // only gets the chance to allow a write if the model tries it.
    const seed = handoffSeed(skill, prompt);
    expect(seed).toContain("not forbidden");
    expect(seed).toContain("asks the user, who can allow it");
    expect(seed).not.toContain("still refused");
  });

  it("says a reply is not wanted yet, because the message starts no turn", () => {
    // It is appended with `shouldQuery: false` and merged into the user's first typed message. A
    // model reading an imperative prompt with no framing answers the app instead of the user.
    expect(handoffSeed(skill, prompt)).toContain("No reply is needed");
  });

  it("describes a file scope as a file and a directory scope as a directory", () => {
    expect(handoffSeed(skill, prompt)).toContain("this directory and everything under it");
    expect(handoffSeed(agent, prompt)).toContain("this file and nothing else");
    expect(writeScopeNote("file")).toBe("this file and nothing else");
  });
});

describe("what the user is told", () => {
  it("names the directory that just became writable, and what opened it", () => {
    const notice = handoffNotice(skill);
    expect(notice).toContain(skill.writeScope);
    expect(notice).toContain("create-skill form");
    expect(notice).toContain("release-notes");
  });

  it("says what was NOT added, which is the part that makes it a boundary", () => {
    const notice = handoffNotice(skill);
    expect(notice).toContain("writes anywhere else still ask");
    expect(notice).toContain("no model call");
  });

  it("titles the transcript entry with the form and the artifact", () => {
    expect(handoffTitle(agent)).toBe("Context from the create-subagent form — reviewer");
  });
});
