import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import { usePanelResize, PanelResizeHandle } from "@repo/ui/resizable-panel";
import TopNav from "../components/top-nav";
import SessionLogCards from "../components/session-log-cards";
import SessionLogView from "../components/session-log-view";
import SessionLogDetail from "../components/session-log-detail";
import SessionLogTabs from "../components/session-log-tabs";
import { useSessionLog, sessionKey, pickSelection } from "../utils/session-log-context";
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
            onClose={dismiss}
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
