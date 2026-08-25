import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import { usePanelResize, PanelResizeHandle } from "@repo/ui/resizable-panel";
import TopNav from "../components/top-nav";
import SessionLogCards from "../components/session-log-cards";
import SessionLogView from "../components/session-log-view";
import SessionLogDetail from "../components/session-log-detail";
import { useSessionLog } from "../utils/session-log-context";
import { buildInstances } from "../utils/session-log";
import { getProjectCwd } from "../utils/maestro-session-log";

export const Route = createFileRoute("/session-log")({
  loader: async () => ({ cwd: await getProjectCwd() }),
  component: SessionLogPage,
});

function SessionLogPage() {
  const { cwd } = Route.useLoaderData();
  const { entries, connected } = useSessionLog();
  const [activeId, setActiveId] = useState<number | null>(null);
  const sectionRefs = useRef<Record<number, HTMLDivElement | null>>({});

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

  const instances = useMemo(() => buildInstances(entries), [entries]);

  const handleSelect = (id: number) => {
    setActiveId(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const activeInstance = instances.find((inst) => inst.id === activeId) ?? null;

  const isEmpty = entries.length === 0;

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
            <p className="text-[13px] font-medium text-(--ink) mb-1">No session log found</p>
            <p className="text-[12px] text-(--ink-3) max-w-xs">
              The log appears while an Maestro session is running and is cleared when it ends.
            </p>
          </div>
          {/* Live connection indicator in empty state */}
          <div className={`flex items-center gap-1.5 text-[11px] ${connected ? "text-(--green)" : "text-(--ink-3)"}`}>
            <span className="text-[8px]">{connected ? "●" : "○"}</span>
            {connected ? "live" : "connecting…"}
          </div>
        </div>
      ) : (
        /* Three-pane layout — left & right panes are drag-resizable */
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
      )}
    </div>
  );
}
