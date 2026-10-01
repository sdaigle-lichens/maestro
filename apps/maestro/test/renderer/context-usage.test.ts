// `073`: context-window usage in the Session Log. The invariant under test is the null case — an
// instance with no stamped ctx_pct (step-gate entries, older logs) renders NO indicator, never 0%.

import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextUsageBadge, ContextUsageLine } from "../../src/renderer/src/components/context-usage.js";
import SessionLogCards from "../../src/renderer/src/components/session-log-cards.js";
import SessionLogDetail from "../../src/renderer/src/components/session-log-detail.js";
import { buildInstances, formatTokenWindow, latestContextUsage } from "../../src/renderer/src/utils/session-log.js";
import type { Instance } from "../../src/renderer/src/utils/session-log.js";
import type { SessionLogEntry } from "../../src/renderer/src/utils/maestro-session-log.js";

const ts = "2026-01-01T00:00:00.000Z";
const e = (extra: Partial<SessionLogEntry> = {}): SessionLogEntry => ({ ts, origin: "backend", log: "x", ...extra });

function inst(entries: SessionLogEntry[], displayName = "Backend"): Instance {
  return {
    id: 1,
    origin: "backend",
    displayName,
    startIndex: 0,
    entries,
    status: "success",
    label: null,
    input: null,
    output: null,
    skillsTriage: null,
    offeredSkills: null,
    delivered: [],
  } as unknown as Instance;
}
const html = (el: ReturnType<typeof createElement>) => renderToStaticMarkup(el);

describe("formatTokenWindow", () => {
  it("formats k and M", () => {
    expect(formatTokenWindow(200_000)).toBe("200k");
    expect(formatTokenWindow(1_000_000)).toBe("1M");
  });
});

describe("latestContextUsage edge cases", () => {
  it("treats a stamped ctx_pct of 0 as real, but missing/NaN/no-model as unknown", () => {
    expect(latestContextUsage([e({ ctx_pct: 0, ctx_model: "m" })])?.pct).toBe(0);
    expect(latestContextUsage([e({ ctx_pct: NaN, ctx_model: "m" })])).toBeNull();
    expect(latestContextUsage([e({ ctx_pct: 5 })])).toBeNull();
    expect(latestContextUsage([])).toBeNull();
  });
  it("unknown model falls back to the 200k window", () => {
    expect(latestContextUsage([e({ ctx_pct: 5, ctx_model: "mystery" })])?.windowTokens).toBe(200_000);
  });
});

describe("ContextUsageBadge", () => {
  it("renders ~NN% when stamped", () => {
    expect(
      html(createElement(ContextUsageBadge, { instance: inst([e({ ctx_pct: 61.6, ctx_model: "claude-sonnet-5" })]) }))
    ).toContain("~62%");
  });
  it("renders nothing with no ctx_pct, including step-gate entries", () => {
    const gate = e({ kind: "phase", phase: "step1_gates" });
    expect(html(createElement(ContextUsageBadge, { instance: inst([gate]) }))).toBe("");
    expect(html(createElement(ContextUsageBadge, { instance: inst([]) }))).toBe("");
  });
  it("a stale stamped entry is not blanked by a later unstamped one", () => {
    const i = inst([e({ ctx_pct: 40, ctx_model: "m" }), e({ kind: "phase", phase: "step4_gate" })]);
    expect(html(createElement(ContextUsageBadge, { instance: i }))).toContain("~40%");
  });
  it("colors by threshold", () => {
    const at = (p: number) =>
      html(createElement(ContextUsageBadge, { instance: inst([e({ ctx_pct: p, ctx_model: "m" })]) }));
    expect(at(74)).toContain("--ink-3");
    expect(at(75)).toContain("--yellow");
    expect(at(89)).toContain("--yellow");
    expect(at(90)).toContain("--red");
  });
});

describe("ContextUsageLine", () => {
  it("shows '<Name> · ~62% of 200k (approx.)'", () => {
    const out = html(
      createElement(ContextUsageLine, { instance: inst([e({ ctx_pct: 62, ctx_model: "claude-sonnet-5" })]) })
    );
    expect(out.replace(/<[^>]+>/g, "").replace(/\s+/g, " ")).toContain("Backend · ~62% of 200k (approx.)");
  });
  it("renders nothing when unstamped", () => {
    expect(html(createElement(ContextUsageLine, { instance: inst([e()]) }))).toBe("");
  });
});

describe("SessionLogCards / SessionLogDetail integration", () => {
  const stamped = inst([e({ ctx_pct: 62, ctx_model: "claude-sonnet-5" })]);
  const unstamped = { ...inst([e({ kind: "phase", phase: "step1_gates" })], "Test"), id: 2 } as Instance;

  it("cards show a badge only for the stamped node, never 0%", () => {
    const out = html(
      createElement(SessionLogCards, { instances: [stamped, unstamped], activeId: null, onSelect: () => {} } as never)
    );
    expect(out).toContain("~62%");
    expect(out).not.toMatch(/~?0%/);
    expect((out.match(/>~\d+%</g) ?? []).length).toBe(1); // text nodes only (title attr also has it)
  });
  it("detail header shows the usage line when stamped and none when not", () => {
    const withU = html(createElement(SessionLogDetail, { instance: stamped, cwd: "" } as never));
    expect(withU).toContain("Logs: Backend");
    expect(withU).toContain("(approx.)");
    const without = html(createElement(SessionLogDetail, { instance: unstamped, cwd: "" } as never));
    expect(without).toContain("Logs: Test");
    expect(without).not.toContain("approx.");
    expect(without).not.toMatch(/\d%/);
  });
  it("works through buildInstances with real entries", () => {
    const entries: SessionLogEntry[] = [
      { ts, origin: "main_session", log: "go" },
      e({ ctx_pct: 33, ctx_model: "claude-sonnet-5" }),
    ];
    const list = buildInstances(entries);
    const all = list.map((i) => latestContextUsage(i.entries));
    expect(all.some((u) => u?.pct === 33)).toBe(true);
  });
});
