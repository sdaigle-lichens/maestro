// `152` item 2: `tasks.ts` (the app) and `plugins/maestro/scripts/lib/maestro-tasks.cjs` (the
// hand-kept twin the orchestrator runs) both cut the `## ` section with the same `sectionOf` and
// parse `## Blocked by` through it. The two must agree on every input, or a close from the UI and
// one from the orchestrator disagree about which tasks are ready. These cases are the shapes a
// real task file takes, plus the ones a naive cut gets wrong.

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import { parseBlockedBy, extractPostMortemSection } from "../../src/core/tasks.js";
import { findUpPluginRoot } from "../../src/core/install.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const TWIN = path.join(findUpPluginRoot(here)!, "scripts", "lib", "maestro-tasks.cjs");
const twin = createRequire(import.meta.url)(TWIN) as { parseBlockedBy: (c: string) => string[] };

const CASES: Array<{ name: string; content: string; expected: string[] }> = [
  {
    name: "no Blocked by section",
    content: "# Title\n\n## What to build\n\nx `002-other.md`\n",
    expected: [],
  },
  {
    name: "None",
    content: "# T\n\n## Blocked by\n\nNone\n",
    expected: [],
  },
  {
    name: "one blocker, last section in the file",
    content: "# T\n\n## Blocked by\n\n- `001-first-slice.md`\n",
    expected: ["001-first-slice.md"],
  },
  {
    name: "several blockers, duplicates collapsed, order kept",
    content: "# T\n\n## Blocked by\n\n- `002-b.md`\n- `001-a.md`\n- `002-b.md`\n",
    expected: ["002-b.md", "001-a.md"],
  },
  {
    name: "blockers stop at the next ## heading",
    content: "# T\n\n## Blocked by\n\n- `001-a.md`\n\n## Post-Mortem\n\n- see `009-later.md`\n",
    expected: ["001-a.md"],
  },
  {
    name: "a ### subheading does not end the section",
    content: "# T\n\n## Blocked by\n\n### Hard\n\n- `001-a.md`\n",
    expected: ["001-a.md"],
  },
  {
    name: "a filename mentioned outside the section is not a blocker",
    content: "# T\n\nSee `003-elsewhere.md`.\n\n## Blocked by\n\nNone\n",
    expected: [],
  },
  {
    name: "a bare (not backticked) filename is not a blocker",
    content: "# T\n\n## Blocked by\n\n001-a.md\n",
    expected: [],
  },
  {
    name: "heading with trailing spaces still matches",
    content: "# T\n\n## Blocked by   \n\n`001-a.md`\n",
    expected: ["001-a.md"],
  },
  {
    name: "CRLF line endings",
    content: "# T\r\n\r\n## Blocked by\r\n\r\n`001-a.md`\r\n\r\n## Post-Mortem\r\n\r\n`009-x.md`\r\n",
    expected: ["001-a.md"],
  },
  {
    name: "a name that is not NNN-slug.md is ignored",
    content: "# T\n\n## Blocked by\n\n`1-short.md` `001-ok.md` `001-no-ext`\n",
    expected: ["001-ok.md"],
  },
  {
    name: "a second Blocked by heading: the first one is the one cut",
    content: "# T\n\n## Blocked by\n\n`001-a.md`\n\n## Blocked by\n\n`002-b.md`\n",
    expected: ["001-a.md"],
  },
];

describe("parseBlockedBy: app and plugin twin agree (152 item 2)", () => {
  for (const c of CASES) {
    it(`${c.name}`, () => {
      expect(parseBlockedBy(c.content)).toEqual(c.expected);
      expect(twin.parseBlockedBy(c.content)).toEqual(c.expected);
    });
  }

  it("agrees on a generated corpus of section shapes", () => {
    const pieces = [
      "# T\n",
      "## Blocked by\n",
      "## Blocked by \n",
      "## Post-Mortem\n",
      "## What to build\n",
      "### sub\n",
      "`001-a.md`\n",
      "`002-b.md`\n",
      "plain text\n",
      "\n",
    ];
    // Deterministic: every ordered pair and triple of the pieces, so the corpus does not vary per run.
    let checked = 0;
    for (const x of pieces)
      for (const y of pieces)
        for (const z of pieces) {
          const content = x + y + z;
          expect(parseBlockedBy(content), JSON.stringify(content)).toEqual(twin.parseBlockedBy(content));
          checked++;
        }
    expect(checked).toBe(pieces.length ** 3);
  });
});

describe("extractPostMortemSection uses the same cut as the blocked-by section (152 item 2)", () => {
  it("stops at the next ## heading, which is the shared cut", () => {
    const content = "# T\n\n## Post-Mortem\n\n- **Problem:** p\n\n## Blocked by\n\n`001-a.md`\n";
    expect(extractPostMortemSection(content)).toBe("## Post-Mortem\n\n- **Problem:** p");
  });

  it("keeps ### subheadings inside it, as the blocked-by cut does", () => {
    const content = "# T\n\n## Post-Mortem\n\n### Notes\n\nbody\n";
    expect(extractPostMortemSection(content)).toBe("## Post-Mortem\n\n### Notes\n\nbody");
  });

  it("returns null when the heading is absent, the same as an absent blocked-by section", () => {
    expect(extractPostMortemSection("# T\n\n## Blocked by\n\nNone\n")).toBeNull();
    expect(parseBlockedBy("# T\n\n## Post-Mortem\n\n`001-a.md`\n")).toEqual([]);
  });
});
