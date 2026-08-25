// Skill tags: the global (per skill id, not per project) SQLite store, and the pure tags→SkillMap
// lookup both seed paths and /maestro-install's terminal path converge on.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  readAllSkillTags,
  setSkillTags,
  skillMapFromTags,
  parseSkillTagsBlock,
  applySkillTagsBlock,
} from "../../src/core/skill-tags.js";

describe("readAllSkillTags / setSkillTags", () => {
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

  it("round-trips a skill's tags", () => {
    setSkillTags("react", ["frontend"], dbPath);
    expect(readAllSkillTags(dbPath)).toEqual({ react: ["frontend"] });
  });

  it("dedupes and sorts what it stores", () => {
    const stored = setSkillTags("db-migrations", ["test", "backend", "backend"], dbPath);
    expect(stored).toEqual(["backend", "test"]);
    expect(readAllSkillTags(dbPath)).toEqual({ "db-migrations": ["backend", "test"] });
  });

  it("replace-all: a second call drops tags the first one set", () => {
    setSkillTags("react", ["frontend", "test"], dbPath);
    setSkillTags("react", ["frontend"], dbPath);
    expect(readAllSkillTags(dbPath)).toEqual({ react: ["frontend"] });
  });

  it("clears a skill's tags entirely when set to an empty list", () => {
    setSkillTags("react", ["frontend"], dbPath);
    setSkillTags("react", [], dbPath);
    expect(readAllSkillTags(dbPath)).toEqual({});
  });

  it("keeps other skills' tags untouched", () => {
    setSkillTags("react", ["frontend"], dbPath);
    setSkillTags("changelog", ["scribe"], dbPath);
    expect(readAllSkillTags(dbPath)).toEqual({ react: ["frontend"], changelog: ["scribe"] });
  });
});

describe("skillMapFromTags", () => {
  it("routes a skill to every tag that matches a seeded agent", () => {
    const map = skillMapFromTags({ "db-migrations": ["backend", "test"] }, ["db-migrations"], ["backend", "test", "reviewer"]);
    expect(map).toEqual({ backend: ["db-migrations"], test: ["db-migrations"] });
  });

  it("drops a tag that isn't one of this seed's agents", () => {
    // Tagged `mobile` on a backend-only repo: not a route anywhere in this seed.
    const map = skillMapFromTags({ "native-nav": ["mobile"] }, ["native-nav"], ["backend", "test", "reviewer", "refactor", "scribe"]);
    expect(map).toEqual({});
  });

  it("drops a skill id that no longer exists in this project's discovered set", () => {
    // A stale tag (renamed/removed skill), or a same-named skill tagged in an unrelated project —
    // the global store's one real trade-off, guarded against by intersecting with `skillIds`.
    const map = skillMapFromTags({ ghost: ["backend"] }, ["real-skill"], ["backend"]);
    expect(map).toEqual({});
  });

  it("unions several skills onto the same agent", () => {
    const map = skillMapFromTags(
      { react: ["frontend"], styling: ["frontend"] },
      ["react", "styling"],
      ["frontend", "test"]
    );
    expect(map.frontend?.sort()).toEqual(["react", "styling"]);
  });

  it("is empty over an empty tags store", () => {
    expect(skillMapFromTags({}, ["react"], ["frontend"])).toEqual({});
  });
});

describe("parseSkillTagsBlock", () => {
  it("parses a well-formed block", () => {
    const text = 'Done. \n```update-skill-tags\n{"my-skill": ["backend", "test"], "other": []}\n```\n';
    expect(parseSkillTagsBlock(text)).toEqual({ "my-skill": ["backend", "test"], other: [] });
  });

  it("returns null when there is no block", () => {
    expect(parseSkillTagsBlock("Just some prose, no fenced block here.")).toBeNull();
  });

  it("returns null on invalid JSON inside the block", () => {
    expect(parseSkillTagsBlock("```update-skill-tags\n{not json\n```")).toBeNull();
  });

  it("rejects the whole block if any tag isn't in SKILL_TAGS", () => {
    const text = '```update-skill-tags\n{"my-skill": ["backend", "not-a-real-tag"]}\n```';
    expect(parseSkillTagsBlock(text)).toBeNull();
  });

  it("rejects a non-object payload", () => {
    expect(parseSkillTagsBlock('```update-skill-tags\n["backend"]\n```')).toBeNull();
    expect(parseSkillTagsBlock("```update-skill-tags\n42\n```")).toBeNull();
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

  it("writes tags only for a skill id that actually exists under skillsDir", () => {
    const applied = applySkillTagsBlock({ "real-skill": ["backend"], "made-up-skill": ["test"] }, skillsDir, dbPath);
    expect(applied).toEqual(["real-skill"]);
    expect(readAllSkillTags(dbPath)).toEqual({ "real-skill": ["backend"] });
  });

  it("ignores a skill id containing a path separator or '..'", () => {
    const applied = applySkillTagsBlock({ "../escape": ["backend"], "a/b": ["backend"] }, skillsDir, dbPath);
    expect(applied).toEqual([]);
    expect(readAllSkillTags(dbPath)).toEqual({});
  });
});
