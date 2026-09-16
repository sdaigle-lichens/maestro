import { X } from "lucide-react";
import { sessionKey, startedAt, type SessionRecord } from "../utils/session-log-context";
import type { ProjectState } from "../../../shared/ipc";

interface SessionLogTabsProps {
  sessions: SessionRecord[];
  projectState: ProjectState;
  selectedKey: string | null;
  onSelect: (key: string) => void;
  onClose: (projectRoot: string, sessionId: string) => void;
}

function projectName(root: string, projectState: ProjectState): string {
  if (projectState.current?.root === root) return projectState.current.name;
  return projectState.recent.find((r) => r.root === root)?.name ?? root;
}

function formatTabLabel(s: SessionRecord): string {
  const d = new Date(startedAt(s));
  if (Number.isNaN(d.getTime())) return s.sessionId.slice(0, 8);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Grouped tab bar above the 3-pane log view (`065`) — one tab per session, one group per project,
 * project name shown once per group rather than repeated on every tab. Current project's group
 * (when it has any tracked session) comes first, then recent projects in the order `project:get`
 * returns them.
 */
export default function SessionLogTabs({
  sessions,
  projectState,
  selectedKey,
  onSelect,
  onClose,
}: SessionLogTabsProps) {
  const roots = [
    ...(projectState.current ? [projectState.current.root] : []),
    ...projectState.recent.map((r) => r.root),
  ];

  const groups = roots
    .map((root) => ({
      root,
      name: projectName(root, projectState),
      sessions: sessions.filter((s) => s.projectRoot === root).sort((a, b) => startedAt(a) - startedAt(b)),
    }))
    .filter((g) => g.sessions.length > 0);

  return (
    <div className="flex items-stretch gap-4 border-b border-(--line) px-4 overflow-x-auto shrink-0 bg-(--bg-elev)">
      {groups.map((group) => (
        <div key={group.root} className="flex items-center gap-1 py-1.5 shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-(--ink-3) mr-1 shrink-0">
            {group.name}
          </span>
          {group.sessions.map((s) => {
            const key = sessionKey(s);
            const isActive = key === selectedKey;
            const ended = s.status === "ended";
            return (
              <button
                key={key}
                type="button"
                onClick={() => onSelect(key)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12px] whitespace-nowrap transition-colors cursor-pointer ${
                  isActive
                    ? "bg-(--bg) border border-(--line-2) text-(--ink) font-medium"
                    : "border border-transparent text-(--ink-3) hover:bg-(--bg)"
                } ${ended ? "opacity-60" : ""}`}
              >
                <span className={`text-[8px] ${ended ? "text-(--ink-3)" : "text-(--green)"}`}>●</span>
                {formatTabLabel(s)}
                {ended && <span className="text-(--ink-3)">(ended)</span>}
                {ended && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose(s.projectRoot, s.sessionId);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.stopPropagation();
                        onClose(s.projectRoot, s.sessionId);
                      }
                    }}
                    className="ml-0.5 rounded-sm hover:bg-(--line) p-0.5 cursor-pointer"
                    aria-label="Close ended session tab"
                  >
                    <X size={10} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
