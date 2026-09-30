import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import { toast } from "@repo/ui/toast";
import { usePanelResize, PanelResizeHandle } from "@repo/ui/resizable-panel";
import TopNav from "../components/top-nav";
import SessionLogCards from "../components/session-log-cards";
import SessionLogView from "../components/session-log-view";
import SessionLogDetail from "../components/session-log-detail";
import CleanSessionsButton from "../components/clean-sessions-button";
import SessionLogTabs from "../components/session-log-tabs";
import { useSessionLog, sessionKey, pickSelection } from "../utils/session-log-context";
import { callMain } from "../utils/call-main";
import { buildInstances } from "../utils/session-log";
import type { ProjectState } from "../../../shared/ipc";

export const Route = createFileRoute("/session-log")({
  loader: async () => ({ projectState: await window.maestro.project.get() }),
  component: SessionLogPage,
});

function SessionLogPage() {
  const { projectState: initialProjectState } = Route.useLoaderData();
  const { sessions, connected, dismiss } = useSessionLog();
  const [projectState, setProjectState] = useState<ProjectState>(initialProjectState);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [activeId, setActiveId] = useState<number | null>(null);
  const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({});

  // Recent/current project list can change (open, forget) while this route stays mounted — keep
  // the tab groups' names and membership current. Session tracking itself doesn't depend on this:
  // a forgotten project's sessions are dropped via the tail's own wholesale `onReset`, not by
  // reacting to this event.
  useEffect(() => window.maestro.project.onChanged(setProjectState), []);

  /**
   * Sessions whose directory `sessions.delete` would accept (idle past the running window). A
   * crashed session never emits `onEnd`, so its tab stays "live" here; this list is what lets it
   * show the x anyway. Re-queried on mount, every 30s, and after each delete.
   */
  const [deletable, setDeletable] = useState<Set<string>>(new Set());
  const refreshDeletable = useCallback(async () => {
    const res = await callMain(() => window.maestro.sessions.deletable());
    // A failed query just keeps the previous list; the ended-status x still works.
    if (res.ok) setDeletable(new Set(res.value.map(sessionKey)));
  }, []);
  useEffect(() => {
    void refreshDeletable();
    const timer = setInterval(() => void refreshDeletable(), 30_000);
    return () => clearInterval(timer);
  }, [refreshDeletable]);

  /**
   * Backend titles (maestro task name, else `claude --resume` title), keyed like `sessionKey`.
   * Re-queried when the session set changes and every 30s, since AI titles appear mid-session. A
   * failed or partial answer leaves tabs on their derived fallback title.
   */
  const [titles, setTitles] = useState<Record<string, string | null>>({});
  const refsKey = useMemo(() => sessions.map(sessionKey).sort().join("\n"), [sessions]);
  const refsRef = useRef<{ projectRoot: string; sessionId: string }[]>([]);
  refsRef.current = sessions.map((s) => ({ projectRoot: s.projectRoot, sessionId: s.sessionId }));
  const refreshTitles = useCallback(async () => {
    if (refsRef.current.length === 0) return;
    const res = await callMain(() => window.maestro.sessions.titles(refsRef.current));
    if (res.ok) setTitles(res.value);
  }, []);
  useEffect(() => {
    void refreshTitles();
  }, [refsKey, refreshTitles]);
  useEffect(() => {
    const timer = setInterval(() => void refreshTitles(), 30_000);
    return () => clearInterval(timer);
  }, [refreshTitles]);

  const handleDelete = async (projectRoot: string, sessionId: string): Promise<void> => {
    // The backend accepts anything idle >15 min, which includes a session parked on a long human
    // review. An ended tab is certainly over; anything else gets a confirm first.
    const record = sessions.find((s) => sessionKey(s) === sessionKey({ projectRoot, sessionId }));
    if (
      record?.status !== "ended" &&
      !window.confirm(
        "Delete this session's directory? It has been idle for a while but may still be waiting for input (for example a human review). Deleting it cannot be undone."
      )
    ) {
      return;
    }
    const res = await callMain(() => window.maestro.sessions.delete(projectRoot, sessionId));
    if (!res.ok) {
      toast(<>Could not delete session: {res.error}</>, { variant: "error" });
    } else if (!res.value.removed) {
      const reason = res.value.reason;
      if (reason === "not-found") {
        dismiss(projectRoot, sessionId); // already gone from disk - just drop the tab
      } else {
        const why = {
          running: "it is still running",
          "own-session": "it is this app's own session",
          invalid: "its id is invalid",
          failed: "the directory could not be removed",
        }[reason];
        toast(`Session not deleted: ${why}`, { variant: "error" });
      }
    }
    // On success main resets the tails and the tab drops via the normal reset/init burst.
    void refreshDeletable();
  };

  const gridRef = useRef<HTMLDivElement>(null);
  const left = usePanelResize({
    initial: 180,
    min: 140,
    max: 400,
    side: "right",
    cssVar: "--log-left-w",
    containerRef: gridRef,
  });
  const right = usePanelResize({
    initial: 320,
    min: 240,
    max: 1120,
    side: "left",
    cssVar: "--log-right-w",
    containerRef: gridRef,
  });

  // Stable selection: re-pick ONLY when the current selection no longer names a tracked session
  // (evicted by the ended-tab cap, closed by the user, or wiped by a wholesale reset). A tab
  // appearing, or the selected tab itself ending, must never move the selection. The actual rule
  // lives in `pickSelection` (session-log-context.tsx) so it's unit-testable on its own.
  useEffect(() => {
    const next = pickSelection(sessions, selectedKey);
    if (next !== selectedKey) setSelectedKey(next);
  }, [sessions, selectedKey]);

  const selected = sessions.find((s) => sessionKey(s) === selectedKey) ?? null;
  const instances = useMemo(() => (selected ? buildInstances(selected.entries) : []), [selected]);

  const handleSelectTab = (key: string): void => {
    setSelectedKey(key);
    setActiveId(null);
  };

  const handleSelect = (id: number): void => {
    setActiveId(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const activeInstance = instances.find((inst) => inst.id === activeId) ?? null;

  const isEmpty = sessions.length === 0;
  // The selected session's OWN project, not necessarily the currently-open one — a tab can belong
  // to any recent project, and paths in its log should relativize against where it actually ran.
  const cwd = selected?.projectRoot ?? projectState.current?.root ?? "";

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) overflow-hidden flex flex-col">
      <TopNav />

      <div className="shrink-0 flex items-center justify-end px-3 py-1.5 border-b border-(--line)">
        <CleanSessionsButton />
      </div>

      {isEmpty ? (
        /* Empty state */
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
          <div className="w-12 h-12 rounded-full bg-(--bg-elev) border border-(--line) flex items-center justify-center">
            <ScrollText size={20} className="text-(--ink-3)" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-(--ink) mb-1">No live sessions in any known project</p>
            <p className="text-[12px] text-(--ink-3) max-w-xs">
              A tab appears here while a Maestro session is running, in this project or a recent one.
            </p>
          </div>
          {/* Live connection indicator in empty state */}
          <div className={`flex items-center gap-1.5 text-[11px] ${connected ? "text-(--green)" : "text-(--ink-3)"}`}>
            <span className="text-[8px]">{connected ? "●" : "○"}</span>
            {connected ? "live" : "connecting…"}
          </div>
        </div>
      ) : (
        <>
          <SessionLogTabs
            sessions={sessions}
            projectState={projectState}
            selectedKey={selectedKey}
            onSelect={handleSelectTab}
            deletable={deletable}
            titles={titles}
            onDelete={(root, id) => void handleDelete(root, id)}
          />

          {/* Three-pane layout — left & right panes are drag-resizable */}
          <div
            ref={gridRef}
            className="relative flex-1 grid overflow-hidden"
            style={{
              gridTemplateColumns: "var(--log-left-w) 1fr var(--log-right-w)",
              ...left.style,
              ...right.style,
            }}
          >
            <SessionLogCards instances={instances} activeId={activeId} onSelect={handleSelect} />
            <SessionLogView
              instances={instances}
              activeId={activeId}
              onSelect={handleSelect}
              sectionRefs={sectionRefs}
              connected={connected}
              cwd={cwd}
            />
            <SessionLogDetail instance={activeInstance} cwd={cwd} />

            {/* resize handles overlaid on the pane borders */}
            <PanelResizeHandle
              onResizeStart={left.onResizeStart}
              className="absolute top-0 bottom-0 z-10"
              style={{ left: "var(--log-left-w)", marginLeft: "-3px" }}
            />
            <PanelResizeHandle
              onResizeStart={right.onResizeStart}
              className="absolute top-0 bottom-0 z-10"
              style={{ right: "var(--log-right-w)", marginRight: "-3px" }}
            />
          </div>
        </>
      )}
    </div>
  );
}
