import { humanizeLog, receivedCount, unaccountedSkills } from "../utils/session-log";
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
  if (status === "condition") return "border-maestro-danger-strong";
  if (status === "unknown") return "border-maestro-warning-strong";
  if (status === "transition") return "border-maestro-strong";
  if (status === "success") return "border-maestro-success-strong";
  return "border-maestro-success-strong";
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
      <div className="flex items-center justify-between px-6 py-3 border-b border-maestro shrink-0">
        <span className="text-[13px] font-medium text-maestro">Agents Flow</span>
        <div
          className={`flex items-center gap-1.5 text-[11px] ${connected ? "text-maestro-success" : "text-maestro-muted"}`}
        >
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
                isActive ? `border-2 ${borderColor(inst.status)}` : "border border-maestro hover:border-maestro-strong"
              }`}
            >
              {/* Section label */}
              <div className="flex items-center justify-between py-1 mb-0.5">
                <span className="text-maestro-muted text-[10px] font-semibold uppercase tracking-wider">
                  {inst.displayName}
                </span>
                <span className="flex items-center gap-2">
                  {inst.skillsTriage && (
                    <span className="text-[10px] font-mono">
                      <span className="text-maestro-success">{inst.skillsTriage.loaded.length} loaded</span>
                      {inst.skillsTriage.skipped.length > 0 && (
                        <span className="text-maestro-warning">
                          {" · "}
                          {inst.skillsTriage.skipped.length} skipped
                        </span>
                      )}
                      {unaccountedSkills(inst).length > 0 && (
                        <span className="text-maestro-danger">
                          {" · "}
                          {unaccountedSkills(inst).length} unaccounted
                        </span>
                      )}
                    </span>
                  )}
                  {receivedCount(inst) > 0 && (
                    <span className="text-[10px] font-mono text-maestro-muted">{receivedCount(inst)} delivered</span>
                  )}
                </span>
              </div>

              {lines.length > 0 ? (
                lines.map((line, i) => (
                  <div key={i} className="whitespace-pre-wrap break-words text-maestro-muted">
                    -{" "}
                    {inst.origin === "main_session" || inst.origin === "transition"
                      ? line
                      : `[${inst.displayName}]: ${line}`}
                  </div>
                ))
              ) : (
                <div className="text-maestro-muted italic">no tool calls recorded</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
