// Differential tests: the ported TS must behave identically to the hand-written CJS it replaces.
//
// The legacy implementations are SNAPSHOTTED under test/fixtures/legacy/ rather than imported
// from plugins/maestro/scripts/lib/. That matters: build-plugin-libs.mjs overwrites the
// plugin's copies with bundles generated from this package, so comparing against the live files
// would become tautological the moment the build runs. The snapshots are the last hand-written
// versions and are the actual parity baseline.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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
import { SEED_HANDOFFS } from "../../src/core/handoff-seeds.js";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
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

// `033`'s two bundles. Unlike the parity blocks above, these read the LIVE generated files rather
// than a snapshot — the question is not "does the port still behave like the hand-written
// original" (there was no hand-written original) but "does the bundle the hook actually `require`s
// still carry the names it requires, and only the dependencies it may have". Both fail silently:
// build-plugin-libs.mjs is load-bearing and quiet, and a missing export is a hook that degrades
// instead of throwing.
describe("handoff bundles (033)", () => {
  const LIB = path.resolve(here, "../../../../plugins/maestro/scripts/lib");

  it("maestro-session.cjs carries the seed tier, the route walk and the resolution", () => {
    const session = require(path.join(LIB, "maestro-session.cjs"));
    for (const name of [
      "handoffRoutes",
      "routesFrom",
      "handoffPairs",
      "resolveHandoff",
      "SEED_HANDOFFS",
      "PRIOR_HANDOFF_SEEDS",
      "isSeededHandoff",
      "isValidHandoffId",
      "splitHandoffId",
      "handoffId",
    ]) {
      expect(Object.keys(session), `maestro-session.cjs no longer exports ${name}`).toContain(name);
    }
    expect(Object.keys(session.SEED_HANDOFFS)).toHaveLength(23);
    expect(session.SEED_HANDOFFS).toEqual(SEED_HANDOFFS);
  });

  // THE property this whole split exists for. `handoff-seeds.ts` imports nothing that reaches
  // node:sqlite so that the hook's UNCONDITIONAL require of this bundle still answers on a `node`
  // older than 22.5 — the same check `031` pinned on maestro-agent-sync.cjs. Adding a store import
  // to handoff-seeds.ts or handoff-routes.ts breaks it, the bundle still builds, and only a
  // bare-`node` run notices.
  it("maestro-session.cjs reaches no node:sqlite", () => {
    const text = fs.readFileSync(path.join(LIB, "maestro-session.cjs"), "utf8");
    expect(text.match(/node:sqlite/g) ?? []).toHaveLength(0);
  });

  it("maestro-session.cjs carries the channel surface (036), and reaches no node:sqlite", () => {
    const session = require(path.join(LIB, "maestro-session.cjs"));
    for (const name of [
      "channelDir",
      "laneFor",
      "writeStamp",
      "readLane",
      "retire",
      "sweep",
      "formatStampedContent",
      "parseStampedContent",
      "CHANNEL_AGE_CAP_MS",
      "ensureSessionRunId",
    ]) {
      expect(Object.keys(session), `maestro-session.cjs no longer exports ${name}`).toContain(name);
    }
    // Re-asserted here rather than only above: handoff-channels.ts is `fs`/`path` only by design,
    // and a store import creeping into it would defeat the whole point of re-exporting it from
    // the bundle every hook requires UNCONDITIONALLY.
    const text = fs.readFileSync(path.join(LIB, "maestro-session.cjs"), "utf8");
    expect(text.match(/node:sqlite/g) ?? []).toHaveLength(0);
  });

  it("maestro-handoff-defaults.cjs is the sqlite tier, and only that", () => {
    const store = require(path.join(LIB, "maestro-handoff-defaults.cjs"));
    expect(Object.keys(store).sort()).toEqual(
      [
        "DEFAULT_HANDOFF_DEFAULTS_DB_PATH",
        "deleteHandoffDefault",
        "readAllHandoffDefaults",
        "readHandoffDefault",
        "writeHandoffDefault",
      ].sort()
    );
    // Externalized, not inlined — the require() that can throw has to stay a require() for the
    // hook's own try/catch to catch (see build-plugin-libs.mjs's `external` list).
    expect(fs.readFileSync(path.join(LIB, "maestro-handoff-defaults.cjs"), "utf8")).toContain('require("node:sqlite")');
  });
});

// The two STATIC_ASSETS manifests are mirrored BY HAND — `install.ts` says so and
// `maestro-install.js` says so back. Nothing generates either, and the differential test above
// only compares what a run produced, so a file added to one list and forgotten in the other is
// invisible until a project installed from the terminal is missing a script the app's projects
// have. This reads both sources and pins the two `src` sets equal.
describe("STATIC_ASSETS manifest parity (source-level)", () => {
  const REPO = path.resolve(here, "../../../..");

  /** Every `src:` string inside the file's `STATIC_ASSETS = [...]` literal. */
  function manifestSrcs(file: string): string[] {
    const text = fs.readFileSync(file, "utf8");
    // The DECLARATION, not the first mention — both files talk about `STATIC_ASSETS` in comments
    // above it, and the TS one writes `STATIC_ASSETS: RuntimeAsset[] = [`, whose type annotation
    // carries an empty pair of brackets that a naive `indexOf("[")` stops on.
    const decl = /STATIC_ASSETS[^=\n]*=\s*\[/.exec(text);
    expect(decl, `no STATIC_ASSETS declaration in ${file}`).not.toBeNull();
    const open = decl!.index + decl![0].length - 1;
    // Balanced-bracket scan: the literal contains no nested arrays today, but a `.map(...)` tail
    // does carry brackets after it, so stopping at the first `]` would be wrong tomorrow.
    let depth = 0;
    let end = open;
    for (let i = open; i < text.length; i++) {
      if (text[i] === "[") depth++;
      else if (text[i] === "]" && --depth === 0) {
        end = i;
        break;
      }
    }
    const body = text.slice(open, end);
    return [...body.matchAll(/src:\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]).sort();
  }

  it("the app's manifest and the plugin script's list exactly the same files", () => {
    const app = manifestSrcs(path.join(REPO, "apps/maestro/src/core/install.ts"));
    const plugin = manifestSrcs(path.join(REPO, "plugins/maestro/scripts/maestro-install.js"));
    expect(app.length).toBeGreaterThan(5); // the scan found a real list, not an empty match
    expect(plugin).toEqual(app);
  });
});
