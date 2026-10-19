import { CheckCircleIcon, CircleIcon, TrayIcon, WarningIcon, XCircleIcon } from "@phosphor-icons/react";
import { receivedCount, unaccountedSkills } from "../utils/session-log";
import type { Instance } from "../utils/session-log";
import { ContextUsageBadge } from "./context-usage";

interface SessionLogCardsProps {
  instances: Instance[];
  activeId: number | null;
  onSelect: (id: number) => void;
}

function StatusIcon({ status }: { status: Instance["status"] }) {
  if (status === "success") return <CheckCircleIcon size={16} className="text-maestro-success shrink-0" />;
  if (status === "condition") return <XCircleIcon size={16} className="text-maestro-danger shrink-0" />;
  if (status === "unknown") return <WarningIcon size={16} className="text-maestro-warning shrink-0" />;
  if (status === "transition") return <CircleIcon size={16} className="text-maestro-muted shrink-0" />;
  return <CheckCircleIcon size={16} className="text-maestro-success shrink-0" />;
}

function underlineColor(status: Instance["status"]): string {
  if (status === "condition") return "border-b-maestro-danger-strong";
  if (status === "unknown") return "border-b-maestro-warning-strong";
  if (status === "transition") return "border-b-maestro-strong";
  return "border-b-maestro-success-strong";
}

export default function SessionLogCards({ instances, activeId, onSelect }: SessionLogCardsProps) {
  return (
    <div className="border-r border-maestro overflow-y-auto py-4 px-3">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-maestro-muted mb-3 px-1">Workflow</div>
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
                : "border-b border-transparent hover:bg-maestro-elevated"
            }`}
          >
            <StatusIcon status={inst.status} />
            <span className="text-[13px] text-maestro truncate">{inst.displayName}</span>
            <span className="ml-auto shrink-0 flex items-center gap-1.5">
              {inst.skillsTriage && (
                <span className="text-[10px] font-mono" title="skills loaded / skipped / unaccounted">
                  <span className="text-maestro-success">{inst.skillsTriage.loaded.length}</span>
                  {inst.skillsTriage.skipped.length > 0 && (
                    <span className="text-maestro-warning">/{inst.skillsTriage.skipped.length}</span>
                  )}
                  {unaccountedSkills(inst).length > 0 && (
                    <span className="text-maestro-danger">/{unaccountedSkills(inst).length}</span>
                  )}
                </span>
              )}
              <ContextUsageBadge instance={inst} />
              {receivedCount(inst) > 0 && (
                <span
                  className="flex items-center gap-0.5 text-[10px] font-mono text-maestro-muted"
                  title={`${receivedCount(inst)} channel deliveries`}
                >
                  <TrayIcon size={10} />
                  {receivedCount(inst)}
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}
