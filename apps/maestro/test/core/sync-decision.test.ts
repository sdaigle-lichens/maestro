// The five branches `report-sync.ts` has always applied, now shared with the agent path (`031`).
// Table-driven because the whole value of lifting them out is that there is exactly one place to
// read them from — so the table is that place's contract.

import { describe, expect, it } from "vitest";
import { decideSync, type SyncTracking } from "../../src/core/sync-decision.js";

const tracked: SyncTracking = { kind: "tracked", hash: "H" };

describe("decideSync", () => {
  it("never touches a copy the user owns, whatever else is true", () => {
    for (const localHash of ["H", "OTHER", null]) {
      for (const templateAdvanced of [true, false]) {
        expect(decideSync({ tracking: { kind: "detached" }, localHash, hasTemplate: true, templateAdvanced })).toBe(
          "detached"
        );
      }
    }
  });

  it("answers no-template before it compares anything", () => {
    expect(decideSync({ tracking: tracked, localHash: null, hasTemplate: false, templateAdvanced: true })).toBe(
      "no-template"
    );
  });

  it("materializes when there is no project copy on disk", () => {
    expect(decideSync({ tracking: tracked, localHash: null, hasTemplate: true, templateAdvanced: false })).toBe(
      "materialize"
    );
  });

  it("leaves an untracked file alone rather than treating it as unmodified", () => {
    expect(
      decideSync({ tracking: { kind: "untracked" }, localHash: "X", hasTemplate: true, templateAdvanced: true })
    ).toBe("unchanged");
  });

  it("defaults matchesKnownVersion to false, so an untracked file is unchanged with no opinion", () => {
    expect(
      decideSync({ tracking: { kind: "untracked" }, localHash: "X", hasTemplate: true, templateAdvanced: false })
    ).toBe("unchanged");
  });

  it("adopts an untracked file whose content matches a known version of the template (`059`)", () => {
    expect(
      decideSync({
        tracking: { kind: "untracked" },
        localHash: "H",
        hasTemplate: true,
        templateAdvanced: false,
        matchesKnownVersion: true,
      })
    ).toBe("adopt");
  });

  it("does not adopt an untracked file whose content matches nothing known — genuinely unattributable", () => {
    expect(
      decideSync({
        tracking: { kind: "untracked" },
        localHash: "SOMEBODY ELSES CONTENT",
        hasTemplate: true,
        templateAdvanced: true,
        matchesKnownVersion: false,
      })
    ).toBe("unchanged");
  });

  it("reports a user-edited copy as stale-customized BEFORE it looks at whether the template moved", () => {
    for (const templateAdvanced of [true, false]) {
      expect(decideSync({ tracking: tracked, localHash: "EDITED", hasTemplate: true, templateAdvanced })).toBe(
        "stale-customized"
      );
    }
  });

  it("refreshes only an untouched copy whose template advanced", () => {
    expect(decideSync({ tracking: tracked, localHash: "H", hasTemplate: true, templateAdvanced: true })).toBe(
      "refresh"
    );
    expect(decideSync({ tracking: tracked, localHash: "H", hasTemplate: true, templateAdvanced: false })).toBe(
      "unchanged"
    );
  });
});
