import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useProject } from "./project-context";
import { EMPTY_SKILL_REF_REPORT, getSkillRefReport, type DanglingSkillRef, type SkillRefReport } from "./maestro";

interface SkillRefContextValue {
  report: SkillRefReport;
  /** Look a skill id up in the report; undefined when it resolves (or the report is not loaded yet). */
  find(id: string): DanglingSkillRef | undefined;
  /** Re-read the report from the on-disk config. Resolves once the new report is in place. */
  refresh(): Promise<void>;
}

const SkillRefContext = createContext<SkillRefContextValue>({
  report: EMPTY_SKILL_REF_REPORT,
  find: () => undefined,
  refresh: async () => {},
});

/**
 * The open project's dangling skill references (`091`) — advisory, never blocking.
 *
 * The report is computed from the ON-DISK `maestro.json` and the installed/enabled plugins, so
 * unsaved canvas edits are not in it. It is re-read on a project switch, on every `config:changed`
 * (which covers this window's own saves and a hand edit), and on demand via `refresh()` — the
 * Recheck button, and the saves that call it directly instead of waiting for the ~1s watcher poll.
 * A late answer for a project that has since been left is dropped.
 */
export function SkillRefProvider({ children }: { children: React.ReactNode }) {
  const { current } = useProject();
  const root = current?.root ?? null;
  const [report, setReport] = useState<SkillRefReport>(EMPTY_SKILL_REF_REPORT);
  const rootRef = useRef(root);
  rootRef.current = root;

  const refresh = useCallback(async () => {
    const asked = rootRef.current;
    if (!asked) {
      setReport(EMPTY_SKILL_REF_REPORT);
      return;
    }
    const next = await getSkillRefReport();
    if (rootRef.current === asked) setReport(next);
  }, []);

  useEffect(() => {
    // Drop the previous project's marks immediately rather than showing them until the answer lands.
    setReport(EMPTY_SKILL_REF_REPORT);
    void refresh();
  }, [root, refresh]);

  useEffect(() => window.maestro.config.onChanged(() => void refresh()), [refresh]);

  // Installing or enabling a plugin in a terminal and coming back is the common case the config
  // watcher cannot see. Debounced so a focus + visibilitychange pair (or alt-tab churn) is one fetch.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onReturn = () => {
      if (document.visibilityState === "hidden") return;
      clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 300);
    };
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("focus", onReturn);
      document.removeEventListener("visibilitychange", onReturn);
    };
  }, [refresh]);

  const value = useMemo<SkillRefContextValue>(() => {
    const byId = new Map(report.dangling.map((d) => [d.id, d]));
    return { report, find: (id) => byId.get(id), refresh };
  }, [report, refresh]);

  return <SkillRefContext.Provider value={value}>{children}</SkillRefContext.Provider>;
}

export function useSkillRefs(): SkillRefContextValue {
  return useContext(SkillRefContext);
}
