import type { MaestroTask } from "../../../shared/ipc";

export type { MaestroTask };
export type TaskStatus = MaestroTask["status"];

export function getMaestroTasks(): Promise<MaestroTask[]> {
  return window.maestro.tasks.list();
}

/**
 * Mark a task done. Returns the full recomputed list: closing a task can flip its dependents
 * from blocked to ready, so the caller replaces its state rather than patching one row.
 */
export function closeMaestroTask({ data }: { data: { filename: string } }): Promise<MaestroTask[]> {
  return window.maestro.tasks.close(data.filename);
}
