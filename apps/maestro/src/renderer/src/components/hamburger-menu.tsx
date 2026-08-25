// The hamburger menu — app-wide concerns, reachable from every route.
//
// Separates "things that don't need the CURRENT project open, or that switch which project is
// open" (the global Docs page, /tools, recent projects) from the per-project direct links
// `TopNav` still renders beside it — which is also where the Maestro runtime page moved once it
// became a project-scoped landing page rather than something viewable with no project open.
// Modeled on `NavMenu`'s dropdown pattern in top-nav.tsx, reusing its `useOutsideClose` — the
// recent-projects list and the "+ Add project…" row don't fit that component's `routes` prop, so
// this one is its own component rather than a forced NavMenu variant.

import { Link } from "@tanstack/react-router";
import { Menu, BookOpen, LayoutGrid, Plus } from "lucide-react";
import { useState } from "react";
import { useOutsideClose, MENU_ITEM } from "./top-nav";
import { useProject } from "../utils/project-context";

export default function HamburgerMenu({ badge }: { badge: "none" | "missing" | "stale" }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const { recent, open: openProject, pick } = useProject();

  const close = () => setOpen(false);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        data-testid="hamburger-menu"
        onClick={() => setOpen((v) => !v)}
        title="Menu"
        className="relative flex items-center justify-center w-7 h-7 rounded-md text-(--ink-2) hover:text-(--ink) cursor-pointer focus:outline-none bg-transparent border-0"
      >
        <Menu size={15} />
        {badge !== "none" && (
          <span
            title={
              badge === "missing"
                ? "Maestro is not installed in this project"
                : "The app ships a newer runtime than this project has"
            }
            className="absolute -top-0.5 -right-0.5 text-[7px] leading-none text-amber-500"
          >
            ●
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-8 z-50 w-64 bg-(--bg) border border-(--line) rounded-lg shadow-lg py-1">
          <Link
            to="/docs"
            onClick={close}
            activeProps={{ className: "text-(--ink) bg-(--bg-elev)" }}
            className={MENU_ITEM}
          >
            <BookOpen size={13} /> Docs
          </Link>
          <Link
            to="/tools"
            onClick={close}
            activeProps={{ className: "text-(--ink) bg-(--bg-elev)" }}
            className={MENU_ITEM}
          >
            <LayoutGrid size={13} /> Tools
          </Link>

          <hr className="my-1 border-(--line)" />

          <div className="px-3 py-1 text-[11px] font-semibold text-subtle uppercase tracking-wide">Recent projects</div>
          {recent.length === 0 ? (
            <div className="px-3 py-1.5 text-[12px] text-subtle">No projects yet</div>
          ) : (
            recent.map((r) => (
              <button
                key={r.root}
                type="button"
                onClick={() => {
                  void openProject(r.root);
                  close();
                }}
                className="w-full text-left flex flex-col px-3 py-1.5 hover:bg-(--bg-elev) cursor-pointer focus:outline-none bg-transparent border-0"
              >
                <span className="text-[13px] text-(--ink) truncate">{r.name}</span>
                <span className="text-[11px] text-(--ink-3) font-mono truncate">{r.root}</span>
              </button>
            ))
          )}

          <div className="border-t border-(--line) mt-1 pt-1">
            <button
              type="button"
              onClick={() => {
                void pick();
                close();
              }}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-(--ink-2) hover:bg-(--bg-elev) hover:text-(--ink) cursor-pointer focus:outline-none bg-transparent border-0"
            >
              <Plus size={13} /> Add project…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
