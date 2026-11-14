// The process spawns behind the /maestro page's Docker section (`181`): the daemon probe and the
// project's own launcher script (`.claude/scripts/maestro-worker-runtime.cjs`).
//
// The app never rebuilds the image or prunes by itself: it runs the same launcher command a user
// would (`image`, `prune --dry-run`), so the per-project lock, the image tag and the prune safety
// rules are the launcher's, not a second copy. Argument vectors only, no shell. Listed in the
// reviewed spawner allow-list in `test/isolation.test.ts`.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { DockerProbeResult } from "./worker-readiness.js";
import { WORKER_RUNTIME_SCRIPT } from "./worker-runtime.js";
import { mainCheckoutRoot } from "./worktree.js";

/** The outcome of one launcher run, as the page shows it. */
export interface WorkerLauncherResult {
  /** The launcher exited 0. */
  ok: boolean;
  /** Its exit code, or null when it never ran or was killed (not installed, timeout). */
  exitCode: number | null;
  /** What it printed (stdout then stderr), capped to its last `OUTPUT_CAP` characters. */
  output: string;
}

const OUTPUT_CAP = 20000;
const DOCKER_PROBE_TIMEOUT_MS = 8000;
/** A cold image build can take many minutes, and may first wait for another build's lock. */
const LAUNCHER_TIMEOUT_MS = 60 * 60 * 1000;

function tail(text: string): string {
  return text.length > OUTPUT_CAP ? `...${text.slice(text.length - OUTPUT_CAP)}` : text;
}

/** Ask the Docker daemon for its version: reachable only when `docker info` answers. */
export function probeDockerDaemon(): Promise<DockerProbeResult> {
  return new Promise((resolve) => {
    execFile(
      "docker",
      ["info", "--format", "{{.ServerVersion}}"],
      { timeout: DOCKER_PROBE_TIMEOUT_MS, encoding: "utf8" },
      (err, stdout, stderr) => {
        if (!err) return resolve({ reachable: true, detail: `Docker ${String(stdout).trim()}`.trim() });
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return resolve({ reachable: false, detail: "docker is not installed (not on PATH)" });
        const why =
          String(stderr || err.message)
            .trim()
            .split("\n")[0] ?? "";
        resolve({ reachable: false, detail: why || "the Docker daemon did not answer" });
      }
    );
  });
}

/** Path of the project's launcher script (in the main checkout). */
export function workerLauncherPath(projectRoot: string): string {
  return path.join(mainCheckoutRoot(projectRoot), WORKER_RUNTIME_SCRIPT);
}

/**
 * Run `maestro-worker-runtime.cjs <args>` for a project. Never rejects. A project without the script
 * gets `{ ok: false, exitCode: null }` and a sentence naming the fix.
 */
export function runWorkerLauncher(projectRoot: string, args: string[]): Promise<WorkerLauncherResult> {
  const root = mainCheckoutRoot(projectRoot);
  const script = workerLauncherPath(projectRoot);
  if (!fs.existsSync(script))
    return Promise.resolve({
      ok: false,
      exitCode: null,
      output: `The worker launcher is not installed in this project (${WORKER_RUNTIME_SCRIPT}). Re-run the Maestro install from this page, then try again.`,
    });
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [script, ...args],
      {
        cwd: root,
        timeout: LAUNCHER_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
        encoding: "utf8",
        // Inside Electron `process.execPath` is the app binary: run it as plain node.
        env: { ...process.env, CLAUDE_PROJECT_DIR: root, ELECTRON_RUN_AS_NODE: "1" },
      },
      (err, stdout, stderr) => {
        const output = tail(`${String(stdout)}${String(stderr)}`.trim());
        if (!err) return resolve({ ok: true, exitCode: 0, output });
        const code = (err as { code?: unknown }).code;
        resolve({ ok: false, exitCode: typeof code === "number" ? code : null, output: output || err.message });
      }
    );
  });
}

export function rebuildWorkerImage(projectRoot: string): Promise<WorkerLauncherResult> {
  return runWorkerLauncher(projectRoot, ["image"]);
}

export function pruneWorkerImagesDryRun(projectRoot: string): Promise<WorkerLauncherResult> {
  return runWorkerLauncher(projectRoot, ["prune", "--dry-run"]);
}
