import type { SessionLogEntry, ChannelDelivery } from "../../../shared/ipc";

export type { SessionLogEntry, ChannelDelivery };

/** The open project's absolute path — used to display log file paths relative to it. */
export async function getProjectCwd(): Promise<string> {
  return (await window.maestro.project.get()).current?.root ?? "";
}
