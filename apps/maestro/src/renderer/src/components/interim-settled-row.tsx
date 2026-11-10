import { stripNamespace } from "../utils/text";
import type { InterimSettledRow as Row } from "../utils/session-log";

/** "14:02:31" in local time, the full ISO string kept for the tooltip; an unparseable value shows as-is. */
function clock(iso: string): string {
  const d = new Date(iso);
  return iso && !Number.isNaN(d.getTime()) ? d.toLocaleTimeString([], { hour12: false }) : iso || "?";
}

/**
 * The dedicated row for an `interim_settled` log entry (`169`/`174`): "this agent run's earlier stop
 * was settled". A `missing` settlement reads as a problem (danger), a late hand-back shows its label,
 * and a judged issue on that hand-back is listed under it. Every value comes from `row`, which
 * `interimSettledRow` reads off the one entry.
 */
export default function InterimSettledRow({ row }: { row: Row }) {
  const missing = row.settledAs === "missing";
  return (
    <div
      data-interim-settled={row.settledAs}
      className={`my-1 rounded-md border px-2.5 py-1.5 whitespace-normal ${
        missing || row.issue ? "border-maestro-danger-strong" : "border-maestro"
      }`}
    >
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-maestro-muted">interim stop settled —</span>
        <span className="text-maestro">@{stripNamespace(row.agent)}</span>
        {missing ? (
          <span className="text-maestro-danger">
            <span className="font-semibold">missing hand-off</span> · HANDOFF: {row.label ?? "none"}
          </span>
        ) : (
          <span className={row.issue ? "text-maestro-danger" : "text-maestro-success"}>
            late hand-back · HANDOFF: {row.label ?? "none"}
          </span>
        )}
      </div>
      <div className="text-[10.5px] text-maestro-muted">
        run <span className="font-mono">{row.agentId || "?"}</span> · stopped{" "}
        <time dateTime={row.stopTs} title={row.stopTs}>
          {clock(row.stopTs)}
        </time>{" "}
        · settled{" "}
        <time dateTime={row.settledTs} title={row.settledTs}>
          {clock(row.settledTs)}
        </time>
      </div>
      {row.issue && (
        <div className="mt-1 text-[10.5px] text-maestro-danger">
          <span className="font-mono uppercase tracking-wide">{row.issue.kind}</span>
          {row.issue.verdict ? ` · verdict ${row.issue.verdict}` : ""}
          {row.issue.label ? ` · label ${row.issue.label}` : ""} — {row.issue.message}
          {row.issue.files && row.issue.files.length > 0 && (
            <ul className="m-0 mt-0.5 list-none p-0 font-mono">
              {row.issue.files.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
