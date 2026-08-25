// Re-renders the generated region of the project's Maestro orchestrator skill
// (.claude/skills/maestro/SKILL.md) from .claude/maestro.json:
//   - the <!-- Maestro:HANDOFFS --> table  ← workflows + derived success paths
//
// PORTED FROM plugins/maestro/scripts/maestro-render-orchestrator.cjs.
//
// This used to be Step 3 of the /maestro-app skill — a Claude session shelling out to `node`
// purely because the containerised app couldn't reach the host filesystem. It is pure I/O and
// now runs in the desktop app's main process as part of a save.

import fs from "node:fs";
import path from "node:path";
import { successPathSteps } from "./success-path.js";
import { replaceRegion } from "./skill-regions.js";
import { readConfig } from "./config.js";
import type { MaestroConfigV3, MaestroInstanceV3, MaestroWorkflowV3 } from "./types.js";

import type { RenderResult } from "./contracts.js";
export type { RenderResult };

export function orchestratorSkillPath(projectRoot: string): string {
  return path.join(projectRoot, ".claude", "skills", "maestro", "SKILL.md");
}

/**
 * Derived success path for one workflow, joined into the " → " display form used by the
 * Maestro:HANDOFFS table. The walk itself lives in ./success-path.ts (shared with the
 * injection and validation hooks).
 */
export function successPath(wf: MaestroWorkflowV3, instances: MaestroInstanceV3[]): string {
  return successPathSteps(wf, instances).join(" → ");
}

export function handoffTable(cfg: Pick<MaestroConfigV3, "workflow_instances" | "workflows">): string {
  const instances = cfg.workflow_instances ?? [];
  const workflows = cfg.workflows ?? [];
  if (workflows.length === 0) {
    return "# No workflows configured yet. Run /maestro-install to set up.";
  }
  const rows = workflows.map((wf) => {
    const sp = successPath(wf, instances) || "(no steps configured)";
    return `| ${wf.name || "unnamed"} | ${sp} |`;
  });
  return ["| Workflow | Success path |", "| --- | --- |", ...rows].join("\n");
}

/**
 * Rewrite the HANDOFFS region of the project's orchestrator skill from its maestro.json.
 * Everything else in the file (custom orchestration prose) is preserved.
 */
export function renderOrchestrator(projectRoot: string, cfg?: MaestroConfigV3): RenderResult {
  const config = cfg ?? readConfig(projectRoot);
  if (!config) return { ok: false, reason: "maestro.json not found", rows: [] };

  const skillPath = orchestratorSkillPath(projectRoot);
  if (!fs.existsSync(skillPath)) return { ok: false, reason: "maestro/SKILL.md not found", rows: [] };

  const text = fs.readFileSync(skillPath, "utf8");
  fs.writeFileSync(skillPath, replaceRegion(text, "HANDOFFS", handoffTable(config)));

  const instances = config.workflow_instances ?? [];
  return {
    ok: true,
    rows: (config.workflows ?? []).map((wf) => ({
      workflow: wf.name || "unnamed",
      successPath: successPath(wf, instances) || "(no steps configured)",
    })),
  };
}
