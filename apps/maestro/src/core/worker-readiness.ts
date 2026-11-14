// Docker-worker readiness for the /maestro page (`181`): is the Docker daemon reachable, and does
// the worker token file exist.
//
// Computed in the MAIN process from this module, never in the renderer. The token check is
// existence only: the file is `stat`ed, never opened, so its contents cannot reach a log, an IPC
// payload or the page. The daemon probe is injected (this module imports no `child_process`; the
// spawn lives in `worker-launcher.ts`), which is also how the "daemon down" case is tested.

import fs from "node:fs";
import path from "node:path";
import { WORKER_TOKEN_REL } from "./worker-runtime.js";

export interface DockerProbeResult {
  reachable: boolean;
  /** One short line for the page: why it is not reachable, or the server version when it is. */
  detail: string;
}

export interface WorkerReadiness {
  docker: DockerProbeResult;
  token: {
    exists: boolean;
    /** Where the launcher looks for the token file. A path, never the token. */
    path: string;
  };
}

/** Where the launcher reads the worker token, for a given home. */
export function workerTokenPath(home: string): string {
  return path.join(home, WORKER_TOKEN_REL);
}

/** Does the token file exist as a file? `stat` only: the contents are never read. */
export function workerTokenExists(home: string): boolean {
  try {
    return fs.statSync(workerTokenPath(home)).isFile();
  } catch {
    return false;
  }
}

/** Both readiness lines. A probe that throws is "not reachable", never a rejection. */
export async function computeWorkerReadiness(input: {
  home: string;
  probeDocker: () => Promise<DockerProbeResult>;
}): Promise<WorkerReadiness> {
  let docker: DockerProbeResult;
  try {
    docker = await input.probeDocker();
  } catch (err) {
    docker = { reachable: false, detail: err instanceof Error ? err.message.split("\n")[0]! : "docker check failed" };
  }
  return { docker, token: { exists: workerTokenExists(input.home), path: workerTokenPath(input.home) } };
}
