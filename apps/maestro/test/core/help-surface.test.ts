// The read-only surface folded in from help-server: the docs reader's node side, the rule
// library, the command table, and the project marketplace.
//
// Why these and not the rest: what a port of this shape actually loses is the parsing. Types
// cannot see that `docSections` stopped splitting at headings, that a slug guard was relaxed, or
// that the command-table regex now matches the separator row — every one of those still compiles,
// still returns an array, and shows up as a docs search that silently finds nothing.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { docSections, listDocs, readDoc, isValidDocSlug, slugifyHeading } from "../../src/core/docs.js";
import { readClaudeCommands } from "../../src/core/commands.js";
import { discoverRuleLibrary } from "../../src/core/discovery.js";
import { readProjectMarketplace } from "../../src/core/plugins.js";

let project: string;

function write(rel: string, content: string): void {
  const full = path.join(project, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
}

beforeEach(() => {
  project = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-help-surface-"));
});

afterEach(() => {
  fs.rmSync(project, { recursive: true, force: true });
});

describe("docs", () => {
  const GUIDE = [
    "# The Guide",
    "",
    "Intro paragraph.",
    "",
    "## Installing",
    "",
    "Run the installer.",
    "",
    "### Troubleshooting Sandbox Errors",
    "",
    "Fix the setuid bit.",
    "",
  ].join("\n");

  it("lists docs by title, not by filename", () => {
    write("docs/zeta.md", "# Alpha Topic\n");
    write("docs/alpha.md", "# Zeta Topic\n");
    // Sorted on the rendered title, so the list reads the way the reader sees it.
    expect(listDocs(project).map((d) => d.title)).toEqual(["Alpha Topic", "Zeta Topic"]);
    expect(listDocs(project).map((d) => d.slug)).toEqual(["zeta", "alpha"]);
  });

  it("falls back to the slug when a doc has no heading", () => {
    write("docs/no-title.md", "just a paragraph\n");
    expect(listDocs(project)).toEqual([{ slug: "no-title", title: "no-title" }]);
  });

  it("returns nothing for a project with no docs directory", () => {
    expect(listDocs(project)).toEqual([]);
    expect(docSections(project)).toEqual([]);
    expect(readClaudeCommands(project)).toEqual([]);
  });

  it("splits a doc into one section per heading", () => {
    write("docs/guide.md", GUIDE);
    const sections = docSections(project);

    // THE UNIT IS THE HEADING. A port that indexed whole files would return one section here and
    // every search hit would land the reader at the top of the page instead of at the paragraph.
    expect(sections.map((s) => s.headingText)).toEqual(["The Guide", "Installing", "Troubleshooting Sandbox Errors"]);
    expect(sections.every((s) => s.slug === "guide" && s.docTitle === "The Guide")).toBe(true);
    expect(sections[1].bodyText).toBe("Run the installer.");
  });

  it("gives each section the heading id the reader anchors on", () => {
    write("docs/guide.md", GUIDE);
    const [, , deep] = docSections(project);
    expect(deep.headingId).toBe("troubleshooting-sandbox-errors");
    // The reader re-derives the same id from the rendered heading text; if these two ever
    // disagree, every search hit scrolls nowhere and nothing else notices.
    expect(slugifyHeading("Troubleshooting Sandbox Errors")).toBe(deep.headingId);
  });

  it("indexes the intro under the doc's own title heading", () => {
    write("docs/guide.md", GUIDE);
    // Text before the first SUB-heading belongs to the `# Title` section — it is usually the
    // summary, and the reader must be able to be scrolled to it like any other section.
    expect(docSections(project)[0]).toMatchObject({
      headingId: "the-guide",
      headingText: "The Guide",
      bodyText: "Intro paragraph.",
    });
  });

  it("keeps a heading with no prose under it, so the heading itself stays findable", () => {
    write("docs/empty.md", "# Title\n\n## Nothing Under Here\n\n## Something\n\nbody\n");
    const sections = docSections(project);
    expect(sections.map((s) => s.headingText)).toEqual(["Title", "Nothing Under Here", "Something"]);
    expect(sections[1].bodyText).toBe("");
  });

  it("indexes text that appears before any heading at all", () => {
    write("docs/preamble.md", "loose opening line\n\n# Later Heading\n\nbody\n");
    // The only case where a section carries no heading id: there is no heading above it to
    // anchor to, so it is filed under the DOC's title (which `# Later Heading` supplies, wherever
    // in the file it sits) with an empty id, and the reader lands at the top of the page.
    expect(docSections(project)[0]).toMatchObject({
      headingId: "",
      headingText: "Later Heading",
      bodyText: "loose opening line",
    });
  });

  it("reads one doc, title and all", () => {
    write("docs/guide.md", GUIDE);
    expect(readDoc(project, "guide")).toEqual({ slug: "guide", title: "The Guide", content: GUIDE });
  });

  it("refuses any slug that could name a file outside docs/", () => {
    write("docs/guide.md", GUIDE);
    write("secret.md", "# Secret\n");

    for (const slug of ["../secret", "..", "guide.md", "sub/guide", "a\\b", ""]) {
      expect(isValidDocSlug(slug), `accepted ${JSON.stringify(slug)}`).toBe(false);
      expect(() => readDoc(project, slug)).toThrow(/Invalid document name|Could not read/);
    }
  });

  it("throws — rather than returning an empty page — for a doc that is not there", () => {
    expect(() => readDoc(project, "missing")).toThrow(/Could not read docs\/missing\.md/);
  });
});

describe("the CLI command table", () => {
  it("parses the rows of the markdown table and skips its separator", () => {
    write(
      "docs/claude-code.md",
      [
        "# Claude Code",
        "",
        "| Command | Description |",
        "| --- | --- |",
        "| `claude` | Start an interactive session |",
        "| `claude -p` | Run headless |",
        "",
        "Some prose with `inline code` that is not a table row.",
      ].join("\n")
    );

    expect(readClaudeCommands(project)).toEqual([
      { command: "claude", description: "Start an interactive session" },
      { command: "claude -p", description: "Run headless" },
    ]);
  });
});

describe("the rule library", () => {
  it("reads rules/*.md with their frontmatter and heading", () => {
    write(
      "rules/style.md",
      ["---", "description: How code should read", 'paths: ["src/**", "test/**"]', "---", "", "# House Style", ""].join(
        "\n"
      )
    );
    write("rules/loose.md", "# No Frontmatter\n");

    expect(discoverRuleLibrary(project)).toEqual([
      { filename: "loose.md", title: "No Frontmatter", paths: [], description: "" },
      {
        filename: "style.md",
        title: "House Style",
        paths: ["src/**", "test/**"],
        description: "How code should read",
      },
    ]);
  });

  it("is NOT the same set as the assignable project rules", () => {
    // The one design question the merge plan called out. `rules/` is what the project publishes;
    // `.claude/rules/` is what a save has assigned to a directory. A reader who assumed one
    // function answered both would have the dashboard claiming /rules manages files it does not.
    write("rules/published.md", "# Published\n");
    write(".claude/rules/assigned.md", "---\nname: assigned\n---\n\nbody\n");

    expect(discoverRuleLibrary(project).map((r) => r.filename)).toEqual(["published.md"]);
  });

  it("is empty for a project with no rules directory", () => {
    expect(discoverRuleLibrary(project)).toEqual([]);
  });
});

describe("the project marketplace", () => {
  it("reads the project's own manifest and the plugins beside it", async () => {
    write(
      ".claude-plugin/marketplace.json",
      JSON.stringify({
        name: "example-marketplace",
        plugins: [{ name: "tools", description: "From the manifest", source: "./plugins/tools" }],
      })
    );
    write("plugins/tools/.claude-plugin/plugin.json", JSON.stringify({ name: "tools", version: "1.2.3" }));
    write("plugins/tools/skills/do-thing/SKILL.md", "---\nname: do-thing\ndescription: Does the thing\n---\n");
    write("plugins/tools/agents/helper.md", "---\nname: helper\ndescription: Helps\n---\n");

    const [plugin] = await readProjectMarketplace(project);
    expect(plugin).toMatchObject({
      name: "tools",
      description: "From the manifest",
      version: "1.2.3",
      installCommand: "claude plugin install tools@example-marketplace",
    });
    expect(plugin.skills).toEqual([{ name: "do-thing", description: "Does the thing" }]);
    expect(plugin.agents).toEqual([{ name: "helper", description: "Helps" }]);
  });

  it("is empty — not an error — for a project that publishes nothing", async () => {
    // Most projects. The Docker app could assume it was mounted on THIS repo; the desktop app is
    // pointed at whatever the user opened.
    await expect(readProjectMarketplace(project)).resolves.toEqual([]);
    await expect(readProjectMarketplace("")).resolves.toEqual([]);
  });
});
