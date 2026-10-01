import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import type { WorkflowSlice } from "../store/workflow-store";

/**
 * Shown on `/workflows` when `.claude/maestro.json` changed on disk while the canvas holds unsaved
 * edits. The edits were kept; this asks which side wins. Dismissing hides it without choosing —
 * the flag stays set, and a further disk change (a new `externalSlice`) shows it again.
 *
 * Render KEYED BY PROJECT ROOT so a project switch never carries a dismissal across projects.
 */
export default function ExternalChangeBanner({
  externalSlice,
  onReload,
  onKeepMine,
}: {
  externalSlice: WorkflowSlice | null;
  onReload: () => void;
  onKeepMine: () => void;
}) {
  const [dismissedSlice, setDismissedSlice] = useState<WorkflowSlice | null>(null);
  if (!externalSlice || externalSlice === dismissedSlice) return null;

  const btn =
    "px-2 py-0.5 text-[12px] rounded border border-(--line) bg-(--bg-elev) text-(--ink-2) hover:text-(--ink) cursor-pointer focus:outline-none";

  return (
    <div
      role="status"
      className="flex items-center gap-2 px-4 py-2 border-b border-(--line) bg-amber-500/10 text-[12px] text-(--ink-2)"
    >
      <AlertTriangle size={14} className="shrink-0 text-amber-500" />
      <span className="flex-1">
        <span className="font-mono">.claude/maestro.json</span> changed outside the app while you have unsaved edits.
      </span>
      <button type="button" onClick={onReload} className={btn}>
        Reload from disk
      </button>
      <button type="button" onClick={onKeepMine} className={btn}>
        Keep mine
      </button>
      <button
        type="button"
        onClick={() => setDismissedSlice(externalSlice)}
        aria-label="Dismiss"
        className="shrink-0 text-(--ink-3) hover:text-(--ink) cursor-pointer focus:outline-none"
      >
        <X size={14} />
      </button>
    </div>
  );
}
