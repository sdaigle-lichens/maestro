// `pnpm refresh:runtime` — bring this repo's own tracked Maestro runtime up to date after a plugin
// change. Dev-only; never shipped (it lives outside plugins/).
//
// Order matters and every step is idempotent, so a second run changes nothing:
//   1. build:plugin-libs      src/core/plugin-entries -> plugins/maestro/scripts/lib/*.cjs
//   2. maestro-install.js .   copies every runtimeAssets() file over its .claude/scripts mirror, syncs
//                             the STEPS and PRINCIPLES regions of .claude/skills/maestro/SKILL.md from
//                             the template, merges the hook registrations into .claude/settings.json
//   3. maestro-render-orchestrator.cjs .   re-renders the HANDOFFS table from .claude/maestro.json
//                             (the install keeps whatever table was there; this alone does NOT refresh
//                             STEPS, which is why it runs last, not instead)

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REFRESH_COMMAND = "pnpm refresh:runtime";

/** The ordered steps, as `{ label, command, args }` run from `root`. */
export function refreshSteps(root) {
  return [
    {
      label: "rebuild plugin libs",
      command: process.execPath,
      args: [path.join(root, "apps/maestro/scripts/build-plugin-libs.mjs")],
    },
    {
      label: "install runtime mirrors, orchestrator STEPS and settings hooks",
      command: process.execPath,
      args: [path.join(root, "plugins/maestro/scripts/maestro-install.js"), root],
    },
    {
      label: "render orchestrator HANDOFFS",
      command: process.execPath,
      args: [path.join(root, "plugins/maestro/scripts/maestro-render-orchestrator.cjs"), root],
    },
  ];
}

/** Runs the steps in order, stopping at the first failure. Returns the process exit code. */
export function refresh(root, run = spawnSync) {
  for (const step of refreshSteps(root)) {
    process.stdout.write(`refresh: ${step.label}\n`);
    const res = run(step.command, step.args, { cwd: root, stdio: "inherit" });
    if (res.status !== 0) {
      process.stderr.write(
        `refresh: "${step.label}" failed; later steps skipped. Fix it and re-run ${REFRESH_COMMAND}.\n`
      );
      return res.status ?? 1;
    }
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.exit(refresh(root));
}
