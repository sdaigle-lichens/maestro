import { Store } from "@tanstack/store";
import type { MaestroConfigV3, MaestroWorkflowV3, MaestroInstanceV3 } from "../utils/maestro";

/**
 * The part of maestro.json this view owns and compares. `rules` / `runtimeVersion` / everything
 * else is deliberately outside it, so a change to those alone never disturbs the canvas.
 */
export interface WorkflowSlice {
  agents_available: MaestroConfigV3["agents_available"];
  skills_available: MaestroConfigV3["skills_available"];
  workflow_instances: MaestroConfigV3["workflow_instances"];
  workflows: MaestroConfigV3["workflows"];
}

export interface WorkflowEditState {
  config: MaestroConfigV3 | null;
  /** Project the in-memory config belongs to. Loader data for any other project replaces it. */
  projectRoot: string | null;
  activeWorkflowIdx: number;
  /** The workflow slice as last known to be on disk. The canvas is "dirty" when it differs. */
  baseline: WorkflowSlice | null;
  /** The disk changed under unsaved canvas edits; the banner offers Reload / Keep mine. */
  externalChange: boolean;
  /** The disk slice that raised `externalChange`, so Reload / Keep mine need no re-read. */
  externalSlice: WorkflowSlice | null;
}

export const workflowStore = new Store<WorkflowEditState>({
  config: null,
  projectRoot: null,
  activeWorkflowIdx: 0,
  baseline: null,
  externalChange: false,
  externalSlice: null,
});

export function workflowSlice(config: MaestroConfigV3): WorkflowSlice {
  return {
    agents_available: config.agents_available,
    skills_available: config.skills_available,
    workflow_instances: config.workflow_instances,
    workflows: config.workflows,
  };
}

/** Structural equality, independent of object key order (disk-parsed vs canvas-built objects). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  const ka = Object.keys(a as object).filter((k) => (a as Record<string, unknown>)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as Record<string, unknown>)[k] !== undefined);
  return (
    ka.length === kb.length &&
    ka.every((k) => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
  );
}

/**
 * Fold the workflow slice currently on disk into the edit state. Pure; returns `state` itself on
 * a no-op.
 *
 * - disk == baseline: nothing changed on disk since we last looked — no-op.
 * - disk == canvas: our own save echoing back (or an outside edit that matches) — adopt as baseline.
 * - canvas clean (== baseline): take the disk slice, replacing config and baseline.
 * - canvas dirty: keep the edits and raise `externalChange`.
 */
export function reconcileWorkflowSlice(state: WorkflowEditState, diskSlice: WorkflowSlice): WorkflowEditState {
  if (!state.config) return state;
  const canvas = workflowSlice(state.config);
  if (state.baseline && deepEqual(diskSlice, state.baseline)) return state;
  if (deepEqual(diskSlice, canvas)) {
    return { ...state, baseline: diskSlice, externalChange: false, externalSlice: null };
  }
  if (!state.baseline || deepEqual(canvas, state.baseline)) {
    return {
      ...state,
      config: { ...state.config, ...diskSlice },
      baseline: diskSlice,
      activeWorkflowIdx: Math.min(state.activeWorkflowIdx, Math.max(0, diskSlice.workflows.length - 1)),
      externalChange: false,
      externalSlice: null,
    };
  }
  return { ...state, externalChange: true, externalSlice: diskSlice };
}

/** Banner "Reload from disk": discard the canvas edits and take the disk slice that was flagged. */
export function reloadFromDisk() {
  workflowStore.setState((s) => {
    if (!s.config || !s.externalSlice) return s;
    const disk = s.externalSlice;
    return {
      ...s,
      config: { ...s.config, ...disk },
      baseline: disk,
      activeWorkflowIdx: Math.min(s.activeWorkflowIdx, Math.max(0, disk.workflows.length - 1)),
      externalChange: false,
      externalSlice: null,
    };
  });
}

/**
 * Banner "Keep mine": clear the flag. The flagged disk slice becomes the baseline so the same disk
 * state does not re-flag on the next loader run; only a further disk change will. Save then
 * overwrites the workflow slice only.
 */
export function keepMine() {
  workflowStore.setState((s) => {
    if (!s.externalSlice) return { ...s, externalChange: false };
    return { ...s, baseline: s.externalSlice, externalChange: false, externalSlice: null };
  });
}

/** A successful Save: the slice we wrote is now what is on disk. */
export function markSaved(slice: WorkflowSlice, projectRoot: string) {
  workflowStore.setState((s) => {
    if (s.projectRoot !== projectRoot) return s;
    return { ...s, baseline: slice, externalChange: false, externalSlice: null };
  });
}

/**
 * Seed the store with loader data.
 *
 * Two cases, and they pull in opposite directions. Within one project the loader re-runs on every
 * invalidation, and reseeding there would throw away unsaved canvas edits — so the config is kept.
 * On a *project switch* the loader re-runs with a different project's config, and keeping the old
 * one is not a stale-render nuisance but data loss: the canvas keeps showing project A while the
 * window is on project B, and pressing Save writes A's workflows into B's maestro.json. The
 * project root is what tells the two apart; guarding on `config !== null` alone cannot.
 *
 * Within one project the loader data is reconciled against the baseline (`reconcileWorkflowSlice`)
 * so an outside edit to maestro.json reaches a clean canvas, or raises `externalChange` on a dirty one.
 *
 * `activeWorkflowIdx` resets on a switch because it indexes the outgoing project's workflow list —
 * carried over, it can point past the end of the incoming one and blank the canvas.
 */
export function seedWorkflowStore(config: MaestroConfigV3, projectRoot: string) {
  const s = workflowStore.state;
  if (s.config !== null && s.projectRoot === projectRoot) {
    // Same project: never reseed (that would discard edits), but fold in what is on disk now.
    const next = reconcileWorkflowSlice(s, workflowSlice(config));
    if (next !== s) workflowStore.setState(() => next);
    return;
  }
  workflowStore.setState((prev) => ({
    ...prev,
    config,
    projectRoot,
    activeWorkflowIdx: 0,
    baseline: workflowSlice(config),
    externalChange: false,
    externalSlice: null,
  }));
}

/**
 * Replace the whole config — the user amending the detected implementation chain, which re-seeds
 * every starter workflow around the agents they chose.
 *
 * Unlike `seedWorkflowStore` this is unconditional, because the caller is the edit itself rather
 * than a loader that may be re-running mid-edit. It still takes the project root and drops the
 * write when it no longer matches: a re-seed is an async round trip to the main process, and one
 * in flight while the user switches projects would otherwise land project A's starter graph in
 * project B's canvas — the same failure `seedWorkflowStore`'s guard exists to prevent.
 */
export function replaceConfig(config: MaestroConfigV3, projectRoot: string) {
  workflowStore.setState((s) => {
    if (s.projectRoot !== projectRoot) return s;
    return {
      ...s,
      config,
      activeWorkflowIdx: Math.min(s.activeWorkflowIdx, Math.max(0, config.workflows.length - 1)),
    };
  });
}

export function setActiveWorkflowIdx(idx: number) {
  workflowStore.setState((s) => ({ ...s, activeWorkflowIdx: idx }));
}

export function setAgentsAvailable(ids: string[]) {
  workflowStore.setState((s) => {
    if (!s.config) return s;
    return { ...s, config: { ...s.config, agents_available: ids } };
  });
}

export function setSkillsAvailable(ids: string[]) {
  workflowStore.setState((s) => {
    if (!s.config) return s;
    return { ...s, config: { ...s.config, skills_available: ids } };
  });
}

export function setInstances(instances: MaestroInstanceV3[]) {
  workflowStore.setState((s) => {
    if (!s.config) return s;
    return { ...s, config: { ...s.config, workflow_instances: instances } };
  });
}

export function updateWorkflow(idx: number, wf: MaestroWorkflowV3) {
  workflowStore.setState((s) => {
    if (!s.config) return s;
    const next = [...s.config.workflows];
    next[idx] = wf;
    return { ...s, config: { ...s.config, workflows: next } };
  });
}

export function renameWorkflow(idx: number, name: string) {
  workflowStore.setState((s) => {
    if (!s.config) return s;
    const next = [...s.config.workflows];
    next[idx] = { ...next[idx], name };
    return { ...s, config: { ...s.config, workflows: next } };
  });
}

export function removeWorkflow(idx: number) {
  workflowStore.setState((s) => {
    if (!s.config) return s;
    const next = s.config.workflows.filter((_, i) => i !== idx);
    return {
      ...s,
      config: { ...s.config, workflows: next },
      activeWorkflowIdx: Math.max(0, s.activeWorkflowIdx >= idx ? s.activeWorkflowIdx - 1 : s.activeWorkflowIdx),
    };
  });
}

export function addWorkflow(wf: MaestroWorkflowV3) {
  workflowStore.setState((s) => {
    if (!s.config) return s;
    const next = [...s.config.workflows, wf];
    return {
      ...s,
      config: { ...s.config, workflows: next },
      activeWorkflowIdx: next.length - 1,
    };
  });
}
