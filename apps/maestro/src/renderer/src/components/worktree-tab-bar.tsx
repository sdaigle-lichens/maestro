import { GitBranch } from "lucide-react";
import { worktreeLabel, type WorktreeTab } from "../utils/worktree-log-context";

interface WorktreeTabBarProps {
  tabs: WorktreeTab[];
  /** "main" or a worktree path. */
  active: string;
  onSelect: (id: string) => void;
}

const base =
  "shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[12px] rounded-md border cursor-pointer transition-colors";
const on = "bg-(--primary-dim-2) border-primary text-(--ink) font-semibold";
const off = "bg-(--bg-elev) border-(--line-2) text-(--ink-2) hover:border-primary";

/** Top-level view switch of the Session Log (`075`): the main checkout plus one tab per worktree with a log. */
export default function WorktreeTabBar({ tabs, active, onSelect }: WorktreeTabBarProps) {
  return (
    <div
      className="shrink-0 flex items-center gap-2 border-b border-(--line) px-3 py-1.5 overflow-x-auto"
      role="tablist"
    >
      <button
        type="button"
        role="tab"
        aria-selected={active === "main"}
        onClick={() => onSelect("main")}
        className={`${base} ${active === "main" ? on : off}`}
      >
        Main checkout
      </button>
      {tabs.map((t) => {
        const live = t.state === "live";
        const removed = t.state === "removed";
        return (
          <button
            key={t.path}
            type="button"
            role="tab"
            aria-selected={active === t.path}
            title={`${t.path}${removed ? "\n(worktree removed)" : ""}`}
            onClick={() => onSelect(t.path)}
            className={`${base} ${active === t.path ? on : off} ${removed ? "opacity-70" : ""}`}
          >
            <GitBranch size={12} className="shrink-0" />
            <span className="max-w-48 truncate">{worktreeLabel(t)}</span>
            <span className={`text-[8px] ${live ? "text-(--green)" : "text-(--ink-3)"}`}>●</span>
            {removed && <span className="text-[10px] font-normal text-(--ink-3)">(removed)</span>}
          </button>
        );
      })}
    </div>
  );
}
