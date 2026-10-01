import { useEffect, useMemo, useRef, useState } from "react";
import { usePanelResize, PanelResizeHandle } from "@repo/ui/resizable-panel";
import SessionLogCards from "./session-log-cards";
import SessionLogView from "./session-log-view";
import SessionLogDetail from "./session-log-detail";
import SessionLogTabs from "./session-log-tabs";
import { sessionKey, pickSelection, type SessionRecord } from "../utils/session-log-context";
import { buildInstances } from "../utils/session-log";
import type { ProjectState } from "../../../shared/ipc";

interface SessionLogPanesProps {
  sessions: SessionRecord[];
  projectState: ProjectState;
  connected: boolean;
  deletable?: Set<string>;
  titles?: Record<string, string | null>;
  onDelete?: (projectRoot: string, sessionId: string) => void;
  /** Shown instead of the panes when `sessions` is empty. */
  empty: React.ReactNode;
  /** Fallback path root for relativizing log paths when nothing is selected. */
  fallbackRoot?: string;
}

const NO_KEYS = new Set<string>();
const NO_TITLES: Record<string, string | null> = {};

/**
 * One session tab bar plus the three panes (step list, framed log, detail) for a set of sessions.
 * The main checkout and each worktree tab (`075`) each render their own instance, so selection
 * and active step are per view and a view only ever shows the sessions it was given.
 */
export default function SessionLogPanes({
  sessions,
  projectState,
  connected,
  deletable = NO_KEYS,
  titles = NO_TITLES,
  onDelete,
  empty,
  fallbackRoot = "",
}: SessionLogPanesProps) {
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
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

  // Stable selection: see `pickSelection`.
  useEffect(() => {
    const next = pickSelection(sessions, selectedKey);
    if (next !== selectedKey) setSelectedKey(next);
  }, [sessions, selectedKey]);

  const selected = sessions.find((s) => sessionKey(s) === selectedKey) ?? null;
  const instances = useMemo(() => (selected ? buildInstances(selected.entries) : []), [selected]);
  const activeInstance = instances.find((inst) => inst.id === activeId) ?? null;
  const cwd = selected?.projectRoot ?? fallbackRoot;

  if (sessions.length === 0) return <>{empty}</>;

  const handleSelect = (id: number): void => {
    setActiveId(id);
    sectionRefs.current[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <>
      <SessionLogTabs
        sessions={sessions}
        projectState={projectState}
        selectedKey={selectedKey}
        onSelect={(key) => {
          setSelectedKey(key);
          setActiveId(null);
        }}
        deletable={deletable}
        titles={titles}
        onDelete={onDelete}
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
  );
}
