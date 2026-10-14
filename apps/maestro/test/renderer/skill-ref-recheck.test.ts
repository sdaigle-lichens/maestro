// `091` loop-back: the always-visible "Recheck skills" control and the debounced focus refresh.
// No jsdom here, so the control is rendered to static markup (no provider = the clean/empty
// report, i.e. exactly the state in which the notice has gone) and the provider's window
// listeners are pinned at source level, the way the other renderer tests pin wiring.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SkillRefRecheck, SkillRefNotice } from "../../src/renderer/src/components/skill-ref-mark.js";

const src = (rel: string) =>
  readFileSync(fileURLToPath(new URL(`../../src/renderer/src/${rel}`, import.meta.url)), "utf8");

describe("SkillRefRecheck", () => {
  it("renders even when the report is clean and the notice renders nothing", () => {
    expect(renderToStaticMarkup(createElement(SkillRefNotice))).toBe("");
    const html = renderToStaticMarkup(createElement(SkillRefRecheck));
    expect(html).toContain('data-testid="skill-ref-recheck"');
    expect(html).toContain("Recheck skills");
    expect(html).toContain('type="button"');
    expect(html).not.toContain('disabled=""');
  });

  it("is hosted on both the /workflows and /maestro routes", () => {
    for (const route of ["routes/workflows.tsx", "routes/maestro.tsx"]) {
      const s = src(route);
      expect(s, route).toMatch(/import SkillRefMark, \{[^}]*SkillRefRecheck[^}]*\} from/);
      expect(s, route).toContain("<SkillRefRecheck />");
    }
  });
});

describe("SkillRefProvider refresh on return to the window", () => {
  const s = src("utils/skill-ref-context.tsx");

  it("listens for window focus and document visibilitychange, and removes both on cleanup", () => {
    expect(s).toContain('window.addEventListener("focus"');
    expect(s).toContain('document.addEventListener("visibilitychange"');
    expect(s).toContain('window.removeEventListener("focus"');
    expect(s).toContain('document.removeEventListener("visibilitychange"');
  });

  it("debounces to one 300ms refresh, clears the timer on cleanup, and ignores a hidden document", () => {
    expect(s).toMatch(/setTimeout\(\(\) => void refresh\(\), 300\)/);
    expect((s.match(/clearTimeout\(timer\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(s).toContain('document.visibilityState === "hidden"');
  });

  it("keeps the stale-answer drop on project switch", () => {
    expect(s).toContain("if (rootRef.current === asked) setReport(next)");
  });
});
