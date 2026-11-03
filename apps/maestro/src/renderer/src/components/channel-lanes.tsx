import { TrayIcon } from "@phosphor-icons/react";
import type { PendingLane } from "../../../shared/ipc";

/** `oldestAgeMs` in the words `/maestro` shows beside a lane — never sub-hour, this is a backlog view. */
function formatAge(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 24) return `${Math.max(1, Math.round(hours))} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = hours / 24;
  const rounded = days < 10 ? Math.round(days * 10) / 10 : Math.round(days);
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}

/** One lane is `<scope>/<receiver>`; a pre-`144` unscoped lane has `scope: null` and reads `legacy`. */
export function laneKey(lane: PendingLane): string {
  return `${lane.scope ?? "legacy"}/${lane.receiver}`;
}

/**
 * `037`'s card body, presentational: every pending `.claude/channels/<scope>/<receiver>/` lane.
 * Each row's `data-testid` carries the scope as well as the receiver, because the same receiver
 * (`test`, `reviewer`...) is pending in several scopes at once and a testid must name one row.
 */
export default function ChannelLanes({ lanes }: { lanes: PendingLane[] }) {
  return (
    <div
      data-testid="maestro-channels"
      data-lanes={lanes.length}
      className="flex flex-col gap-3 p-4 rounded-lg border border-maestro bg-maestro-elevated"
    >
      <div className="text-[11px] font-semibold text-maestro-muted uppercase tracking-wide flex items-center gap-1.5">
        <TrayIcon size={12} /> Channels
      </div>
      <p className="text-[12px] text-maestro-muted m-0">
        Payloads waiting in <span className="font-mono">.claude/channels/</span> for an agent that hasn&rsquo;t consumed
        them yet. A route with no workflow to it — like the scribe&rsquo;s skill gaps — simply queues here until that
        agent is next invoked, which can be a later run.
      </p>
      <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
        {lanes.map((lane) => (
          <li
            key={laneKey(lane)}
            data-testid={`channel-lane-${laneKey(lane)}`}
            data-scope={lane.scope ?? "legacy"}
            className="text-[12px] flex flex-wrap items-baseline gap-x-1.5"
          >
            <span className="font-mono text-maestro">{laneKey(lane)}</span>
            <span className="text-maestro-muted">{lane.count} pending</span>
            <span className="text-maestro-muted">
              {lane.stranded === 0
                ? "— will be delivered this run"
                : lane.current > 0
                  ? `— ${lane.current} this run, ${lane.stranded} queued (oldest ${formatAge(lane.oldestAgeMs)})`
                  : `— queued for ${lane.receiver}, from a previous run (oldest ${formatAge(lane.oldestAgeMs)})`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
