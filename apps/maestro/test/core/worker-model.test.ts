// `134`: the optional `worker_model` setting — its reader, its slice merge and the launch command.

import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { saveConfig } from "../../src/core/save.js";
import { blankConfig, mergeSlice, readConfig, resolveWorkerModel, writeConfig } from "../../src/core/config.js";
import { launchCommandFor } from "../../src/core/epics.js";
import type { MaestroConfigV3 } from "../../src/core/types.js";

describe("launchCommandFor (134)", () => {
  it("is unchanged when no model is given", () => {
    const expected = "claude -n 'e-001' '/maestro .claude/maestro-tasks/001-a.md'";
    expect(launchCommandFor("e-001", "001-a.md")).toBe(expected);
    expect(launchCommandFor("e-001", "001-a.md", undefined)).toBe(expected);
    expect(launchCommandFor("e-001", "001-a.md", "  ")).toBe(expected);
  });

  it("adds --model before the prompt when set", () => {
    expect(launchCommandFor("e-001", "001-a.md", "sonnet")).toBe(
      "claude -n 'e-001' --model 'sonnet' '/maestro .claude/maestro-tasks/001-a.md'"
    );
  });

  it("quotes shell-special characters", () => {
    expect(launchCommandFor("e-001", "001-a.md", "a b$(x)'`;")).toBe(
      "claude -n 'e-001' --model 'a b$(x)'\\''`;' '/maestro .claude/maestro-tasks/001-a.md'"
    );
  });
});

describe("resolveWorkerModel (134)", () => {
  const cfg = (worker_model: unknown) => ({ ...blankConfig(), worker_model }) as MaestroConfigV3;

  it("returns the trimmed string and undefined for everything else", () => {
    expect(resolveWorkerModel(cfg(" opus "))).toBe("opus");
    expect(resolveWorkerModel(cfg(""))).toBeUndefined();
    expect(resolveWorkerModel(cfg("   "))).toBeUndefined();
    expect(resolveWorkerModel(cfg(42))).toBeUndefined();
    expect(resolveWorkerModel(cfg(null))).toBeUndefined();
    expect(resolveWorkerModel(blankConfig())).toBeUndefined();
    expect(resolveWorkerModel(null)).toBeUndefined();
  });
});

describe("worker_model save and reload on disk (134)", () => {
  const roots: string[] = [];
  const mk = () => {
    const r = fs.mkdtempSync(path.join(os.tmpdir(), "wm134-"));
    roots.push(r);
    return r;
  };
  afterEach(() => {
    for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
  });

  it("survives saveConfig, a reload, and a later save of another slice; blank removes the key", async () => {
    const root = mk();
    writeConfig(root, blankConfig());
    await saveConfig(root, { sliceType: "worker-model", slice: { worker_model: "claude-opus-4-1[1m]" } });
    expect(JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8")).worker_model).toBe(
      "claude-opus-4-1[1m]"
    );
    expect(resolveWorkerModel(readConfig(root))).toBe("claude-opus-4-1[1m]");

    await saveConfig(root, { sliceType: "workflows", slice: { workflow_instances: [], workflows: [] } });
    await saveConfig(root, { sliceType: "task-routing", slice: { use_maestro_tasks: true } });
    expect(resolveWorkerModel(readConfig(root))).toBe("claude-opus-4-1[1m]");

    await saveConfig(root, { sliceType: "worker-model", slice: { worker_model: "   " } });
    const raw = JSON.parse(fs.readFileSync(path.join(root, ".claude", "maestro.json"), "utf8"));
    expect("worker_model" in raw).toBe(false);
    expect(raw.use_maestro_tasks).toBe(true);
  });
});

describe("mergeSlice worker-model (134)", () => {
  it("sets, replaces and clears only worker_model", () => {
    const base = { ...blankConfig(), use_maestro_tasks: true };
    const set = mergeSlice(base, { sliceType: "worker-model", slice: { worker_model: " sonnet " } });
    expect(set.worker_model).toBe("sonnet");
    expect(set.use_maestro_tasks).toBe(true);
    const cleared = mergeSlice(set, { sliceType: "worker-model", slice: { worker_model: "" } });
    expect("worker_model" in cleared).toBe(false);
    expect(cleared.use_maestro_tasks).toBe(true);
  });

  it("other slices leave worker_model alone", () => {
    const base = { ...blankConfig(), worker_model: "haiku" };
    expect(mergeSlice(base, { sliceType: "task-routing", slice: { use_maestro_tasks: true } }).worker_model).toBe(
      "haiku"
    );
  });
});
