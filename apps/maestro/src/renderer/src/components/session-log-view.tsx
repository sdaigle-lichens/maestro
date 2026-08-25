import { humanizeLog, unaccountedSkills } from "../utils/session-log";
import type { Instance } from "../utils/session-log";

interface SessionLogViewProps {
  instances: Instance[];
  activeId: number | null;
  onSelect: (id: number) => void;
  sectionRefs: React.MutableRefObject<Record<number, HTMLDivElement | null>>;
  connected: boolean;
  cwd: string;
}

function borderColor(status: Instance["status"]): string {
  if (status === "condition") return "border-[var(--red)]";
  if (status === "unknown") return "border-[var(--yellow)]";
  if (status === "transition") return "border-[var(--line-2)]";
  if (status === "success") return "border-[var(--green)]";
  return "border-[var(--green)]";
}

export default function SessionLogView({
  instances,
  activeId,
  onSelect,
  sectionRefs,
  connected,
  cwd,
}: SessionLogViewProps) {
  return (
    <div className="flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-3 border-b border-(--line) shrink-0">
        <span className="text-[13px] font-medium text-(--ink)">Agents Flow</span>
        <div className={`flex items-center gap-1.5 text-[11px] ${connected ? "text-(--green)" : "text-(--ink-3)"}`}>
          <span className="text-[8px]">{connected ? "●" : "○"}</span>
          {connected ? "live" : "reconnecting…"}
        </div>
      </div>

      {/* Scrollable log body */}
      <div className="flex-1 overflow-y-auto px-6 py-4 font-mono text-xs leading-[1.7]">
        {instances.map((inst) => {
          const isActive = inst.id === activeId;
          const lines = inst.entries.map((e) => humanizeLog(e, cwd)).filter((line): line is string => line !== null);

          return (
            <div
              key={inst.id}
              ref={(el) => {
                sectionRefs.current[inst.id] = el;
              }}
              onClick={() => onSelect(inst.id)}
              className={`scroll-mt-4 mb-4 rounded-lg p-4 cursor-pointer transition-colors ${
                isActive ? `border-2 ${borderColor(inst.status)}` : "border border-(--line) hover:border-(--line-2)"
              }`}
            >
              {/* Section label */}
              <div className="flex items-center justify-between py-1 mb-0.5">
                <span className="text-(--ink-3) text-[10px] font-semibold uppercase tracking-wider">
                  {inst.displayName}
                </span>
                {inst.skillsTriage && (
                  <span className="text-[10px] font-mono">
                    <span className="text-(--green)">{inst.skillsTriage.loaded.length} loaded</span>
                    {inst.skillsTriage.skipped.length > 0 && (
                      <span className="text-(--yellow)">
                        {" · "}
                        {inst.skillsTriage.skipped.length} skipped
                      </span>
                    )}
                    {unaccountedSkills(inst).length > 0 && (
                      <span className="text-(--red)">
                        {" · "}
                        {unaccountedSkills(inst).length} unaccounted
                      </span>
                    )}
                  </span>
                )}
              </div>

              {lines.length > 0 ? (
                lines.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-words text-(--ink-2)">
                    -{" "}
                    {inst.origin === "main_session" || inst.origin === "transition"
                      ? line
                      : `[${inst.displayName}]: ${line}`}
                  </div>
                ))
              ) : (
                <div className="text-(--ink-3) italic">no tool calls recorded</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
