import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { callMain, type CallResult } from "./call-main";
import { useProject } from "./project-context";
import type { InstallReport, InstallStatus, UninstallPlan, UninstallReport } from "../../../shared/ipc";

interface InstallContextValue {
  /** null until the first status lands, and whenever no project is open. */
  status: InstallStatus | null;
  /** Set when the status call itself failed — the badge stays silent, /install explains. */
  error: string | null;
  refresh(): Promise<void>;
  install(): Promise<CallResult<InstallReport>>;
  /** What each level of an uninstall would remove. Reads only; deletes nothing. */
  uninstallPlan(): Promise<CallResult<UninstallPlan>>;
  /**
   * Remove the runtime. `purge` is a required argument, not an option with a default: every call
   * site has to state which of the two levels it means, and the destructive one cannot be reached
   * by leaving something out. `deleteMaestroTasks` is a second, independent opt-in — it only takes
   * effect together with `purge: true` — for `.claude/maestro-tasks/`, the user-authored task
   * queue, which a purge alone must never take.
   */
  uninstall(purge: boolean, deleteMaestroTasks?: boolean): Promise<CallResult<UninstallReport>>;
}

const noProject = { ok: false, error: "No project is open." } as const;

const InstallContext = createContext<InstallContextValue>({
  status: null,
  error: null,
  refresh: async () => {},
  install: async () => noProject,
  uninstallPlan: async () => noProject,
  uninstall: async () => noProject,
});

/**
 * The open project's Maestro install status, app-wide.
 *
 * App-wide rather than owned by /install because the staleness badge belongs in `TopNav`: a
 * project running an older runtime than the app ships is exactly the thing a user never goes
 * looking for, so it has to be visible from whatever route they are already on.
 *
 * Refetched on every project switch — `current.root` is the dependency, so opening a different
 * repo cannot leave the previous one's badge on screen.
 */
export function InstallProvider({ children }: { children: React.ReactNode }) {
  const { current } = useProject();
  const root = current?.root ?? null;
  const [status, setStatus] = useState<InstallStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!root) {
      setStatus(null);
      setError(null);
      return;
    }
    const res = await callMain(() => window.maestro.install.status());
    if (res.ok) {
      setStatus(res.value);
      setError(null);
    } else {
      setStatus(null);
      setError(res.error);
    }
  }, [root]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /**
   * Run the install, then refresh. The result is handed back rather than toasted here: the
   * /install route reports what changed on disk in detail, and a toast would say it twice.
   */
  const install = useCallback(async (): Promise<CallResult<InstallReport>> => {
    const res = await callMain(() => window.maestro.install.run());
    if (res.ok) setStatus(res.value.status);
    else await refresh(); // a failed install may still have changed the picture (or nothing at all)
    return res;
  }, [refresh]);

  const uninstallPlan = useCallback(async (): Promise<CallResult<UninstallPlan>> => {
    return callMain(() => window.maestro.install.uninstallPlan());
  }, []);

  const uninstall = useCallback(
    async (purge: boolean, deleteMaestroTasks?: boolean): Promise<CallResult<UninstallReport>> => {
      const res = await callMain(() => window.maestro.install.uninstall({ purge, deleteMaestroTasks }));
      if (res.ok) setStatus(res.value.status);
      else await refresh();
      return res;
    },
    [refresh]
  );

  return (
    <InstallContext.Provider value={{ status, error, refresh, install, uninstallPlan, uninstall }}>
      {children}
    </InstallContext.Provider>
  );
}

export function useInstall(): InstallContextValue {
  return useContext(InstallContext);
}

/** What the TopNav badge shows: nothing, "not installed", or "update available". */
export function installBadge(status: InstallStatus | null): "none" | "missing" | "stale" {
  if (!status) return "none";
  if (!status.installed) return "missing";
  return status.stale ? "stale" : "none";
}
