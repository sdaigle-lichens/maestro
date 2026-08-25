import { useState, type ReactNode } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";

/**
 * Groups a list of DiscoveredDefinition-shaped items by `source` ("project" = this repo's own
 * .claude/skills or .claude/agents, "user" = ~/.claude, "maestro"/a plugin name = bundled
 * or plugin-provided). "project" always sorts first — it's the group callers default open.
 */
export function groupBySource<T extends { source: string }>(items: T[]): Array<{ source: string; items: T[] }> {
  const order: string[] = [];
  const bySource = new Map<string, T[]>();
  for (const item of items) {
    if (!bySource.has(item.source)) {
      bySource.set(item.source, []);
      order.push(item.source);
    }
    bySource.get(item.source)!.push(item);
  }
  order.sort((a, b) => {
    if (a === "project") return -1;
    if (b === "project") return 1;
    return a.localeCompare(b);
  });
  return order.map((source) => ({ source, items: bySource.get(source)! }));
}

export function sourceLabel(source: string): string {
  switch (source) {
    case "project":
      return "This repository";
    case "user":
      return "Global";
    case "maestro":
      return "Bundled";
    default:
      return `Plugin: ${source}`;
  }
}

/** A collapsed-by-default disclosure block for one source group in the left pane. */
export function CollapsibleGroup({
  title,
  count,
  defaultOpen,
  children,
}: {
  title: string;
  count: number;
  defaultOpen: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 py-1 px-1 rounded hover:bg-(--bg-elev) cursor-pointer text-left focus:outline-none"
      >
        {open ? (
          <ChevronDown size={11} className="text-subtle shrink-0" />
        ) : (
          <ChevronRight size={11} className="text-subtle shrink-0" />
        )}
        <span className="text-[10px] font-semibold text-subtle uppercase tracking-wide truncate">{title}</span>
        <span className="ml-auto shrink-0 text-[10px] text-subtle">{count}</span>
      </button>
      {open && <div className="flex flex-col gap-0.5 pl-1">{children}</div>}
    </div>
  );
}
