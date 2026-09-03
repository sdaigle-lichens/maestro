// The /agents card's Description field writes back into the agent's own `.md`, which makes this
// the one place the app edits a definition file in place. What is worth pinning is not that it can
// write — it is that it writes the ONE line it was asked to and refuses the shapes it would
// corrupt: a body below the block must come back byte-identical, and a description this reader
// can't round-trip must throw rather than be flattened.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  findAgentFile,
  isEditableAgentSource,
  normalizeAgentDescription,
  replaceDescriptionInFrontmatter,
  setAgentDescription,
} from "../../src/core/agent-descriptions.js";

const BODY = "\n# Scribe Agent\n\nYou are the documentation steward.\n\n- one\n- two\n";

function file(frontmatter: string): string {
  return `---\n${frontmatter}\n---\n${BODY}`;
}

describe("replaceDescriptionInFrontmatter", () => {
  it("rewrites only the description line and leaves the body untouched", () => {
    const out = replaceDescriptionInFrontmatter(file("name: scribe\ndescription: Old text.\ntools: Read"), "New text.");
    expect(out).toBe(file('name: scribe\ndescription: "New text."\ntools: Read'));
    expect(out.endsWith(BODY)).toBe(true);
  });

  it("replaces a quoted description without doubling its quotes", () => {
    const out = replaceDescriptionInFrontmatter(file('name: scribe\ndescription: "Old text."'), "New text.");
    expect(out).toContain('description: "New text."');
    expect(out).not.toContain('""');
  });

  it("escapes quotes and backslashes so the value stays one scalar", () => {
    const out = replaceDescriptionInFrontmatter(file("name: a\ndescription: x"), 'Say "hi" \\ bye');
    expect(out).toContain('description: "Say \\"hi\\" \\\\ bye"');
  });

  it("inserts a description directly after name when the file has none", () => {
    const out = replaceDescriptionInFrontmatter(file("name: scribe\ntools: Read"), "Fresh.");
    expect(out).toBe(file('name: scribe\ndescription: "Fresh."\ntools: Read'));
  });

  it("refuses a block scalar rather than flattening it", () => {
    expect(() => replaceDescriptionInFrontmatter(file("name: a\ndescription: |\n  a long one"), "x")).toThrow(
      /block scalar/
    );
  });

  it("refuses a description continued on the next line", () => {
    expect(() => replaceDescriptionInFrontmatter(file("name: a\ndescription:\n  a long one"), "x")).toThrow(
      /several lines/
    );
  });

  it("refuses a file with no frontmatter at all", () => {
    expect(() => replaceDescriptionInFrontmatter("# Just a heading\n", "x")).toThrow(/no frontmatter/);
  });
});

describe("normalizeAgentDescription", () => {
  it("collapses the newlines a textarea can produce into one line", () => {
    expect(normalizeAgentDescription("  Builds\n  things.\n\n")).toBe("Builds things.");
  });
});

describe("editable sources", () => {
  it("owns the project, user and bundled tiers and disowns an installed plugin's", () => {
    expect(isEditableAgentSource("project")).toBe(true);
    expect(isEditableAgentSource("user")).toBe(true);
    expect(isEditableAgentSource("maestro")).toBe(true);
    expect(isEditableAgentSource("some-installed-plugin")).toBe(false);
  });
});

describe("setAgentDescription", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-desc-"));
    fs.mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const agentPath = () => path.join(root, ".claude", "agents", "scribe.md");

  it("writes the project tier's file and echoes back what it changed", async () => {
    fs.writeFileSync(agentPath(), file("name: scribe\ndescription: Old."), "utf8");

    const result = await setAgentDescription(root, null, "scribe", "  New\ndescription.  ");

    expect(result).toEqual({ description: "New description.", file: agentPath(), source: "project" });
    expect(fs.readFileSync(agentPath(), "utf8")).toBe(file('name: scribe\ndescription: "New description."'));
  });

  it("resolves the project tier ahead of the bundled one, as discoverAgents does", async () => {
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    fs.writeFileSync(path.join(bundled, "scribe.md"), file("name: scribe\ndescription: Bundled."), "utf8");
    fs.writeFileSync(agentPath(), file("name: scribe\ndescription: Project."), "utf8");

    const found = await findAgentFile(root, bundled, "scribe");
    expect(found).toMatchObject({ source: "project", file: agentPath() });

    await setAgentDescription(root, bundled, "scribe", "Edited.");
    expect(fs.readFileSync(path.join(bundled, "scribe.md"), "utf8")).toContain("description: Bundled.");
  });

  it("finds an agent stored as <name>/AGENTS.md, the plugin layout", async () => {
    const dir = path.join(root, ".claude", "agents", "nested");
    fs.mkdirSync(dir);
    fs.writeFileSync(path.join(dir, "AGENTS.md"), file("name: nested-agent\ndescription: Old."), "utf8");

    const found = await findAgentFile(root, null, "nested-agent");
    expect(found?.file).toBe(path.join(dir, "AGENTS.md"));
  });

  it("rejects an empty description instead of writing a blank line", async () => {
    fs.writeFileSync(agentPath(), file("name: scribe\ndescription: Old."), "utf8");
    await expect(setAgentDescription(root, null, "scribe", "   ")).rejects.toThrow(/can't be empty/);
    expect(fs.readFileSync(agentPath(), "utf8")).toContain("description: Old.");
  });

  it("rejects an agent with no definition file at all", async () => {
    await expect(setAgentDescription(root, null, "ghost", "Hello.")).rejects.toThrow(/No definition file/);
  });
});
