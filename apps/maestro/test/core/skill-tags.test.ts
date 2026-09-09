// Skill tags: the global (per skill id, not per project) SQLite store, two dimensions (project
// tags, agent types), and the pure tags→SkillMap lookup both seed paths and /maestro-install's
// terminal path converge on.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  readAllSkillTags,
  setSkillProjectTags,
  setSkillAgentTypes,
  skillMapFromTags,
  parseSkillTagsBlock,
  applySkillTagsBlock,
} from "../../src/core/skill-tags.js";

describe("readAllSkillTags / setSkillProjectTags / setSkillAgentTypes", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-skill-tags-"));
    dbPath = path.join(dir, "tags.sqlite");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("starts empty against a fresh db path", () => {
    expect(readAllSkillTags(dbPath)).toEqual({});
  });

  it("round-trips a skill's project tags, leaving its agent types empty", () => {
    setSkillProjectTags("react", ["frontend"], dbPath);
    expect(readAllSkillTags(dbPath)).toEqual({ react: { projectTags: ["frontend"], agentTypes: [] } });
  });

  it("round-trips a skill's agent types, leaving its project tags empty", () => {
    setSkillAgentTypes("react", ["developer"], dbPath);
    expect(readAllSkillTags(dbPath)).toEqual({ react: { projectTags: [], agentTypes: ["developer"] } });
  });

  it("both dimensions on one skill are independent and both readable together", () => {
    setSkillProjectTags("react", ["frontend"], dbPath);
    setSkillAgentTypes("react", ["developer", "tester"], dbPath);
    expect(readAllSkillTags(dbPath)).toEqual({
      react: { projectTags: ["frontend"], agentTypes: ["developer", "tester"] },
    });
  });

  it("dedupes and sorts what it stores", () => {
    const stored = setSkillProjectTags("db-migrations", ["backend", "backend", "frontend"], dbPath);
    expect(stored).toEqual(["backend", "frontend"]);
  });

  it("replace-all: a second call drops values the first one set, on that dimension only", () => {
    setSkillProjectTags("react", ["frontend", "mobile"], dbPath);
    setSkillAgentTypes("react", ["developer"], dbPath);
    setSkillProjectTags("react", ["frontend"], dbPath);
    expect(readAllSkillTags(dbPath)).toEqual({
      react: { projectTags: ["frontend"], agentTypes: ["developer"] },
    });
  });

  it("clears a skill's project tags entirely when set to an empty list, without touching agent types", () => {
    setSkillProjectTags("react", ["frontend"], dbPath);
    setSkillAgentTypes("react", ["developer"], dbPath);
    setSkillProjectTags("react", [], dbPath);
    expect(readAllSkillTags(dbPath)).toEqual({ react: { projectTags: [], agentTypes: ["developer"] } });
  });

  it("keeps other skills' tags untouched", () => {
    setSkillProjectTags("react", ["frontend"], dbPath);
    setSkillAgentTypes("changelog", ["annotator"], dbPath);
    expect(readAllSkillTags(dbPath)).toEqual({
      react: { projectTags: ["frontend"], agentTypes: [] },
      changelog: { projectTags: [], agentTypes: ["annotator"] },
    });
  });
});

describe("skillMapFromTags", () => {
  const backendDev = { backend: { type: "developer", projectTag: "backend" } };
  const fullstackDev = {
    backend: { type: "developer", projectTag: "backend" },
    frontend: { type: "developer", projectTag: "frontend" },
  };
  const withCore = {
    ...fullstackDev,
    test: { type: "tester", projectTag: "global" },
    reviewer: { type: "reviewer", projectTag: "global" },
  };

  it("routes a skill to every agent whose own type AND project tag both match", () => {
    const map = skillMapFromTags(
      { "db-migrations": { projectTags: ["backend"], agentTypes: ["developer"] } },
      ["db-migrations"],
      backendDev
    );
    expect(map).toEqual({ backend: ["db-migrations"] });
  });

  it("does not leak a project-tag-specific skill onto a different agent in a fullstack seed", () => {
    // Both backend and frontend are `developer`-type; a skill scoped to "backend" only must not
    // reach the frontend instance even though it's the same agent type.
    const map = skillMapFromTags(
      { "db-migrations": { projectTags: ["backend"], agentTypes: ["developer"] } },
      ["db-migrations"],
      fullstackDev
    );
    expect(map).toEqual({ backend: ["db-migrations"] });
  });

  it("'global' on the project-tags dimension matches every agent's own project tag", () => {
    const map = skillMapFromTags(
      { "code-style": { projectTags: ["global"], agentTypes: ["developer"] } },
      ["code-style"],
      fullstackDev
    );
    expect(map.backend).toEqual(["code-style"]);
    expect(map.frontend).toEqual(["code-style"]);
  });

  it("'global' on the agent-types dimension matches every agent's own type", () => {
    const map = skillMapFromTags(
      { "house-style": { projectTags: ["backend"], agentTypes: ["global"] } },
      ["house-style"],
      { ...backendDev, reviewer: { type: "reviewer", projectTag: "backend" } }
    );
    expect(map.backend).toEqual(["house-style"]);
    expect(map.reviewer).toEqual(["house-style"]);
  });

  it("a core agent's own project tag is 'global', so a project-tags:['global'] skill reaches it", () => {
    const map = skillMapFromTags(
      { "test-conventions": { projectTags: ["global"], agentTypes: ["tester"] } },
      ["test-conventions"],
      withCore
    );
    expect(map).toEqual({ test: ["test-conventions"] });
  });

  it("an empty dimension matches nothing, even if the other dimension would otherwise match", () => {
    const noProjectTags = skillMapFromTags(
      { orphan: { projectTags: [], agentTypes: ["developer"] } },
      ["orphan"],
      backendDev
    );
    expect(noProjectTags).toEqual({});
    const noAgentTypes = skillMapFromTags(
      { orphan: { projectTags: ["backend"], agentTypes: [] } },
      ["orphan"],
      backendDev
    );
    expect(noAgentTypes).toEqual({});
  });

  it("drops a skill id that no longer exists in this project's discovered set", () => {
    // A stale tag (renamed/removed skill), or a same-named skill tagged in an unrelated project —
    // the global store's one real trade-off, guarded against by intersecting with `skillIds`.
    const map = skillMapFromTags(
      { ghost: { projectTags: ["backend"], agentTypes: ["developer"] } },
      ["real-skill"],
      backendDev
    );
    expect(map).toEqual({});
  });

  it("unions several skills onto the same agent", () => {
    const map = skillMapFromTags(
      {
        react: { projectTags: ["frontend"], agentTypes: ["developer"] },
        styling: { projectTags: ["frontend"], agentTypes: ["developer"] },
      },
      ["react", "styling"],
      { frontend: { type: "developer", projectTag: "frontend" } }
    );
    expect(map.frontend?.sort()).toEqual(["react", "styling"]);
  });

  it("is empty over an empty tags store", () => {
    expect(skillMapFromTags({}, ["react"], backendDev)).toEqual({});
  });
});

describe("parseSkillTagsBlock", () => {
  const CATALOG = ["backend", "frontend"];

  it("parses a well-formed block", () => {
    const text =
      'Done. \n```update-skill-tags\n{"my-skill": {"projectTags": ["backend"], "agentTypes": ["developer", "tester"]}, "other": {"projectTags": [], "agentTypes": []}}\n```\n';
    expect(parseSkillTagsBlock(text, CATALOG)).toEqual({
      "my-skill": { projectTags: ["backend"], agentTypes: ["developer", "tester"] },
      other: { projectTags: [], agentTypes: [] },
    });
  });

  it("accepts the 'global' sentinel on either dimension", () => {
    const text = '```update-skill-tags\n{"my-skill": {"projectTags": ["global"], "agentTypes": ["global"]}}\n```';
    expect(parseSkillTagsBlock(text, CATALOG)).toEqual({
      "my-skill": { projectTags: ["global"], agentTypes: ["global"] },
    });
  });

  it("returns null when there is no block", () => {
    expect(parseSkillTagsBlock("Just some prose, no fenced block here.", CATALOG)).toBeNull();
  });

  it("returns null on invalid JSON inside the block", () => {
    expect(parseSkillTagsBlock("```update-skill-tags\n{not json\n```", CATALOG)).toBeNull();
  });

  it("rejects the whole block if a project tag isn't in the live catalog", () => {
    const text = '```update-skill-tags\n{"my-skill": {"projectTags": ["not-a-real-tag"], "agentTypes": []}}\n```';
    expect(parseSkillTagsBlock(text, CATALOG)).toBeNull();
  });

  it("rejects the whole block if an agent type isn't in AGENT_TYPES", () => {
    const text = '```update-skill-tags\n{"my-skill": {"projectTags": [], "agentTypes": ["not-a-real-type"]}}\n```';
    expect(parseSkillTagsBlock(text, CATALOG)).toBeNull();
  });

  it("rejects a row missing either dimension", () => {
    expect(
      parseSkillTagsBlock('```update-skill-tags\n{"my-skill": {"projectTags": ["backend"]}}\n```', CATALOG)
    ).toBeNull();
  });

  it("rejects a non-object payload", () => {
    expect(parseSkillTagsBlock('```update-skill-tags\n["backend"]\n```', CATALOG)).toBeNull();
    expect(parseSkillTagsBlock("```update-skill-tags\n42\n```", CATALOG)).toBeNull();
  });
});

describe("applySkillTagsBlock", () => {
  let dir: string;
  let dbPath: string;
  let skillsDir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-skill-tags-apply-"));
    dbPath = path.join(dir, "tags.sqlite");
    skillsDir = path.join(dir, "skills");
    fs.mkdirSync(path.join(skillsDir, "real-skill"), { recursive: true });
    fs.writeFileSync(path.join(skillsDir, "real-skill", "SKILL.md"), "---\nname: real-skill\n---\nbody");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("writes both dimensions only for a skill id that actually exists under skillsDir", () => {
    const applied = applySkillTagsBlock(
      {
        "real-skill": { projectTags: ["backend"], agentTypes: ["developer"] },
        "made-up-skill": { projectTags: ["backend"], agentTypes: ["developer"] },
      },
      skillsDir,
      dbPath
    );
    expect(applied).toEqual(["real-skill"]);
    expect(readAllSkillTags(dbPath)).toEqual({
      "real-skill": { projectTags: ["backend"], agentTypes: ["developer"] },
    });
  });

  it("ignores a skill id containing a path separator or '..'", () => {
    const applied = applySkillTagsBlock(
      {
        "../escape": { projectTags: ["backend"], agentTypes: [] },
        "a/b": { projectTags: ["backend"], agentTypes: [] },
      },
      skillsDir,
      dbPath
    );
    expect(applied).toEqual([]);
    expect(readAllSkillTags(dbPath)).toEqual({});
  });
});
