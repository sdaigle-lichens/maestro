// The whole save path, in one function.
//
// This is the point of the desktop migration. What used to be five steps spread across a web
// form, a /tmp result file, a blocking shell script, and Steps 2–5 of the /maestro-app skill —
// with a Claude session acting as the transport between them — is three ordinary function calls
// against the host filesystem:
//
//   1. merge the edited slice into maestro.json and write it
//   2. re-render the orchestrator's Maestro:HANDOFFS table from it
//   3. apply the rule assignments (move project rules, install vibe-rules ones)
//
// Nothing here needs an LLM, and nothing here ever did.

import { mergeSlice, readConfig, writeConfig, blankConfig, type ConfigSlice } from "./config.js";
import { renderOrchestrator } from "./render.js";
import { applyRules } from "./rules.js";
import type { SaveResult } from "./contracts.js";

export type { SaveResult };

export async function saveConfig(projectRoot: string, input: ConfigSlice): Promise<SaveResult> {
  const current = readConfig(projectRoot) ?? blankConfig();
  const config = mergeSlice(current, input);
  const configPath = writeConfig(projectRoot, config);

  const render = renderOrchestrator(projectRoot, config);
  const rules = await applyRules(projectRoot, config);

  const warnings: string[] = [];
  if (!render.ok && render.reason === "maestro/SKILL.md not found") {
    warnings.push(
      "Maestro is not installed in this project yet — the config was saved but no orchestrator skill exists to render into."
    );
  }
  if (rules.missing.length > 0) {
    warnings.push(`Rule file not found for: ${rules.missing.join(", ")}`);
  }
  for (const e of rules.errors) {
    warnings.push(`${e.id}: ${e.error}`);
  }

  return { configPath, config, render, rules, warnings };
}
