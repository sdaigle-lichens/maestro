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

  // 032. Two separate things the REAL installer has to get right for the injected Step 1, and
  // only this suite runs it: the script is copied, and the skill it wrote grants the exact command
  // it also invokes.
  //
  // `039` added a second `Bash(...)` grant (for maestro-resume-target.cjs) to the same
  // `allowed-tools` line, so this now parses every grant on the line rather than assuming there is
  // only one — none of the granted commands contain parentheses, so a non-greedy per-grant scan
  // splits them cleanly.
  it("copies maestro-step1-gates.cjs, and grants exactly the command Step 1 injects", () => {
    expect(fs.existsSync(path.join(root, ".claude", "scripts", "maestro-step1-gates.cjs"))).toBe(true);

    const skill = fs.readFileSync(orchestratorSkillPath(root), "utf8");

    // The grant and the invocation are written in two places in the template, and a permission
    // check that returns anything but `allow` ABORTS the whole skill invocation — so a one-byte
    // drift between them is a /maestro that cannot start. One assertion, so they cannot drift.
    const line = /^allowed-tools:\s*(.+)$/m.exec(skill);
    expect(line, "no allowed-tools line in the installed skill").not.toBeNull();
    const grants = [...line![1].matchAll(/Bash\(([^()]*)\)/g)].map((m) => m[1]);
    expect(grants.length, "no allowed-tools Bash(...) grant in the installed skill").toBeGreaterThan(0);

    const steps = extractRegion(skill, "STEPS")!;
    const injected = /^!`(.+)`\s*$/m.exec(steps);
    expect(injected, "no !`command` line inside the STEPS region").not.toBeNull();

    expect(grants).toContain(injected![1]);
    expect(grants.some((g) => g.includes("maestro-step1-gates.cjs"))).toBe(true);
  });

  // Frontmatter lives OUTSIDE the managed regions, so a re-sync must not touch it — which is also
  // why an already-installed project needs a purge-and-reinstall to receive the new allowed-tools
  // line. See plugins/maestro/skills/maestro-update/SKILL.md.
  it("leaves everything before the STEPS marker byte-identical across a managed-region re-sync", async () => {
    const skillPath = orchestratorSkillPath(root);
    const before = fs.readFileSync(skillPath, "utf8");
    const seeded = defaultV3Config(["backend"]);

    await saveConfig(root, {
      sliceType: "gates",
      slice: { gates: { confidence_check: true, use_design_check: true } },
    });
    await saveConfig(root, {
      sliceType: "workflows",
      slice: {
        agents_available: seeded.agents_available,
        skills_available: seeded.skills_available,
        workflow_instances: seeded.workflow_instances,
        workflows: seeded.workflows,
      },
    });

    const after = fs.readFileSync(skillPath, "utf8");
    const head = (t: string) => t.split("<!-- Maestro:STEPS:START -->")[0];
    expect(head(after)).toBe(head(before));
    expect(head(after)).toContain("allowed-tools: Bash(");
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
