import type { SessionLogEntry } from "../../../shared/ipc";

export type { SessionLogEntry };

/** The open project's absolute path — used to display log file paths relative to it. */
export async function getProjectCwd(): Promise<string> {
  return (await window.maestro.project.get()).current?.root ?? "";
}
