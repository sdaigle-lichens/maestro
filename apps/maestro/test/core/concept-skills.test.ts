// Tests for the concept-skill index — the deterministic half of the three concept-skill flows.
//
// Two properties carry the whole feature and neither is visible from a passing type-check:
//
//   1. DISCOVERY REACHES THE WHOLE TREE. A concept skill lives beside the code it explains, so in
//      a monorepo most of them are under `apps/*/.claude/skills`, not the root's. `discoverSkills`
//      reads exactly one directory and is blind to them; this must not be. A fixture with a nested
//      skill is the only thing that can tell the two apart.
//
//   2. STAMPING IS A LINE REWRITE. The body of a concept skill is the entire point of the file and
//      its description is a long quoted sentence. If a stamp ever round-trips either through a
//      YAML emitter, the damage is silent and cumulative — every update churns the diff and
//      eventually loses something. So the assertion is byte equality of everything else, not
//      "the version came out right".
//
// The version arithmetic is here because a version stuck at 1.0 makes /update-single-concept-skill
// deeply research a concept that was already researched, and nothing anywhere reports that.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  bumpMajor,
  bumpMinor,
  discoverConceptSkills,
  findConceptSkill,
  parseVersion,
  resolveSkillPath,
  conceptSkillsJsonPath,
  readAgentsAvailable,
  readConceptSkillsState,
  stampConceptSkill,
  writeConceptSkillsState,
} from "../../src/core/concept-skills.js";
import { parseFrontmatter, parseFrontmatterMetadata } from "@repo/claude-fs";
import { maestroJsonPath, writeConfig } from "../../src/core/config.js";
import { defaultish } from "./fixtures/configs.js";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-concepts-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writeSkill(relDir: string, frontmatter: string, body = "# Body\n\nProse.\n"): string {
  const dir = path.join(tmp, relDir);
  fs.mkdirSync(dir, { recursive: true });
  const p = path.join(dir, "SKILL.md");
  fs.writeFileSync(p, `---\n${frontmatter}\n---\n\n${body}`);
  return p;
}

const CONCEPT = [
  "name: auth-flow",
  'description: "How auth works."',
  "metadata:",
  "  type: concept-skill",
  '  version: "1.3"',
  "  last-update: abc123",
].join("\n");

// `packages/claude-fs` has no test setup of its own and this is its only consumer, so the reader
// that makes the whole marker scheme safe is pinned here.
describe("parseFrontmatterMetadata", () => {
  const fm = (...lines: string[]) => ["---", ...lines, "---", "", "# Body"].join("\n");

  it("reads a block map", () => {
    const src = fm("name: x", "metadata:", "  type: concept-skill", '  version: "1.0"');
    expect(parseFrontmatterMetadata(src)).toEqual({ type: "concept-skill", version: "1.0" });
  });

  it("reads an inline flow map", () => {
    const src = fm("name: x", "metadata: { type: concept-skill, version: 1.0 }");
    expect(parseFrontmatterMetadata(src)).toEqual({ type: "concept-skill", version: "1.0" });
  });

  it("stops at the first dedented key rather than swallowing the rest", () => {
    const src = fm("metadata:", "  type: concept-skill", "description: not-metadata");
    expect(parseFrontmatterMetadata(src)).toEqual({ type: "concept-skill" });
  });

  it("is empty when there is no metadata, or when it isn't a map", () => {
    expect(parseFrontmatterMetadata(fm("name: x"))).toEqual({});
    expect(parseFrontmatterMetadata(fm("metadata: just-a-string"))).toEqual({});
    expect(parseFrontmatterMetadata("# no frontmatter")).toEqual({});
  });

  // The reason `discoverConceptSkills` must not read the marker off `parseFrontmatter`: that
  // reader flattens, so it produces the right values by accident and cannot tell a nested
  // `metadata.version` from a top-level `version`.
  it("differs from parseFrontmatter, which flattens the block", () => {
    const src = fm("name: x", "metadata:", "  type: concept-skill");
    expect(parseFrontmatter(src)).toEqual({ name: "x", metadata: "", type: "concept-skill" });
    expect(parseFrontmatterMetadata(src)).toEqual({ type: "concept-skill" });
  });
});

describe("version arithmetic", () => {
  it("bumps minor and major independently", () => {
    expect(bumpMinor("1.3")).toBe("1.4");
    expect(bumpMajor("1.3")).toBe("2.0");
    expect(bumpMajor("2.9")).toBe("3.0");
  });

  // A hand-edited or missing version must never stop a scan of the whole repo, so it reads as
  // 1.0 rather than throwing — the same value a never-deeply-researched skill carries.
  it("reads a malformed or missing version as 1.0", () => {
    expect(parseVersion(undefined)).toEqual({ major: 1, minor: 0 });
    expect(parseVersion("")).toEqual({ major: 1, minor: 0 });
    expect(parseVersion("v2")).toEqual({ major: 1, minor: 0 });
    expect(bumpMinor("nonsense")).toBe("1.1");
  });
});

describe("discoverConceptSkills", () => {
  it("finds a skill in a NESTED .claude, not just the root's", async () => {
    writeSkill("apps/web/.claude/skills/auth-flow", CONCEPT);
    const found = await discoverConceptSkills(tmp);
    expect(found.map((s) => s.id)).toEqual(["auth-flow"]);
    expect(found[0].version).toBe("1.3");
    expect(found[0].lastUpdate).toBe("abc123");
  });

  it("ignores a skill with no concept-skill marker", async () => {
    writeSkill(".claude/skills/plain", 'name: plain\ndescription: "Ordinary."');
    writeSkill(".claude/skills/other", 'name: other\ndescription: "x."\nmetadata:\n  type: something-else');
    writeSkill("apps/web/.claude/skills/auth-flow", CONCEPT);
    const found = await discoverConceptSkills(tmp);
    expect(found.map((s) => s.id)).toEqual(["auth-flow"]);
  });

  it("counts the sub-concept and agent-note files", async () => {
    writeSkill("apps/web/.claude/skills/auth-flow", CONCEPT);
    const dir = path.join(tmp, "apps/web/.claude/skills/auth-flow");
    fs.mkdirSync(path.join(dir, "sub-concepts"));
    fs.writeFileSync(path.join(dir, "sub-concepts", "tokens.md"), "x");
    fs.writeFileSync(path.join(dir, "sub-concepts", "sessions.md"), "x");
    fs.mkdirSync(path.join(dir, "agents"));
    fs.writeFileSync(path.join(dir, "agents", "backend.md"), "x");

    const [skill] = await discoverConceptSkills(tmp);
    expect(skill.subConcepts).toEqual(["sessions.md", "tokens.md"]);
    expect(skill.agentNotes).toEqual(["backend.md"]);
  });

  it("finds a skill by id or by directory", async () => {
    writeSkill("apps/web/.claude/skills/auth-flow", CONCEPT);
    expect((await findConceptSkill(tmp, "auth-flow"))?.id).toBe("auth-flow");
    expect((await findConceptSkill(tmp, "apps/web/.claude/skills/auth-flow"))?.id).toBe("auth-flow");
    expect(await findConceptSkill(tmp, "nope")).toBeNull();
  });
});

// The create flow's commonest call is "stamp the skill I wrote thirty seconds ago", which is not a
// concept skill YET — so `findConceptSkill` cannot see it. Resolving the id as a relative path
// instead is the obvious shortcut and produces `<root>/<id>`, a file that was never going to exist.
describe("resolveSkillPath", () => {
  it("finds an UNMARKED skill by id, anywhere in the tree", async () => {
    const p = writeSkill("apps/api/.claude/skills/job-queue", 'name: job-queue\ndescription: "Queue."');
    expect(await resolveSkillPath(tmp, "job-queue")).toBe(p);
  });

  it("finds a skill whose frontmatter name differs from its directory", async () => {
    const p = writeSkill("apps/api/.claude/skills/queue-dir", 'name: job-queue\ndescription: "Queue."');
    expect(await resolveSkillPath(tmp, "job-queue")).toBe(p);
    expect(await resolveSkillPath(tmp, "queue-dir")).toBe(p);
  });

  it("accepts a directory or a file path too", async () => {
    const p = writeSkill("apps/api/.claude/skills/job-queue", 'name: job-queue\ndescription: "Queue."');
    expect(await resolveSkillPath(tmp, "apps/api/.claude/skills/job-queue")).toBe(p);
    expect(await resolveSkillPath(tmp, "apps/api/.claude/skills/job-queue/SKILL.md")).toBe(p);
  });

  it("returns null rather than a path that was never going to exist", async () => {
    expect(await resolveSkillPath(tmp, "nope")).toBeNull();
  });
});

describe("stampConceptSkill", () => {
  it("changes ONLY the version and last-update lines", () => {
    const p = writeSkill("apps/web/.claude/skills/auth-flow", CONCEPT);
    const before = fs.readFileSync(p, "utf8");

    stampConceptSkill(p, { version: "2.0", lastUpdate: "deadbeef" });

    const after = fs.readFileSync(p, "utf8");
    const changed = after.split("\n").filter((line, i) => line !== before.split("\n")[i]);
    expect(changed).toEqual(['  version: "2.0"', "  last-update: deadbeef"]);
  });

  it("leaves the body byte-identical, including a description with a colon in it", () => {
    const p = writeSkill(
      "apps/web/.claude/skills/auth-flow",
      [
        "name: auth-flow",
        'description: "How auth works: tokens, sessions, and the bit that bites."',
        "metadata:",
        "  type: concept-skill",
        '  version: "1.0"',
        "  last-update: abc123",
      ].join("\n"),
      "# Auth Flow\n\n```ts\nconst x: number = 1;\n```\n\nTrailing prose.\n"
    );
    const bodyOf = (s: string) => s.slice(s.indexOf("\n---", 4));
    const before = bodyOf(fs.readFileSync(p, "utf8"));

    stampConceptSkill(p, { version: "1.1", lastUpdate: "cafe01" });

    const after = fs.readFileSync(p, "utf8");
    expect(bodyOf(after)).toBe(before);
    expect(after).toContain('description: "How auth works: tokens, sessions, and the bit that bites."');
  });

  // The create flow's normal case: the skill it just wrote carries no marker yet.
  it("creates the metadata block on a skill that has none", async () => {
    const p = writeSkill(".claude/skills/plain", 'name: plain\ndescription: "Ordinary."');
    stampConceptSkill(p, { version: "1.0", lastUpdate: "cafe01" });
    expect(fs.readFileSync(p, "utf8")).toContain('description: "Ordinary."');
    const [found] = await discoverConceptSkills(tmp);
    expect(found.id).toBe("plain");
    expect(found.version).toBe("1.0");
    expect(found.lastUpdate).toBe("cafe01");
  });

  // The map is the USER's, not this feature's — it is shared with whatever else their tooling
  // keeps there, and a stamp that quietly dropped a sibling key would be very hard to notice.
  it("keeps metadata keys that are not ours, and the block's own indentation", async () => {
    const p = writeSkill(
      ".claude/skills/plain",
      ["name: plain", 'description: "x"', "metadata:", "    owner: platform-team", "    type: concept-skill"].join("\n")
    );
    stampConceptSkill(p, { version: "2.0", lastUpdate: "cafe01" });
    const after = fs.readFileSync(p, "utf8");
    expect(after).toContain("    owner: platform-team");
    expect(after).toContain('    version: "2.0"');
    expect((await discoverConceptSkills(tmp))[0].version).toBe("2.0");
  });

  it("converts an inline metadata map to a block, carrying its keys over", async () => {
    const p = writeSkill(
      ".claude/skills/plain",
      ["name: plain", 'description: "x"', "metadata: { owner: platform-team }"].join("\n")
    );
    stampConceptSkill(p, { version: "1.0", lastUpdate: "cafe01" });
    expect(fs.readFileSync(p, "utf8")).toContain("  owner: platform-team");
    expect((await discoverConceptSkills(tmp))[0].version).toBe("1.0");
  });

  // Stamping twice must not append a second copy of any key.
  it("is idempotent", async () => {
    const p = writeSkill(".claude/skills/plain", 'name: plain\ndescription: "x"');
    stampConceptSkill(p, { version: "1.0", lastUpdate: "a" });
    stampConceptSkill(p, { version: "1.1", lastUpdate: "b" });
    const after = fs.readFileSync(p, "utf8");
    expect(after.match(/type: concept-skill/g)).toHaveLength(1);
    expect(after.match(/last-update:/g)).toHaveLength(1);
    expect((await discoverConceptSkills(tmp))[0].version).toBe("1.1");
  });

  it("refuses a file with no frontmatter rather than prepending one", () => {
    const dir = path.join(tmp, ".claude/skills/broken");
    fs.mkdirSync(dir, { recursive: true });
    const p = path.join(dir, "SKILL.md");
    fs.writeFileSync(p, "# No frontmatter here\n");
    expect(() => stampConceptSkill(p, { version: "1.0", lastUpdate: "x" })).toThrow(/no frontmatter/);
  });
});

// The list /update-single-concept-skill writes agent notes for. It used to be read by an inline
// `node -e` in the SKILL.md whose only source for the project root was CLAUDE_PROJECT_DIR with no
// fallback — unset, it read `undefined/.claude/…`, caught its own error and reported no agents, so
// the step silently wrote nothing. An empty answer has to mean "this project has no agents", never
// "the root wasn't resolved".
describe("readAgentsAvailable", () => {
  it("reads agents_available from maestro.json", () => {
    writeConfig(tmp, { ...structuredClone(defaultish), agents_available: ["backend", "test"] });
    expect(readAgentsAvailable(tmp)).toEqual(["backend", "test"]);
  });

  it("is empty with no maestro.json — which means 'write no agent notes'", () => {
    expect(readAgentsAvailable(tmp)).toEqual([]);
  });
});

describe("the concept-skills state file", () => {
  // It is its OWN file, not a block on maestro.json: a repo can keep a reconciled concept-skill
  // list with Maestro nowhere in sight, and hanging the state off Maestro's config meant exactly
  // those repos recorded nothing.
  it("writes .claude/concept-skills.json with no maestro.json present", () => {
    expect(readConceptSkillsState(tmp)).toBeNull();
    expect(writeConceptSkillsState(tmp, { version: "1.0", last_update: "abc123" })).toBe(true);

    expect(fs.existsSync(path.join(tmp, ".claude", "maestro.json"))).toBe(false);
    expect(readConceptSkillsState(tmp)).toEqual({ version: "1.0", last_update: "abc123" });
  });

  it("creates .claude/ when the project has none", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "concept-bare-"));
    try {
      expect(writeConceptSkillsState(bare, { version: "1.0", last_update: "abc" })).toBe(true);
      expect(readConceptSkillsState(bare)).toEqual({ version: "1.0", last_update: "abc" });
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it("leaves maestro.json untouched", () => {
    writeConfig(tmp, structuredClone(defaultish));
    const before = fs.readFileSync(maestroJsonPath(tmp), "utf8");

    writeConceptSkillsState(tmp, { version: "1.0", last_update: "abc123" });

    expect(fs.readFileSync(maestroJsonPath(tmp), "utf8")).toBe(before);
  });

  it("writes nothing when the value is already what it would write", () => {
    writeConceptSkillsState(tmp, { version: "1.0", last_update: "abc123" });
    expect(writeConceptSkillsState(tmp, { version: "1.0", last_update: "abc123" })).toBe(false);
  });

  it("reads a malformed or half-written file as 'no list recorded'", () => {
    fs.mkdirSync(path.join(tmp, ".claude"), { recursive: true });
    const p = conceptSkillsJsonPath(tmp);

    fs.writeFileSync(p, "{ not json");
    expect(readConceptSkillsState(tmp)).toBeNull();

    fs.writeFileSync(p, JSON.stringify({ version: "1.0" }));
    expect(readConceptSkillsState(tmp)).toBeNull();
  });
});
