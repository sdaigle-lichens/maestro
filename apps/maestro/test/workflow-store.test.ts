// Guards on the /workflows edit store's project identity.
//
// The store is a module singleton that outlives every route render, and seeding it is a
// conditional: keep the in-memory config (so an invalidation mid-edit doesn't discard unsaved
// canvas work) or replace it (so a project switch doesn't leave the previous project's workflows
// on screen). Getting that condition wrong is silent and expensive — the canvas showed project A
// while the window was on project B, and pressing Save wrote A's workflows into B's maestro.json.
// Nothing about that fails loudly, which is why it is pinned here.

import { describe, it, expect, beforeEach } from "vitest";
import {
  workflowStore,
  seedWorkflowStore,
  replaceConfig,
  setActiveWorkflowIdx,
  addWorkflow,
  reconcileWorkflowSlice,
  reloadFromDisk,
  keepMine,
  markSaved,
  workflowSlice,
  type WorkflowEditState,
} from "../src/renderer/src/store/workflow-store.js";
import type { MaestroConfigV3, MaestroWorkflowV3 } from "../src/renderer/src/utils/maestro.js";

const PROJECT_A = "/tmp/project-a";
const PROJECT_B = "/tmp/project-b";

const wf = (name: string): MaestroWorkflowV3 => ({ name, nodes: [], edges: [] });

const config = (...names: string[]): MaestroConfigV3 => ({
  version: 3,
  agents_available: [],
  skills_available: [],
  workflow_instances: [],
  workflows: names.map(wf),
  rules: [],
});

const names = () => workflowStore.state.config?.workflows.map((w) => w.name) ?? null;

beforeEach(() => {
  workflowStore.setState(() => ({
    config: null,
    projectRoot: null,
    activeWorkflowIdx: 0,
    baseline: null,
    externalChange: false,
    externalSlice: null,
  }));
});

describe("seedWorkflowStore", () => {
  it("seeds an empty store from loader data", () => {
    seedWorkflowStore(config("alpha"), PROJECT_A);
    expect(names()).toEqual(["alpha"]);
    expect(workflowStore.state.projectRoot).toBe(PROJECT_A);
  });

  it("keeps in-memory edits when the loader re-runs for the same project", () => {
    seedWorkflowStore(config("alpha"), PROJECT_A);
    addWorkflow(wf("unsaved-edit"));

    seedWorkflowStore(config("alpha"), PROJECT_A);

    expect(names()).toEqual(["alpha", "unsaved-edit"]);
  });

  it("replaces the config when the loader re-runs for a DIFFERENT project", () => {
    seedWorkflowStore(config("alpha"), PROJECT_A);
    addWorkflow(wf("unsaved-edit"));

    seedWorkflowStore(config("beta"), PROJECT_B);

    // Not ["alpha", "unsaved-edit"] — carrying those over is what wrote one project's
    // workflows into another project's maestro.json.
    expect(names()).toEqual(["beta"]);
    expect(workflowStore.state.projectRoot).toBe(PROJECT_B);
  });

  it("resets the selected workflow index on a project switch", () => {
    seedWorkflowStore(config("alpha", "second", "third"), PROJECT_A);
    setActiveWorkflowIdx(2);

    // The incoming project has one workflow; index 2 would point past the end and blank the canvas.
    seedWorkflowStore(config("beta"), PROJECT_B);

    expect(workflowStore.state.activeWorkflowIdx).toBe(0);
  });

  it("does not reset the selected workflow index on a same-project re-seed", () => {
    seedWorkflowStore(config("alpha", "second"), PROJECT_A);
    setActiveWorkflowIdx(1);

    seedWorkflowStore(config("alpha", "second"), PROJECT_A);

    expect(workflowStore.state.activeWorkflowIdx).toBe(1);
  });
});

// The user correcting the detected implementation chain rebuilds the whole starter graph, which
// is the one edit that legitimately throws the in-memory config away. It is also asynchronous —
// the seed is built in the main process — so it needs the same project guard as seeding does.
describe("replaceConfig", () => {
  it("replaces the config for the project it belongs to", () => {
    seedWorkflowStore(config("alpha"), PROJECT_A);

    replaceConfig(config("default", "tdd"), PROJECT_A);

    expect(names()).toEqual(["default", "tdd"]);
  });

  it("drops a re-seed that resolves after the user has switched projects", () => {
    seedWorkflowStore(config("alpha"), PROJECT_A);
    seedWorkflowStore(config("beta"), PROJECT_B);

    // In flight since before the switch: applying it now would put project A's starter graph on
    // project B's canvas, and Save would write it to B's maestro.json.
    replaceConfig(config("a-reseed"), PROJECT_A);

    expect(names()).toEqual(["beta"]);
  });

  it("clamps the selected workflow index to the incoming list", () => {
    seedWorkflowStore(config("one", "two", "three"), PROJECT_A);
    setActiveWorkflowIdx(2);

    replaceConfig(config("only"), PROJECT_A);

    expect(workflowStore.state.activeWorkflowIdx).toBe(0);
  });
});

// An outside edit (hand edit, /maestro-update) must reach a clean canvas, must NOT clobber a dirty
// one, and must not mistake our own save echoing back for an outside edit.
describe("reconcileWorkflowSlice", () => {
  const slice = (...n: string[]) => workflowSlice(config(...n));
  const stateOf = (canvas: string[], baseline: string[]): WorkflowEditState => ({
    config: config(...canvas),
    projectRoot: PROJECT_A,
    activeWorkflowIdx: 0,
    baseline: slice(...baseline),
    externalChange: false,
    externalSlice: null,
  });

  it("is a no-op when disk equals the baseline", () => {
    const s = stateOf(["a", "edit"], ["a"]);
    expect(reconcileWorkflowSlice(s, slice("a"))).toBe(s);
  });

  it("replaces config and baseline when the canvas is clean", () => {
    const s = stateOf(["a"], ["a"]);
    const next = reconcileWorkflowSlice(s, slice("a", "outside"));
    expect(next.config?.workflows.map((w) => w.name)).toEqual(["a", "outside"]);
    expect(next.baseline).toEqual(slice("a", "outside"));
    expect(next.externalChange).toBe(false);
  });

  it("keeps a dirty canvas and sets externalChange", () => {
    const s = stateOf(["a", "mine"], ["a"]);
    const next = reconcileWorkflowSlice(s, slice("a", "outside"));
    expect(next.config?.workflows.map((w) => w.name)).toEqual(["a", "mine"]);
    expect(next.baseline).toEqual(slice("a"));
    expect(next.externalChange).toBe(true);
  });

  it("recognises our own save echoing back: baseline set, flag cleared", () => {
    const s = { ...stateOf(["a", "mine"], ["a"]), externalChange: true };
    const next = reconcileWorkflowSlice(s, slice("a", "mine"));
    expect(next.baseline).toEqual(slice("a", "mine"));
    expect(next.externalChange).toBe(false);
    expect(next.config).toBe(s.config);
  });

  it("ignores rules and runtimeVersion changes (slice only)", () => {
    seedWorkflowStore(config("a"), PROJECT_A);
    const before = workflowStore.state;
    const outside = { ...config("a"), rules: [{ id: "x" }], runtimeVersion: "9.9.9" } as unknown as MaestroConfigV3;
    seedWorkflowStore(outside, PROJECT_A);
    expect(workflowStore.state).toBe(before);
  });

  it("seedWorkflowStore reconciles a same-project outside edit into a clean canvas", () => {
    seedWorkflowStore(config("a"), PROJECT_A);
    seedWorkflowStore(config("a", "outside"), PROJECT_A);
    expect(names()).toEqual(["a", "outside"]);
  });

  it("seedWorkflowStore flags an outside edit over unsaved edits", () => {
    seedWorkflowStore(config("a"), PROJECT_A);
    addWorkflow(wf("mine"));
    seedWorkflowStore(config("a", "outside"), PROJECT_A);
    expect(names()).toEqual(["a", "mine"]);
    expect(workflowStore.state.externalChange).toBe(true);
  });

  it("a project switch resets canvas, baseline and the flag", () => {
    seedWorkflowStore(config("a"), PROJECT_A);
    addWorkflow(wf("mine"));
    seedWorkflowStore(config("a", "outside"), PROJECT_A);
    seedWorkflowStore(config("beta"), PROJECT_B);
    expect(names()).toEqual(["beta"]);
    expect(workflowStore.state.externalChange).toBe(false);
    expect(workflowStore.state.baseline).toEqual(slice("beta"));
  });

  it("reloadFromDisk discards edits; keepMine keeps them and stops re-flagging the same disk state", () => {
    seedWorkflowStore(config("a"), PROJECT_A);
    addWorkflow(wf("mine"));
    seedWorkflowStore(config("a", "outside"), PROJECT_A);
    keepMine();
    expect(workflowStore.state.externalChange).toBe(false);
    seedWorkflowStore(config("a", "outside"), PROJECT_A);
    expect(workflowStore.state.externalChange).toBe(false);
    expect(names()).toEqual(["a", "mine"]);

    seedWorkflowStore(config("a", "outside2"), PROJECT_A);
    expect(workflowStore.state.externalChange).toBe(true);
    reloadFromDisk();
    expect(names()).toEqual(["a", "outside2"]);
    expect(workflowStore.state.externalChange).toBe(false);
  });

  it("markSaved sets the baseline so the save's echo is not an external change", () => {
    seedWorkflowStore(config("a"), PROJECT_A);
    addWorkflow(wf("mine"));
    markSaved(workflowSlice(workflowStore.state.config!), PROJECT_A);
    seedWorkflowStore(config("a", "mine"), PROJECT_A);
    expect(workflowStore.state.externalChange).toBe(false);
    expect(names()).toEqual(["a", "mine"]);
  });
});
