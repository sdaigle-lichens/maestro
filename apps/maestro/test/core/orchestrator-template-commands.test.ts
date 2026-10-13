// 094: the orchestrator template's body commands call project-copy scripts by the plain relative
// path (`node .claude/scripts/<script>`), because a permission check cannot resolve a
// `${CLAUDE_PROJECT_DIR}` expansion and would prompt. 101: the `!` injection lines and the
// `allowed-tools` frontmatter use the same plain relative form (a grant does not stop the prompt).
// Reads the real published template and this repo's rendered copy; nothing is mocked.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { findUpPluginRoot } from "../../src/core/install.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const PLUGIN_ROOT = findUpPluginRoot(here)!;
const REPO_ROOT = path.resolve(PLUGIN_ROOT, "..", "..");

const TEMPLATE = fs.readFileSync(path.join(PLUGIN_ROOT, "templates", "maestro", "SKILL.md"), "utf8");

const bodyLines = (text: string): string[] => {
  const end = text.indexOf("\n---", 4);
  return text
    .slice(end + 4)
    .split("\n")
    .filter((l) => !l.startsWith("!`"));
};

const stepsRegion = (text: string): string => {
  const m = text.match(/<!-- Maestro:STEPS:START -->[\s\S]*<!-- Maestro:STEPS:END -->/);
  // The handoff table inside is rendered per project, so it is excluded from the comparison.
  return (m ? m[0] : "").replace(/<!-- Maestro:HANDOFFS:START -->[\s\S]*?<!-- Maestro:HANDOFFS:END -->/, "");
};

describe("orchestrator template script commands (094)", () => {
  it("no non-! body line calls a project script through CLAUDE_PROJECT_DIR", () => {
    const offenders = bodyLines(TEMPLATE).filter((l) => l.includes("CLAUDE_PROJECT_DIR"));
    expect(offenders).toEqual([]);
  });

  it("uses the relative form for every script the orchestrator runs itself", () => {
    for (const cmd of [
      "maestro-set-session-workflow.cjs",
      "maestro-resolve-skill-path.cjs",
      "maestro-resume-target.cjs",
      "maestro-epic.cjs",
    ]) {
      expect(TEMPLATE).toContain(`node .claude/scripts/${cmd} `);
    }
    for (const sub of [
      "claim",
      "release",
      "worktree",
      "plan",
      "plan-step",
      "plan-show",
      "handoff-issues",
      "done",
      "merge",
    ]) {
      expect(TEMPLATE).toContain(`node .claude/scripts/maestro-task-status.cjs ${sub}`);
    }
  });

  it("puts the ! injection lines and allowed-tools grants on the relative form", () => {
    const bang = TEMPLATE.split("\n").filter((l) => l.startsWith("!`"));
    expect(bang.length).toBeGreaterThanOrEqual(3);
    for (const l of bang) expect(l).toContain("node .claude/scripts/");
    const allowed = TEMPLATE.split("\n").find((l) => l.startsWith("allowed-tools:")) ?? "";
    expect(allowed).toContain("Bash(node .claude/scripts/maestro-step1-gates.cjs)");
    expect(TEMPLATE).not.toContain("CLAUDE_PROJECT_DIR");
  });

  it("this repo's rendered orchestrator steps region matches the template", () => {
    const rendered = fs.readFileSync(path.join(REPO_ROOT, ".claude", "skills", "maestro", "SKILL.md"), "utf8");
    expect(stepsRegion(rendered)).toBe(stepsRegion(TEMPLATE));
    expect(stepsRegion(TEMPLATE)).not.toBe("");
  });
});
