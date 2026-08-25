// Differential tests: the ported TS must behave identically to the hand-written CJS it replaces.
//
// The legacy implementations are SNAPSHOTTED under test/fixtures/legacy/ rather than imported
// from plugins/maestro/scripts/lib/. That matters: build-plugin-libs.mjs overwrites the
// plugin's copies with bundles generated from this package, so comparing against the live files
// would become tautological the moment the build runs. The snapshots are the last hand-written
// versions and are the actual parity baseline.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

import {
  successPathSteps,
  nodeLabel,
  workflowNodeLabels,
  collectAgentSkills,
  resolveSearchList,
  resolveWorkflowName,
  bareAgentName,
} from "../../src/core/success-path.js";
import { replaceRegion, extractRegion, syncManagedRegions } from "../../src/core/skill-regions.js";
import { allConfigs } from "./fixtures/configs.js";

const require = createRequire(import.meta.url);
const legacySession = require("./fixtures/legacy/maestro-session.cjs");
const legacyRegions = require("./fixtures/legacy/maestro-skill-regions.cjs");

describe("success-path parity", () => {
  for (const [name, cfg] of Object.entries(allConfigs)) {
    describe(name, () => {
      it("successPathSteps matches the legacy walk", () => {
        for (const wf of cfg.workflows) {
          expect(successPathSteps(wf, cfg.workflow_instances)).toEqual(
            legacySession.successPathSteps(wf, cfg.workflow_instances)
          );
        }
      });

      it("nodeLabel matches for every node id, main-session, and a missing id", () => {
        for (const wf of cfg.workflows) {
          const ids = [...wf.nodes.map((n) => n.id), "main-session", "does-not-exist"];
          for (const id of ids) {
            expect(nodeLabel(id, wf, cfg.workflow_instances)).toBe(
              legacySession.nodeLabel(id, wf, cfg.workflow_instances)
            );
          }
        }
      });

      it("workflowNodeLabels matches", () => {
        for (const wf of cfg.workflows) {
          expect([...workflowNodeLabels(wf, cfg.workflow_instances)].sort()).toEqual(
            [...legacySession.workflowNodeLabels(wf, cfg.workflow_instances)].sort()
          );
        }
      });

      it("collectAgentSkills matches across every agent, including namespaced ids", () => {
        const agents = [
          ...new Set(cfg.workflow_instances.map((i) => i.agent)),
          ...cfg.workflow_instances.map((i) => `some-plugin:${bareAgentName(i.agent)}`),
          "not-an-agent",
        ];
        for (const agent of agents) {
          expect(collectAgentSkills(cfg.workflows, cfg.workflow_instances, agent)).toEqual(
            legacySession.collectAgentSkills(cfg.workflows, cfg.workflow_instances, agent)
          );
        }
      });

      it("resolveSearchList matches for active / stale / unset sessions", () => {
        const sessions = [
          null,
          { workflow: null, generated_instances: [] },
          { workflow: cfg.workflows[0]?.name ?? "default", generated_instances: [] },
          { workflow: "no-such-workflow", generated_instances: [] },
        ];
        for (const session of sessions) {
          const mine = resolveSearchList(cfg, session);
          const theirs = legacySession.resolveSearchList(cfg, session);
          expect(mine.searchList).toEqual(theirs.searchList);
          expect(mine.warning).toBe(theirs.warning);
          expect(mine.activeWorkflowName).toBe(theirs.activeWorkflowName);
        }
      });

      it("resolveWorkflowName matches", () => {
        expect(resolveWorkflowName(cfg)).toBe(legacySession.resolveWorkflowName(cfg));
        expect(resolveWorkflowName(cfg, "explicit")).toBe(legacySession.resolveWorkflowName(cfg, "explicit"));
      });
    });
  }

  it("bareAgentName matches on the edge cases", () => {
    for (const s of ["", "backend", "plugin:backend", "a:b:c", null, undefined]) {
      expect(bareAgentName(s as string)).toBe(legacySession.bareAgentName(s));
    }
  });
});

const SKILL_MD = [
  "# Maestro",
  "",
  "Custom prose the user wrote. Never touched.",
  "",
  "<!-- Maestro:STEPS:START -->",
  "old steps body",
  "",
  "<!-- Maestro:HANDOFFS:START -->",
  "| Workflow | Success path |",
  "| --- | --- |",
  "| default | @backend |",
  "<!-- Maestro:HANDOFFS:END -->",
  "<!-- Maestro:STEPS:END -->",
  "",
  "<!-- Maestro:PRINCIPLES:START -->",
  "old principles",
  "<!-- Maestro:PRINCIPLES:END -->",
  "",
  "More user prose at the end.",
].join("\n");

const TEMPLATE_MD = [
  "<!-- Maestro:STEPS:START -->",
  "NEW steps body",
  "",
  "<!-- Maestro:HANDOFFS:START -->",
  "# No workflows configured yet. Run /maestro-install to set up.",
  "<!-- Maestro:HANDOFFS:END -->",
  "<!-- Maestro:STEPS:END -->",
  "",
  "<!-- Maestro:PRINCIPLES:START -->",
  "NEW principles",
  "<!-- Maestro:PRINCIPLES:END -->",
].join("\n");

/** A file from before managed regions existed — syncManagedRegions must refuse to touch it. */
const PRE_REGIONS_MD = "# Maestro\n\nNo markers anywhere in this file.\n";

describe("skill-regions parity", () => {
  const cases = [SKILL_MD, TEMPLATE_MD, PRE_REGIONS_MD, ""];

  it("extractRegion matches", () => {
    for (const text of cases) {
      for (const name of ["STEPS", "PRINCIPLES", "HANDOFFS", "NOPE"]) {
        expect(extractRegion(text, name)).toBe(legacyRegions.extractRegion(text, name));
      }
    }
  });

  it("replaceRegion matches, including the absent-region no-op", () => {
    for (const text of cases) {
      for (const name of ["STEPS", "HANDOFFS", "NOPE"]) {
        expect(replaceRegion(text, name, "REPLACED")).toBe(legacyRegions.replaceRegion(text, name, "REPLACED"));
      }
    }
  });

  it("syncManagedRegions matches", () => {
    for (const installed of cases) {
      const mine = syncManagedRegions(installed, TEMPLATE_MD);
      const theirs = legacyRegions.syncManagedRegions(installed, TEMPLATE_MD);
      expect(mine.text).toBe(theirs.text);
      expect(mine.synced).toEqual(theirs.synced);
      expect(mine.missing).toEqual(theirs.missing);
    }
  });

  it("a sync preserves the rendered HANDOFFS body and the user's prose", () => {
    const { text, synced, missing } = syncManagedRegions(SKILL_MD, TEMPLATE_MD);
    expect(missing).toEqual([]);
    expect(synced).toEqual(["STEPS", "PRINCIPLES"]);
    expect(text).toContain("| default | @backend |"); // rendered region carried across
    expect(text).toContain("NEW steps body");
    expect(text).toContain("Custom prose the user wrote. Never touched.");
    expect(text).toContain("More user prose at the end.");
  });

  it("refuses to sync a pre-managed-regions file", () => {
    const { text, synced, missing } = syncManagedRegions(PRE_REGIONS_MD, TEMPLATE_MD);
    expect(text).toBe(PRE_REGIONS_MD);
    expect(synced).toEqual([]);
    expect(missing).toEqual(["STEPS", "PRINCIPLES"]);
  });

  it("exports the same names the hook scripts require()", () => {
    expect(Object.keys(legacyRegions).sort()).toEqual(
      [
        "MANAGED_REGIONS",
        "RENDERED_REGIONS",
        "endMarker",
        "extractRegion",
        "replaceRegion",
        "startMarker",
        "syncManagedRegions",
      ].sort()
    );
    expect(Object.keys(legacySession).sort()).toEqual(
      [
        "SESSION_LOG_FILE",
        "appendSessionLog",
        "bareAgentName",
        "collectAgentSkills",
        "nodeLabel",
        "readJson",
        "readSession",
        "readStdin",
        "resolveSearchList",
        "resolveWorkflowName",
        "sessionLogPath",
        "successPathSteps",
        "workflowNodeLabels",
        "writeSession",
      ].sort()
    );
  });
});
