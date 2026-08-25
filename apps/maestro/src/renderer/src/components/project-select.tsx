// The "which project am I VIEWING" control — deliberately not "which project is open".
//
// Switching the app's current project ends the live session and retargets every other route,
// which is too heavy a side effect just to peek at another project's runtime status or tools
// dashboard. So this dropdown calls the caller-supplied `onChange(root)` — never `open()` or
// `pick()` on `useProject()` directly — for every row except "Open another project…", which has
// to call `pick()` because there is no other way to add a project the app doesn't know about yet.
// Modeled on `NavMenu`'s dropdown in top-nav.tsx.

import { FolderOpen, ChevronDown, Check, Plus } from "lucide-react";
import { useState } from "react";
import { useOutsideClose } from "./top-nav";
import { useProject } from "../utils/project-context";

export default function ProjectSelect({
  value,
  onChange,
}: {
  /** The root currently being viewed. */
  value: string | null;
  onChange: (root: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const { current, recent, pick } = useProject();

  const otherRecent = recent.filter((r) => r.root !== current?.root);
  const label =
    current && value === current.root
      ? `${current.name} (open)`
      : (recent.find((r) => r.root === value)?.name ?? value ?? "No project");

  const choose = (root: string) => {
    onChange(root);
    setOpen(false);
  };

  const addProject = async () => {
    const opened = await pick();
    setOpen(false);
    // pick() applies the picked project as the app's CURRENT one; follow it with `value` so a
    // page holding local `viewedRoot` state doesn't keep showing whatever was viewed before.
    if (opened) onChange(opened.root);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        data-testid="project-select"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] border bg-(--bg-elev) border-(--line) text-(--ink) cursor-pointer focus:outline-none hover:border-primary max-w-[280px]"
      >
        <FolderOpen size={13} className="shrink-0 text-(--ink-3)" />
        <span className="truncate">{label}</span>
        <ChevronDown size={12} className="text-(--ink-3) shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-9 z-50 w-72 bg-(--bg) border border-(--line) rounded-lg shadow-lg py-1">
          {current && (
            <button
              type="button"
              onClick={() => choose(current.root)}
              className="w-full text-left flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-(--bg-elev) cursor-pointer focus:outline-none bg-transparent border-0"
            >
              <span className="flex flex-col min-w-0">
                <span className="text-[13px] text-(--ink) truncate">{current.name}</span>
                <span className="text-[11px] text-(--ink-3) font-mono truncate">{current.root}</span>
              </span>
              <span className="flex items-center gap-1 shrink-0">
                {value === current.root && <Check size={12} className="text-primary" />}
                <span className="text-[10px] text-subtle uppercase tracking-wide">Open</span>
              </span>
            </button>
          )}

          {otherRecent.length > 0 && (
            <>
              {current && <hr className="my-1 border-(--line)" />}
              {otherRecent.map((r) => (
                <button
                  key={r.root}
                  type="button"
                  onClick={() => choose(r.root)}
                  className="w-full text-left flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-(--bg-elev) cursor-pointer focus:outline-none bg-transparent border-0"
                >
                  <span className="flex flex-col min-w-0">
                    <span className="text-[13px] text-(--ink) truncate">{r.name}</span>
                    <span className="text-[11px] text-(--ink-3) font-mono truncate">{r.root}</span>
                  </span>
                  {value === r.root && <Check size={12} className="text-primary shrink-0" />}
                </button>
              ))}
            </>
          )}

          <div className="border-t border-(--line) mt-1 pt-1">
            <button
              type="button"
              onClick={() => void addProject()}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-(--ink-2) hover:bg-(--bg-elev) hover:text-(--ink) cursor-pointer focus:outline-none bg-transparent border-0"
            >
              <Plus size={13} /> Open another project…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
