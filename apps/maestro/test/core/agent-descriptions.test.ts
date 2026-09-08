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
  describeUneditableSource,
  extractAgentBody,
  findAgentFile,
  getAgentBody,
  isEditableAgentSource,
  normalizeAgentDescription,
  replaceBodyInFrontmatter,
  replaceDescriptionInFrontmatter,
  setAgentContent,
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

describe("extractAgentBody", () => {
  it("is byte-identical to the source file's own content after the frontmatter block", () => {
    const source = `---\nname: scribe\ndescription: Old text.\ntools: Read\n---\n# Scribe Agent\n\nYou are the documentation steward.\n\n- one\n- two\n`;
    const body = extractAgentBody(source);
    // The reader's own contract: whatever follows the closing `---`, unparsed and unmodified.
    expect(source).toBe(source.slice(0, source.length - body.length) + body);
    expect(source.endsWith(body)).toBe(true);
    expect(body).toBe("\n# Scribe Agent\n\nYou are the documentation steward.\n\n- one\n- two\n");
  });

  it("returns the whole file when there is no frontmatter block to carve a body out of", () => {
    expect(extractAgentBody("# Just a heading\n")).toBe("# Just a heading\n");
  });
});

describe("replaceBodyInFrontmatter", () => {
  it("reproduces the source frontmatter block byte-for-byte, changing only the body", () => {
    const frontmatterBlock = '---\nname: scribe\ndescription: "Old text."\ntools: Read\n---';
    const source = `${frontmatterBlock}\n# Scribe Agent\n\nOld body.\n`;
    const out = replaceBodyInFrontmatter(source, "\n# New Agent\n\nNew body.\n");

    expect(out.startsWith(frontmatterBlock)).toBe(true);
    expect(out).toBe(`${frontmatterBlock}\n# New Agent\n\nNew body.\n`);
    expect(extractAgentBody(out)).toBe("\n# New Agent\n\nNew body.\n");
  });

  it("round-trips through extractAgentBody: replacing with the same body reproduces the source exactly", () => {
    const source = `---\nname: scribe\ndescription: Old.\n---\n# Scribe Agent\n\nYou are the documentation steward.\n`;
    const body = extractAgentBody(source);
    expect(replaceBodyInFrontmatter(source, body)).toBe(source);
  });

  it("refuses a file with no frontmatter block to preserve", () => {
    expect(() => replaceBodyInFrontmatter("# Just a heading\n", "new body")).toThrow(/no frontmatter/);
  });
});

describe("getAgentBody", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-body-"));
    fs.mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("reads the project tier's file and returns its body byte-identical to the source", async () => {
    const source = `---\nname: scribe\ndescription: Old.\n---\n# Scribe Agent\n\nYou are the documentation steward.\n`;
    fs.writeFileSync(path.join(root, ".claude", "agents", "scribe.md"), source, "utf8");

    const body = await getAgentBody(root, null, "scribe");

    expect(body).toBe("\n# Scribe Agent\n\nYou are the documentation steward.\n");
    expect(source.endsWith(body)).toBe(true);
  });

  it("resolves across every tier in the same order findAgentFile does — project ahead of bundled", async () => {
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    fs.writeFileSync(
      path.join(bundled, "scribe.md"),
      `---\nname: scribe\ndescription: Bundled.\n---\nBundled body.\n`,
      "utf8"
    );

    // No project-tier scribe: falls through to the bundled ("maestro") tier.
    expect(await getAgentBody(root, bundled, "scribe")).toBe("\nBundled body.\n");

    fs.writeFileSync(
      path.join(root, ".claude", "agents", "scribe.md"),
      `---\nname: scribe\ndescription: Project.\n---\nProject body.\n`,
      "utf8"
    );
    expect(await getAgentBody(root, bundled, "scribe")).toBe("\nProject body.\n");
  });

  it("rejects an agent with no definition file at all", async () => {
    await expect(getAgentBody(root, null, "ghost")).rejects.toThrow(/No definition file/);
  });
});

describe("normalizeAgentDescription", () => {
  it("collapses the newlines a textarea can produce into one line", () => {
    expect(normalizeAgentDescription("  Builds\n  things.\n\n")).toBe("Builds things.");
  });
});

describe("editable sources", () => {
  it("owns only the project tier — user, bundled, and installed plugins are all read-only", () => {
    expect(isEditableAgentSource("project")).toBe(true);
    expect(isEditableAgentSource("user")).toBe(false);
    expect(isEditableAgentSource("maestro")).toBe(false);
    expect(isEditableAgentSource("some-installed-plugin")).toBe(false);
  });
});

describe("describeUneditableSource", () => {
  it("tells the user a user-tier agent is machine-wide, not 'created in some other project'", () => {
    const message = describeUneditableSource("scribe", "user");
    expect(message).toMatch(/~\/.claude\/agents/);
    expect(message).toMatch(/every project on this machine/);
    expect(message).not.toMatch(/created in/i);
  });

  it("tells the user a plugin-tier agent's file is overwritten by the next update", () => {
    const message = describeUneditableSource("scribe", "maestro");
    expect(message).toMatch(/maestro plugin/);
    expect(message).toMatch(/plugin update overwrites/);
  });

  it("names the actual plugin for an installed plugin's agent", () => {
    expect(describeUneditableSource("reviewer", "some-installed-plugin")).toMatch(/some-installed-plugin plugin/);
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

  it("refuses to edit a bundled-tier agent — the throw names the plugin, and the file is untouched", async () => {
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    fs.writeFileSync(path.join(bundled, "scribe.md"), file("name: scribe\ndescription: Bundled."), "utf8");

    // No project-tier scribe here, so findAgentFile resolves the bundled ("maestro") tier — the
    // same refusal path a `user`-tier agent takes, exercised through a source this module can
    // reach without touching the real machine's ~/.claude.
    await expect(setAgentDescription(root, bundled, "scribe", "New.")).rejects.toThrow(
      describeUneditableSource("scribe", "maestro")
    );
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

describe("setAgentContent", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-agent-content-"));
    fs.mkdirSync(path.join(root, ".claude", "agents"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const agentPath = () => path.join(root, ".claude", "agents", "scribe.md");

  it("writes the project tier's file, preserving the frontmatter block byte-for-byte", async () => {
    const frontmatterBlock = '---\nname: scribe\ndescription: "Old text."\ntools: Read\n---';
    fs.writeFileSync(agentPath(), `${frontmatterBlock}\n${BODY}`, "utf8");

    const result = await setAgentContent(root, null, "scribe", "\n# New body\n\nRewritten.\n");

    expect(result).toEqual({ file: agentPath(), source: "project" });
    const written = fs.readFileSync(agentPath(), "utf8");
    expect(written.startsWith(frontmatterBlock)).toBe(true);
    expect(written).toBe(`${frontmatterBlock}\n# New body\n\nRewritten.\n`);
  });

  it("writing the same body back reproduces the source exactly — idempotent, byte for byte", async () => {
    const source = file("name: scribe\ndescription: Old.");
    fs.writeFileSync(agentPath(), source, "utf8");

    await setAgentContent(root, null, "scribe", extractAgentBody(source));

    expect(fs.readFileSync(agentPath(), "utf8")).toBe(source);
  });

  it("refuses to edit a bundled-tier agent's content — the throw names the plugin, and the file is untouched", async () => {
    const bundled = path.join(root, "bundled");
    fs.mkdirSync(bundled);
    fs.writeFileSync(path.join(bundled, "scribe.md"), file("name: scribe\ndescription: Bundled."), "utf8");

    await expect(setAgentContent(root, bundled, "scribe", "New body.")).rejects.toThrow(
      describeUneditableSource("scribe", "maestro")
    );
    expect(fs.readFileSync(path.join(bundled, "scribe.md"), "utf8")).toContain(BODY);
  });

  it("rejects an agent with no definition file at all", async () => {
    await expect(setAgentContent(root, null, "ghost", "Hello.")).rejects.toThrow(/No definition file/);
  });
});
