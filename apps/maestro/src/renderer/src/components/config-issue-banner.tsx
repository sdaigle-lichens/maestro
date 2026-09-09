import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { ConfigIssue } from "../utils/maestro";

/**
 * Shown when the loaded config carries a duplicate-agent-type collision (`041`) — two placed
 * instances on one workflow sharing a bare `agent`. The canvas itself refuses to create this, so
 * seeing it means a hand-edit or a merge conflict produced it; nothing here repairs it, only names
 * it. Dismissible and never blocking: the user may be mid-repair, and editing must stay available
 * either way — see `instance-picker.tsx`'s fork affordance for the offered way out.
 *
 * Render this KEYED BY PROJECT ROOT (`key={projectRoot}`) so a project switch remounts it rather
 * than carrying a dismissal from one project's issues onto another's — the same discipline
 * `/rules`' editor keys itself by, documented in `apps/maestro/CLAUDE.md`.
 */
export default function ConfigIssueBanner({ issues }: { issues: ConfigIssue[] }) {
  const [dismissed, setDismissed] = useState(false);
  if (issues.length === 0 || dismissed) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-2 px-4 py-2 border-b border-(--line) bg-amber-500/10 text-[12px] text-(--ink-2)"
    >
      <AlertTriangle size={14} className="shrink-0 mt-px text-amber-500" />
      <div className="flex-1 flex flex-col gap-0.5">
        {issues.map((issue, i) => (
          <span key={i}>{issue.detail}</span>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 text-(--ink-3) hover:text-(--ink) cursor-pointer focus:outline-none"
      >
        <X size={14} />
      </button>
    </div>
  );
}
