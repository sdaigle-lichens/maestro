// `095`: the collapsed-group dangling indicator and the shared recheck state. No jsdom, so the
// group is rendered to static markup and the wiring is pinned at source level.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CollapsibleGroup } from "../../src/renderer/src/components/source-group.js";
import { GroupDanglingIndicator } from "../../src/renderer/src/components/skill-ref-mark.js";

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../src/renderer/src/${rel}`, import.meta.url)), "utf8");

const group = (defaultOpen: boolean) =>
  renderToStaticMarkup(
    createElement(
      CollapsibleGroup,
      {
        title: "Plugin: x",
        count: 2,
        defaultOpen,
        closedIndicator: createElement("span", { "data-testid": "skill-group-dangling" }, "1"),
      },
      createElement("span", { "data-testid": "child" }, "row")
    )
  );

describe("CollapsibleGroup closedIndicator", () => {
  it("shows the indicator only while closed", () => {
    expect(group(false)).toContain('data-testid="skill-group-dangling"');
    expect(group(false)).not.toContain('data-testid="child"');
    expect(group(true)).not.toContain('data-testid="skill-group-dangling"');
    expect(group(true)).toContain('data-testid="child"');
  });
});

describe("GroupDanglingIndicator", () => {
  it("renders nothing when the report is clean", () => {
    expect(renderToStaticMarkup(createElement(GroupDanglingIndicator, { ids: ["a", "b"] }))).toBe("");
  });

  it("is amber, summarised via summarizeGroupDangling, and labels the reason only when shared", () => {
    const s = src("components/skill-ref-mark.tsx");
    expect(s).toContain("summarizeGroupDangling(ids, find)");
    expect(s).toMatch(/data-testid="skill-group-dangling"[\s\S]*text-amber-600/);
    expect(s).toContain("reason ? SKILL_REF_REASON_LABEL[reason] : undefined");
  });

  it("is wired onto the Skills groups in /workflows", () => {
    expect(src("routes/workflows.tsx")).toContain("closedIndicator={<GroupDanglingIndicator ids=");
  });
});

describe("collapsed vs expanded groups in /workflows", () => {
  const s = src("routes/workflows.tsx");

  it("derives the indicator ids from the group's own skills and keeps per-skill marks on the rows", () => {
    expect(s).toContain("ids={group.items.map((s) => s.id)}");
    expect(s).toContain("<SkillRefMark id={skill.id} />");
    // the mark rows render inside the group's children, i.e. only when it is open
    const groupStart = s.indexOf("<CollapsibleGroup");
    expect(groupStart).toBeGreaterThan(-1);
    expect(s.indexOf("<SkillRefMark id={skill.id} />")).toBeGreaterThan(groupStart);
  });

  it("closed indicator is gated on the group being closed and an indicator being supplied", () => {
    expect(src("components/source-group.tsx")).toContain("{!open && closedIndicator &&");
  });
});

describe("recheck lifecycle in the provider", () => {
  const ctx = src("utils/skill-ref-context.tsx");

  it("ignores a second recheck while one is in flight and always clears checking when it settles", () => {
    expect(ctx).toContain("if (checkingRef.current) return;");
    expect(ctx).toMatch(
      /void refresh\(\)\.finally\(\(\) => \{\s*checkingRef\.current = false;\s*setChecking\(false\);/
    );
  });

  it("recheck replaces the report, so the indicator (derived from find) clears when refs resolve", () => {
    expect(ctx).toContain("if (rootRef.current === asked) setReport(next)");
    expect(ctx).toContain("byId = new Map(report.dangling");
  });
});

describe("shared recheck state", () => {
  it("lives in the provider and both buttons read it instead of owning state", () => {
    const ctx = src("utils/skill-ref-context.tsx");
    expect(ctx).toContain("checking, recheck }");
    expect(ctx).toContain("setChecking(true)");
    const mark = src("components/skill-ref-mark.tsx");
    expect(mark).not.toContain("setChecking");
    expect((mark.match(/onClick=\{recheck\}/g) ?? []).length).toBe(2);
    expect((mark.match(/disabled=\{checking\}/g) ?? []).length).toBe(2);
  });
});
