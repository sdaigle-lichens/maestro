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

// 126: the `human review` step kind asks with an `AskUserQuestion` picker (Approve / Request
// changes) instead of free text, keeps a plain-text fallback, and keeps the hard-stop and
// `condition`-edge loop-back rules it already had.
describe("orchestrator template `human review` step kind (126)", () => {
  const HUMAN_REVIEW_BULLET = /^- `human review` — .*$/gm;
  const bulletsIn = (text: string): string[] => text.match(HUMAN_REVIEW_BULLET) ?? [];

  // Returns the list of rules the bullet breaks; empty means it is compliant.
  const violations = (bullet: string): string[] => {
    const out: string[] = [];
    const need = (ok: boolean, why: string) => {
      if (!ok) out.push(why);
    };
    need(bullet.includes("**never bypassed**"), "hard stop: **never bypassed**");
    need(bullet.includes("`AskUserQuestion`"), "names `AskUserQuestion`");
    need(bullet.includes("`Approve`"), "offers `Approve`");
    need(bullet.includes("`Request changes`"), "offers `Request changes`");
    need(/plain text/.test(bullet), "plain-text fallback");
    need(/unavailable or fails/.test(bullet), "fallback trigger: unavailable or fails");
    need(bullet.includes("`condition` edge"), "loop-back along the review's `condition` edge");
    need(bullet.includes("don't fix them yourself"), "orchestrator does not fix corrections itself");
    need(bullet.includes("resume from this step"), "resumes from the review after the loop-back");
    need(bullet.includes("Fix inline only if no such edge exists"), "inline fix only without an edge");
    // The picker is the primary path; the fallback comes after it, and the ask comes before the
    // approval branch (summarise → ask → act on the answer).
    const ask = bullet.indexOf("`AskUserQuestion`");
    need(ask < bullet.indexOf("plain text"), "picker named before the plain-text fallback");
    need(ask < bullet.indexOf("On approval"), "ask happens before the approval branch");
    need(bullet.indexOf("`Approve`") < bullet.indexOf("`Request changes`"), "`Approve` listed first");
    return out;
  };

  const rendered = fs.readFileSync(path.join(REPO_ROOT, ".claude", "skills", "maestro", "SKILL.md"), "utf8");

  it("the template has exactly one `human review` bullet, inside the STEPS region", () => {
    expect(bulletsIn(TEMPLATE)).toHaveLength(1);
    expect(bulletsIn(stepsRegion(TEMPLATE))).toHaveLength(1);
  });

  it("the template's bullet asks with AskUserQuestion, falls back to plain text, and keeps the hard stop and loop-back", () => {
    expect(violations(bulletsIn(TEMPLATE)[0] ?? "")).toEqual([]);
  });

  it("this repo's rendered orchestrator carries the same compliant bullet", () => {
    const bullets = bulletsIn(rendered);
    expect(bullets).toHaveLength(1);
    expect(bullets[0]).toBe(bulletsIn(TEMPLATE)[0]);
    expect(violations(bullets[0])).toEqual([]);
  });

  // Negative control: the pre-126 bullet ("Surface the work to the user") must be rejected, so the
  // check above is not passing vacuously.
  it("rejects the pre-126 free-text bullet", () => {
    const pre126 =
      "- `human review` — a hard stop, **never bypassed**. Surface the work to the user. On approval, continue. " +
      "On requested corrections, don't fix them yourself: follow the review's `condition` edge to the agent that " +
      "produced the work (e.g. `human requested code corrections` → `@backend`; for fullstack pick `@frontend` or " +
      "`@backend` by the change), resolve it like any loop-back below, hand it the changes, then resume from this " +
      "step. Fix inline only if no such edge exists.";
    expect(bulletsIn(pre126)).toHaveLength(1);
    const v = violations(pre126);
    expect(v).toContain("names `AskUserQuestion`");
    expect(v).toContain("plain-text fallback");
    expect(v).not.toContain("hard stop: **never bypassed**");
    expect(v).not.toContain("loop-back along the review's `condition` edge");
  });

  // Adversarial: a picker-only rewrite that drops the hard stop or the fallback is caught too.
  it("rejects a bullet that adds the picker but drops the hard stop or the fallback", () => {
    const current = bulletsIn(TEMPLATE)[0];
    expect(violations(current.replace("**never bypassed**", "usually honoured"))).toContain(
      "hard stop: **never bypassed**"
    );
    expect(violations(current.replace("; if it is unavailable or fails, ask in plain text instead", ""))).toEqual(
      expect.arrayContaining(["plain-text fallback", "fallback trigger: unavailable or fails"])
    );
  });
});
