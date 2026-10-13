// `096`: the install result card renders a refused install (an unusable maestro.json) as an error
// that shows the backend's sentence as is, instead of the "What changed on disk" summary; the
// normal states and the runtime-refresh description keep working beside it.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import InstallReportCard from "../../src/renderer/src/components/install-report-card.js";
import { describeRuntimeRefresh } from "../../src/renderer/src/utils/install-context.js";
import type { InstallReport } from "../../src/shared/ipc.js";

function report(over: Partial<InstallReport> = {}): InstallReport {
  return {
    projectRoot: "/p",
    orchestratorSkill: { action: "unchanged", regions: [], backup: null },
    scriptsWritten: [],
    hooksAdded: [],
    hooksRemoved: [],
    retiredScriptsRemoved: [],
    gitignoreUpdated: false,
    runtimeVersion: "1.2.3",
    runtimeVersionUpdated: false,
    configSeeded: null,
    skillListsSeeded: null,
    unchanged: false,
    warnings: [],
    status: {} as InstallReport["status"],
    reportsSync: { materialized: [], refreshed: [], adopted: [], staleCustomized: [], unchanged: [] },
    handoffsSync: { materialized: [], refreshed: [], adopted: [], staleCustomized: [], unchanged: [] },
    configIssues: [],
    configRefusal: null,
    ...over,
  };
}

const render = (r: InstallReport) => renderToStaticMarkup(createElement(InstallReportCard, { report: r }));

describe("InstallReportCard", () => {
  it("renders the refusal message as is, with no change summary", () => {
    const message = "Could not install: .claude/maestro.json is not valid JSON (Unexpected token). Fix or remove it.";
    const html = render(
      report({
        unchanged: false,
        configRefusal: { kind: "unparseable", file: ".claude/maestro.json", problem: "Unexpected token", message },
      })
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain("Install refused");
    expect(html).toContain(
      "Could not install: .claude/maestro.json is not valid JSON (Unexpected token). Fix or remove it."
    );
    expect(html).not.toContain("What changed on disk");
    expect(html).not.toContain("Nothing — this project already has");
  });

  it("renders an unsupported-version refusal the same way", () => {
    const message = "Refusing to touch .claude/maestro.json: found version 2, expected version 3.";
    const html = render(
      report({
        configRefusal: {
          kind: "unsupported-version",
          file: ".claude/maestro.json",
          problem: "found version 2, expected version 3",
          message,
        },
      })
    );
    expect(html).toContain(message);
  });

  it("renders the normal summary when there is no refusal", () => {
    const html = render(report({ scriptsWritten: [".claude/scripts/a.cjs"], hooksAdded: ["Stop:x"] }));
    expect(html).toContain("What changed on disk");
    expect(html).toContain("1 runtime file written");
    expect(html).toContain("1 hook registered");
    expect(html).not.toContain("Install refused");
  });

  it("renders the nothing-to-do line for an unchanged install", () => {
    const html = render(report({ unchanged: true }));
    expect(html).toContain("already has the runtime the app ships");
    expect(html).not.toContain("Install refused");
  });
});

describe("describeRuntimeRefresh", () => {
  it("names hooks, the orchestrator skill and skill lists, in that order", () => {
    const r = report({
      scriptsWritten: ["a"],
      orchestratorSkill: { action: "synced", regions: ["x"], backup: null },
      skillListsSeeded: { start_skills: true, end_skills: false, gatesRemoved: false },
    });
    expect(describeRuntimeRefresh(r)).toBe("hooks, orchestrator skill, skill lists");
  });

  it("falls back to the version when nothing else changed", () => {
    expect(describeRuntimeRefresh(report())).toBe("runtime version → 1.2.3");
  });
});
