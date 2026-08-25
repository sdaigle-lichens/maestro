import { Store } from "@tanstack/store";
import type { MaestroConfigV3, MaestroWorkflowV3, MaestroInstanceV3 } from "../utils/maestro";

export interface WorkflowEditState {
  config: MaestroConfigV3 | null;
  /** Project the in-memory config belongs to. Loader data for any other project replaces it. */
  projectRoot: string | null;
  activeWorkflowIdx: number;
}

export const workflowStore = new Store<WorkflowEditState>({
  config: null,
  projectRoot: null,
  activeWorkflowIdx: 0,
});

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
 * `activeWorkflowIdx` resets on a switch because it indexes the outgoing project's workflow list —
 * carried over, it can point past the end of the incoming one and blank the canvas.
 */
export function seedWorkflowStore(config: MaestroConfigV3, projectRoot: string) {
  const s = workflowStore.state;
  if (s.config !== null && s.projectRoot === projectRoot) return;
  workflowStore.setState((prev) => ({ ...prev, config, projectRoot, activeWorkflowIdx: 0 }));
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
