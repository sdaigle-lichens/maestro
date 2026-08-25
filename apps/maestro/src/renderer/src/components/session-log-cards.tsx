import { CircleCheck, CircleX, AlertTriangle, Circle } from "lucide-react";
import { unaccountedSkills } from "../utils/session-log";
import type { Instance } from "../utils/session-log";

interface SessionLogCardsProps {
  instances: Instance[];
  activeId: number | null;
  onSelect: (id: number) => void;
}

function StatusIcon({ status }: { status: Instance["status"] }) {
  if (status === "success") return <CircleCheck size={16} className="text-(--green) shrink-0" />;
  if (status === "condition") return <CircleX size={16} className="text-(--red) shrink-0" />;
  if (status === "unknown") return <AlertTriangle size={16} className="text-(--yellow) shrink-0" />;
  if (status === "transition") return <Circle size={16} className="text-(--ink-3) shrink-0" />;
  return <CircleCheck size={16} className="text-(--green) shrink-0" />;
}

function underlineColor(status: Instance["status"]): string {
  if (status === "condition") return "border-b-[var(--red)]";
  if (status === "unknown") return "border-b-[var(--yellow)]";
  if (status === "transition") return "border-b-[var(--line-2)]";
  return "border-b-[var(--green)]";
}

export default function SessionLogCards({ instances, activeId, onSelect }: SessionLogCardsProps) {
  return (
    <div className="border-r border-(--line) overflow-y-auto py-4 px-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-(--ink-3) mb-3 px-1">Workflow</div>
      {instances.map((inst) => {
        const isActive = inst.id === activeId;

        return (
          <button
            key={inst.id}
            type="button"
            onClick={() => onSelect(inst.id)}
            className={`w-full flex items-center gap-2 px-1 py-1.5 text-left cursor-pointer transition-colors rounded-sm focus:outline-none ${
              isActive
                ? `font-medium border-b-2 ${underlineColor(inst.status)}`
                : "border-b border-transparent hover:bg-(--bg-elev)"
            }`}
          >
            <StatusIcon status={inst.status} />
            <span className="text-[13px] text-(--ink) truncate">{inst.displayName}</span>
            {inst.skillsTriage && (
              <span className="ml-auto shrink-0 text-[10px] font-mono" title="skills loaded / skipped / unaccounted">
                <span className="text-(--green)">{inst.skillsTriage.loaded.length}</span>
                {inst.skillsTriage.skipped.length > 0 && (
                  <span className="text-(--yellow)">/{inst.skillsTriage.skipped.length}</span>
                )}
                {unaccountedSkills(inst).length > 0 && (
                  <span className="text-(--red)">/{unaccountedSkills(inst).length}</span>
                )}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
