// The project's full verification command (`170`): what `maestro-task-status.cjs merge` runs on
// the merged result, and how it words the outcome.
//
// Project-agnostic by construction: the command comes from the project, never from Maestro.
//
//   1. `verify_command` in `.claude/maestro.json` (a shell command line), when set;
//   2. otherwise DETECTED: a `verify` script in the root `package.json`, else a `test` script (npm's
//      `no test specified` placeholder does not count), run as `<manager> run <script>` with the
//      package manager the lockfile names (npm when there is none);
//   3. otherwise none, and the merge says the merged result is UNVERIFIED — it never claims a pass.
//
// `fs`/`path` only; nothing here runs the command (the CLI owns the spawn).

import fs from "node:fs";
import path from "node:path";
import { readJsonSafe, resolveConfiguredVerifyCommand } from "./config.js";
import type { MaestroConfigV3 } from "./types.js";
import { detectPackageManager } from "./worktree-deps.js";

export type VerifyCommand = { kind: "command"; command: string; source: string } | { kind: "none"; reason: string };

const NPM_PLACEHOLDER = /no test specified/i;

function readScripts(root: string): Record<string, unknown> | null {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as { scripts?: unknown };
    return pkg && typeof pkg.scripts === "object" && pkg.scripts !== null
      ? (pkg.scripts as Record<string, unknown>)
      : {};
  } catch {
    return null;
  }
}

/** The verification command for the project at `root` (see the header for the order). */
export function resolveVerifyCommand(root: string): VerifyCommand {
  const cfg = readJsonSafe<MaestroConfigV3>(path.join(root, ".claude", "maestro.json"));
  const configured = resolveConfiguredVerifyCommand(cfg);
  if (configured.kind === "set")
    return { kind: "command", command: configured.command, source: "verify_command in .claude/maestro.json" };
  if (configured.kind === "invalid")
    return { kind: "none", reason: "verify_command in .claude/maestro.json is blank or not a string" };

  const scripts = readScripts(root);
  if (scripts === null)
    return {
      kind: "none",
      reason: "no verify_command in .claude/maestro.json and no readable package.json to detect one from",
    };
  const script = ["verify", "test"].find(
    (s) => typeof scripts[s] === "string" && !NPM_PLACEHOLDER.test(scripts[s] as string)
  );
  if (!script)
    return {
      kind: "none",
      reason: "no verify_command in .claude/maestro.json and no verify or test script in package.json",
    };
  const pm = detectPackageManager(root);
  if (pm.kind === "ambiguous")
    return {
      kind: "none",
      reason: `package.json has a ${script} script but several lockfiles (${pm.lockfiles.join(", ")}) name different package managers; set verify_command in .claude/maestro.json`,
    };
  const manager = pm.kind === "detected" ? pm.manager : "npm";
  return { kind: "command", command: `${manager} run ${script}`, source: `the ${script} script in package.json` };
}

/**
 * The one verdict line `merge` prints after verifying. `exitCode` is the command's exit status
 * (`null` when it could not be started or was killed by a signal).
 */
export function formatVerifyResult(verify: VerifyCommand, exitCode: number | null): string {
  if (verify.kind === "none")
    return `VERIFY NOT CONFIGURED — the merged result is UNVERIFIED (${verify.reason}). Do not report it as passing.`;
  if (exitCode === 0) return `VERIFY PASSED — \`${verify.command}\` (${verify.source}) exited 0 on the merged result.`;
  return (
    `VERIFY FAILED (exit ${exitCode === null ? "none: the command did not run to completion" : exitCode}) — ` +
    `\`${verify.command}\` (${verify.source}) on the merged result. The merge is in place; fix the failure and verify again before reporting.`
  );
}
