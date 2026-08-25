// Skill picker for a workflow instance. Each skill can be unselected, selected as
// "loaded" (auto-loaded by the SubagentStart hook before the agent works), or "referenced"
// (surfaced as available; the agent loads it only if the task needs it). Checking a skill
// selects it as referenced by default; a per-row toggle promotes it to loaded.
// Used by the edit-instance modal and the new-instance picker. The main-session skill list
// stays a plain SkillChecklist (those are always loaded).

export type SkillMode = "loaded" | "referenced";

export interface SkillSelection {
  loaded: string[];
  referenced: string[];
}

export const emptySelection = (): SkillSelection => ({ loaded: [], referenced: [] });

export default function InstanceSkillPicker({
  skills,
  value,
  onChange,
  maxHeight = "max-h-48",
  size = "md",
  emptyHint,
}: {
  skills: string[];
  value: SkillSelection;
  onChange: (next: SkillSelection) => void;
  maxHeight?: string;
  size?: "sm" | "md";
  // When the available-skills list is empty: if provided, render this hint
  // instead of nothing (so the Skills section never silently disappears).
  emptyHint?: string;
}) {
  if (skills.length === 0) {
    if (!emptyHint) return null;
    return (
      <div className="flex flex-col gap-1">
        <div className="text-[10px] text-subtle uppercase tracking-wide">Skills</div>
        <p className="text-[12px] text-subtle">{emptyHint}</p>
      </div>
    );
  }

  const box = size === "md" ? "w-3.5 h-3.5" : "w-3 h-3";
  const text = size === "md" ? "text-[12px]" : "text-[11px]";

  const modeOf = (s: string): SkillMode | null =>
    value.loaded.includes(s) ? "loaded" : value.referenced.includes(s) ? "referenced" : null;

  // Checking selects as referenced (the default); unchecking drops from both lists.
  const toggleSelected = (s: string) => {
    if (modeOf(s)) {
      onChange({ loaded: value.loaded.filter((x) => x !== s), referenced: value.referenced.filter((x) => x !== s) });
    } else {
      onChange({ ...value, referenced: [...value.referenced, s] });
    }
  };

  const setMode = (s: string, mode: SkillMode) => {
    const loaded = value.loaded.filter((x) => x !== s);
    const referenced = value.referenced.filter((x) => x !== s);
    if (mode === "loaded") loaded.push(s);
    else referenced.push(s);
    onChange({ loaded, referenced });
  };

  const pill = (active: boolean) =>
    `px-1.5 py-0.5 text-[10px] font-medium cursor-pointer focus:outline-none transition-colors ${
      active ? "bg-primary text-white" : "bg-(--bg-elev) text-(--ink-2) hover:text-(--ink)"
    }`;

  return (
    <div className="flex flex-col gap-1">
      <div className="text-[10px] text-subtle uppercase tracking-wide">Skills</div>
      <div className={`flex flex-col gap-1 ${maxHeight} overflow-y-auto`}>
        {skills.map((s) => {
          const mode = modeOf(s);
          return (
            <div key={s} className="flex items-center gap-2 py-0.5 px-1 rounded hover:bg-(--bg-elev)">
              <label className="flex items-center gap-2 cursor-pointer flex-1 min-w-0">
                <input
                  type="checkbox"
                  checked={mode !== null}
                  onChange={() => toggleSelected(s)}
                  className={`${box} accent-primary cursor-pointer shrink-0`}
                />
                <span className={`font-mono ${text} text-(--ink) truncate`}>{s}</span>
              </label>
              {mode && (
                <div className="flex rounded-md overflow-hidden border border-(--line) shrink-0">
                  <button type="button" onClick={() => setMode(s, "loaded")} className={pill(mode === "loaded")}>
                    Loaded
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode(s, "referenced")}
                    className={pill(mode === "referenced")}
                  >
                    Ref
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
