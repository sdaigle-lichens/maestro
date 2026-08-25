// The M2 milestone proof: a full save against a project scaffolded by the REAL installer, using
// the REAL shipped orchestrator template — with no Claude session, no container, no result file.
//
// The other suites use hand-written SKILL.md fixtures, which can drift from the template the
// plugin actually ships. This one runs plugins/maestro/scripts/maestro-install.js as a
// subprocess and renders into whatever that produces, so a template change that breaks the
// managed-region contract fails here.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { saveConfig } from "../../src/core/save.js";
import { readConfig } from "../../src/core/config.js";
import { defaultV3Config } from "../../src/core/seed.js";
import { discoverProjectRules } from "../../src/core/discovery.js";
import { orchestratorSkillPath } from "../../src/core/render.js";
import { extractRegion } from "../../src/core/skill-regions.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_SCRIPTS = path.resolve(here, "../../../../plugins/maestro/scripts");
const INSTALLER = path.join(PLUGIN_SCRIPTS, "maestro-install.js");

let tmp: string;
let root: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "maestro-real-"));
  root = path.join(tmp, "project");
  fs.mkdirSync(path.join(root, "src", "backend"), { recursive: true });
  // HOME pointed at this tmp dir: the installer now reads `~/.claude/maestro-skill-tags.sqlite`
  // (skill-tags.ts) on every run, and without this override that's the DEVELOPER's real one —
  // this subprocess is the only thing in the suite that runs the live installer for real, so it's
  // the one place that side effect would otherwise leak.
  execFileSync("node", [INSTALLER, root], { encoding: "utf8", env: { ...process.env, HOME: tmp } });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("save against a really-installed project", () => {
  it("writes the config and renders the handoff table into the shipped template", async () => {
    const seeded = defaultV3Config(["backend"]);

    const res = await saveConfig(root, {
      sliceType: "workflows",
      slice: {
        agents_available: seeded.agents_available,
        skills_available: seeded.skills_available,
        workflow_instances: seeded.workflow_instances,
        workflows: seeded.workflows,
      },
    });

    expect(res.render.ok).toBe(true);
    expect(res.warnings).toEqual([]);

    // The seeded default workflow's happy path, as the orchestrator will read it at runtime.
    expect(res.render.rows).toContainEqual({
      workflow: "default",
      successPath: "@backend → human review → @test → @reviewer → @scribe",
    });
    expect(res.render.rows).toContainEqual({
      workflow: "tdd",
      successPath: "@test → human review → @backend → @reviewer → @scribe",
    });
    // The Refactor workflow leads with an inline skill step.
    expect(res.render.rows).toContainEqual({
      workflow: "Refactor",
      successPath: "/use-design-check → human review → @refactor",
    });

    const table = extractRegion(fs.readFileSync(orchestratorSkillPath(root), "utf8"), "HANDOFFS");
    expect(table).toContain("| Workflow | Success path |");
    expect(table).toContain("| default | @backend → human review → @test → @reviewer → @scribe |");
  });

  it("leaves the rest of the installed skill untouched", async () => {
    const before = fs.readFileSync(orchestratorSkillPath(root), "utf8");
    const seeded = defaultV3Config(["backend"]);
    await saveConfig(root, {
      sliceType: "workflows",
      slice: {
        agents_available: seeded.agents_available,
        skills_available: seeded.skills_available,
        workflow_instances: seeded.workflow_instances,
        workflows: seeded.workflows,
      },
    });
    const after = fs.readFileSync(orchestratorSkillPath(root), "utf8");

    // Only the HANDOFFS region may differ.
    for (const region of ["STEPS", "PRINCIPLES"]) {
      const strip = (t: string) => extractRegion(t, region)?.replace(/<!-- Maestro:HANDOFFS[\s\S]*?END -->/, "");
      expect(strip(after)).toBe(strip(before));
    }
    // Frontmatter and any prose outside the regions survive verbatim.
    expect(after.split("<!-- Maestro:STEPS:START -->")[0]).toBe(before.split("<!-- Maestro:STEPS:START -->")[0]);
  });

  it("places a rule file and keeps the workflow slice", async () => {
    fs.mkdirSync(path.join(root, ".claude", "rules"), { recursive: true });
    fs.writeFileSync(
      path.join(root, ".claude", "rules", "python.md"),
      "---\nname: python\ndescription: py style\n---\n\nUse type hints.\n"
    );

    const seeded = defaultV3Config(["backend"]);
    await saveConfig(root, {
      sliceType: "workflows",
      slice: {
        agents_available: seeded.agents_available,
        skills_available: seeded.skills_available,
        workflow_instances: seeded.workflow_instances,
        workflows: seeded.workflows,
      },
    });

    const res = await saveConfig(root, {
      sliceType: "rules",
      slice: { rules: [{ id: "python", paths: ["src/backend/**"], source: "project" }] },
    });

    expect(res.rules.moved).toEqual([
      {
        id: "python",
        from: path.join(".claude", "rules", "python.md"),
        to: path.join("src", "backend", ".claude", "rules", "python.md"),
      },
    ]);
    // The picker must still find it in its new home.
    expect(discoverProjectRules(root).map((r) => [r.id, r.dir])).toEqual([["python", path.join("src", "backend")]]);
    // …and the rules save must not have clobbered the workflows written a moment ago.
    expect(readConfig(root)!.workflows).toHaveLength(seeded.workflows.length);
  });
});
