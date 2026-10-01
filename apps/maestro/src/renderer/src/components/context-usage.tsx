import { formatTokenWindow, latestContextUsage } from "../utils/session-log";
import type { Instance } from "../utils/session-log";

/** Rounded whole-percent for display; the value is an estimate either way. */
function pctLabel(pct: number): string {
  return `${Math.round(pct)}%`;
}

function pctColor(pct: number): string {
  if (pct >= 90) return "text-(--red)";
  if (pct >= 75) return "text-(--yellow)";
  return "text-(--ink-3)";
}

/** Small sidebar badge. Renders nothing when the instance has no stamped ctx_pct (never 0%). */
export function ContextUsageBadge({ instance }: { instance: Instance }) {
  const usage = latestContextUsage(instance.entries);
  if (!usage) return null;
  return (
    <span
      className={`text-[10px] font-mono ${pctColor(usage.pct)}`}
      title={`~${pctLabel(usage.pct)} of ${formatTokenWindow(usage.windowTokens)} context window (approximate)`}
    >
      ~{pctLabel(usage.pct)}
    </span>
  );
}

/** Header line for the detail panel, e.g. "Backend · ~62% of 200k (approx.)". Null when unknown. */
export function ContextUsageLine({ instance }: { instance: Instance }) {
  const usage = latestContextUsage(instance.entries);
  if (!usage) return null;
  return (
    <div
      className="mt-0.5 text-[11px] text-(--ink-3)"
      title="Estimated from the shared transcript; parallel subagents can skew it"
    >
      {instance.displayName} · <span className={pctColor(usage.pct)}>~{pctLabel(usage.pct)}</span> of{" "}
      {formatTokenWindow(usage.windowTokens)} (approx.)
    </div>
  );
}
