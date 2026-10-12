// The "which project am I VIEWING" control — deliberately not "which project is open".
//
// Switching the app's current project ends the live session and retargets every other route,
// which is too heavy a side effect just to peek at another project's runtime status or tools
// dashboard. So this dropdown calls the caller-supplied `onChange(root)` — never `open()` or
// `pick()` on `useProject()` directly — for every row except "Open another project…", which has
// to call `pick()` because there is no other way to add a project the app doesn't know about yet.
// Modeled on `NavMenu`'s dropdown in top-nav.tsx.

import { CaretDownIcon, CheckIcon, FolderOpenIcon, PlusIcon } from "@phosphor-icons/react";
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
        className="flex items-center gap-1.5 h-8 px-3 rounded-md text-[13px] border bg-maestro-elevated border-maestro text-maestro cursor-pointer focus:outline-none hover:border-maestro-primary-strong max-w-[280px]"
      >
        <FolderOpenIcon size={13} className="shrink-0 text-maestro-muted" />
        <span className="truncate">{label}</span>
        <CaretDownIcon size={12} className="text-maestro-muted shrink-0" />
      </button>

      {open && (
        <div className="absolute left-0 top-9 z-50 w-72 bg-maestro border border-maestro rounded-lg shadow-lg py-1">
          {current && (
            <button
              type="button"
              onClick={() => choose(current.root)}
              className="w-full text-left flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-maestro-elevated cursor-pointer focus:outline-none bg-transparent border-0"
            >
              <span className="flex flex-col min-w-0">
                <span className="text-[13px] text-maestro truncate">{current.name}</span>
                <span className="text-[11px] text-maestro-muted font-mono truncate">{current.root}</span>
              </span>
              <span className="flex items-center gap-1 shrink-0">
                {value === current.root && <CheckIcon size={12} className="text-maestro-primary" />}
                <span className="text-[10px] text-maestro-muted uppercase tracking-wide">Open</span>
              </span>
            </button>
          )}

          {otherRecent.length > 0 && (
            <>
              {current && <hr className="my-1 border-maestro" />}
              {otherRecent.map((r) => (
                <button
                  key={r.root}
                  type="button"
                  onClick={() => choose(r.root)}
                  className="w-full text-left flex items-center justify-between gap-2 px-3 py-1.5 hover:bg-maestro-elevated cursor-pointer focus:outline-none bg-transparent border-0"
                >
                  <span className="flex flex-col min-w-0">
                    <span className="text-[13px] text-maestro truncate">{r.name}</span>
                    <span className="text-[11px] text-maestro-muted font-mono truncate">{r.root}</span>
                  </span>
                  {value === r.root && <CheckIcon size={12} className="text-maestro-primary shrink-0" />}
                </button>
              ))}
            </>
          )}

          <div className="border-t border-maestro mt-1 pt-1">
            <button
              type="button"
              onClick={() => void addProject()}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-maestro-muted hover:bg-maestro-elevated hover:text-maestro cursor-pointer focus:outline-none bg-transparent border-0"
            >
              <PlusIcon size={13} /> Open another project…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
