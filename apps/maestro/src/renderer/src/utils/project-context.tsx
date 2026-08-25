import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useRouter } from "@tanstack/react-router";
import { toast } from "@repo/ui/toast";
import { callMain } from "./call-main";
import type { ProjectRef, ProjectState } from "../../../shared/ipc";

interface ProjectContextValue extends ProjectState {
  /**
   * Open the native directory picker. Resolves to the newly-opened project, or `null` if the
   * user cancelled or the call failed — `ProjectSelect`'s "Open another project…" row uses the
   * value to follow a caller's locally-held `viewedRoot` onto whatever was just opened.
   */
  pick(): Promise<ProjectRef | null>;
  open(root: string): Promise<void>;
  forget(root: string): Promise<void>;
}

const noop = async () => {};
const pickNoop = async (): Promise<ProjectRef | null> => null;

const ProjectContext = createContext<ProjectContextValue>({
  current: null,
  recent: [],
  pick: pickNoop,
  open: noop,
  forget: noop,
});

/**
 * The open project, app-wide.
 *
 * This is the desktop replacement for `readCwd()`. In the web app the working directory was
 * fixed for the life of the container and recovered from a precompute file; here the user can
 * switch projects at any time, so every route's loader has to re-run when they do — hence the
 * router.invalidate() below.
 */
export function ProjectProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ProjectState>({ current: null, recent: [] });
  const router = useRouter();

  useEffect(() => {
    void window.maestro.project.get().then(setState);
    // The main process broadcasts on every switch, including ones initiated from another window.
    return window.maestro.project.onChanged((next) => {
      setState(next);
      void router.invalidate();
    });
  }, [router]);

  /**
   * Apply a project mutation, or surface why it failed. These write projects.json in the app's
   * userData dir and open a native dialog, both of which can fail — and a project switch that
   * silently does nothing is the most confusing failure the app has, since every route's data
   * then belongs to the wrong repo.
   */
  const apply = useCallback(async (what: string, op: () => Promise<ProjectState | null>) => {
    const res = await callMain(op);
    if (!res.ok) {
      toast(
        <>
          Could not {what}: {res.error}
        </>,
        { variant: "error" }
      );
      return;
    }
    // null is the user cancelling the picker, not a failure.
    if (res.value) setState(res.value);
  }, []);

  const pick = useCallback(async (): Promise<ProjectRef | null> => {
    const res = await callMain(() => window.maestro.project.pick());
    if (!res.ok) {
      toast(<>Could not open the project: {res.error}</>, { variant: "error" });
      return null;
    }
    // null is the user cancelling the picker, not a failure.
    if (res.value) setState(res.value);
    return res.value?.current ?? null;
  }, []);

  const open = useCallback(
    (root: string) => apply("open that project", () => window.maestro.project.open(root)),
    [apply]
  );

  const forget = useCallback(
    (root: string) => apply("forget that project", () => window.maestro.project.forget(root)),
    [apply]
  );

  return <ProjectContext.Provider value={{ ...state, pick, open, forget }}>{children}</ProjectContext.Provider>;
}

export function useProject(): ProjectContextValue {
  return useContext(ProjectContext);
}

export type { ProjectRef, ProjectState };
