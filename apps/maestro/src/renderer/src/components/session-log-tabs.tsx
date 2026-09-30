import { X } from "lucide-react";
import {
  orderSessions,
  pickSessionTitle,
  sessionKey,
  startedAt,
  type SessionRecord,
} from "../utils/session-log-context";
import type { ProjectState } from "../../../shared/ipc";

interface SessionLogTabsProps {
  sessions: SessionRecord[];
  projectState: ProjectState;
  selectedKey: string | null;
  /** `sessionKey`s the main process would let us delete (idle, not running). */
  deletable: Set<string>;
  /** Backend titles keyed by `sessionKey`; missing/null falls back to the derived title. */
  titles: Record<string, string | null>;
  onSelect: (key: string) => void;
  onDelete: (projectRoot: string, sessionId: string) => void;
}

function projectName(root: string, projectState: ProjectState): string {
  if (projectState.current?.root === root) return projectState.current.name;
  return projectState.recent.find((r) => r.root === root)?.name ?? root;
}

function formatWhen(s: SessionRecord): { date: string; time: string } | null {
  const d = new Date(startedAt(s));
  if (Number.isNaN(d.getTime())) return null;
  return {
    date: d.toLocaleDateString([], { month: "short", day: "numeric" }),
    time: d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
  };
}

/**
 * Tab bar above the 3-pane log view (`065`): one tab per session, ordered by project (current
 * first, then recent) and start time. Each tab shows project, date + time and a short title, so
 * it is identifiable without opening it; overflow scrolls horizontally and long text truncates
 * with the full text in the tooltip. The x appears for any session that is not running: status
 * "ended", or listed by `sessions.deletable()` (a crashed session never emits an end).
 */
export default function SessionLogTabs({
  sessions,
  projectState,
  selectedKey,
  deletable,
  titles,
  onSelect,
  onDelete,
}: SessionLogTabsProps) {
  const ordered = orderSessions(sessions, [
    ...(projectState.current ? [projectState.current.root] : []),
    ...projectState.recent.map((r) => r.root),
  ]);

  return (
    <div className="flex items-stretch gap-2 border-b border-(--line-2) px-3 py-2 overflow-x-auto shrink-0 bg-(--bg-2)">
      {ordered.map((s) => {
        const key = sessionKey(s);
        const isActive = key === selectedKey;
        const ended = s.status === "ended";
        const canDelete = ended || deletable.has(key);
        const name = projectName(s.projectRoot, projectState);
        const when = formatWhen(s);
        const title = pickSessionTitle(s, titles[key]);
        const fullTitle = titles[key]?.trim() || title;
        const tooltip = `${name}\n${when ? `${when.date} ${when.time}` : ""}\n${fullTitle}\nsession ${s.sessionId}`;
        return (
          <div
            key={key}
            title={tooltip}
            className={`group shrink-0 flex items-stretch rounded-lg border transition-colors ${
              isActive
                ? "bg-(--primary-dim-2) border-primary shadow-sm"
                : "bg-(--bg-elev) border-(--line-2) hover:border-primary"
            } ${ended ? "opacity-70" : ""}`}
          >
            <button
              type="button"
              onClick={() => onSelect(key)}
              className="flex flex-col items-start gap-0.5 px-3 py-1.5 min-w-0 max-w-64 text-left cursor-pointer"
            >
              <span className="flex items-center gap-1.5 max-w-full text-[10px] font-semibold uppercase tracking-wider text-(--ink-2)">
                <span className={`text-[8px] shrink-0 ${ended ? "text-(--ink-3)" : "text-(--green)"}`}>●</span>
                <span className="truncate">{name}</span>
                {when && (
                  <span className="shrink-0 normal-case font-normal tracking-normal text-(--ink-3)">
                    {when.date} {when.time}
                  </span>
                )}
                {ended && (
                  <span className="shrink-0 normal-case font-normal tracking-normal text-(--ink-3)">(ended)</span>
                )}
              </span>
              <span
                className={`max-w-full truncate text-[12px] ${isActive ? "text-(--ink) font-semibold" : "text-(--ink-2)"}`}
              >
                {title}
              </span>
            </button>
            {canDelete && (
              <button
                type="button"
                onClick={() => onDelete(s.projectRoot, s.sessionId)}
                className="self-start m-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-(--line-2) bg-(--bg-2) text-(--ink) transition-colors hover:border-red-500 hover:bg-red-500/15 hover:text-red-500 cursor-pointer"
                aria-label="Delete session"
                title="Delete session"
              >
                <X size={13} strokeWidth={2.5} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
