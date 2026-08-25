import { FileWarning } from "lucide-react";

/**
 * Shown when the loaded config came from nowhere on disk — the project has no
 * `.claude/maestro.json` yet.
 *
 * Without it, opening an unconfigured project on /workflows shows a fully populated canvas — six
 * workflows, five instances — with nothing written and no hint that a save is required to keep
 * any of it. A user who looks around and closes the app has written nothing, and had no reason
 * to know.
 *
 * The two routes seed differently, which is why the consequence is the caller's to word:
 * /workflows hands back a starter graph, /rules hands back a blank config.
 */
export default function SeededBanner({ children }: { children: React.ReactNode }) {
  return (
    <div
      role="status"
      className="flex items-start gap-2 px-4 py-2 border-b border-(--line) bg-amber-500/10 text-[12px] text-(--ink-2)"
    >
      <FileWarning size={14} className="shrink-0 mt-px text-amber-500" />
      <span>
        This project has no <span className="font-mono text-(--ink)">.claude/maestro.json</span> yet. {children}
      </span>
    </div>
  );
}
