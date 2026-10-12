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
import { BookOpenIcon, LayoutIcon, ListIcon, PlusIcon, SquaresFourIcon } from "@phosphor-icons/react";
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
        className="relative flex items-center justify-center w-7 h-7 rounded-md text-maestro-muted hover:text-maestro cursor-pointer focus:outline-none bg-transparent border-0"
      >
        <ListIcon size={15} />
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
        <div className="absolute left-0 top-8 z-50 w-64 bg-maestro border border-maestro rounded-lg shadow-lg py-1">
          <Link
            to="/docs"
            onClick={close}
            activeProps={{ className: "text-maestro bg-maestro-elevated" }}
            className={MENU_ITEM}
          >
            <BookOpenIcon size={13} /> Docs
          </Link>
          <Link
            to="/tools"
            onClick={close}
            activeProps={{ className: "text-maestro bg-maestro-elevated" }}
            className={MENU_ITEM}
          >
            <SquaresFourIcon size={13} /> Tools
          </Link>
          <Link
            to="/templates"
            onClick={close}
            activeProps={{ className: "text-maestro bg-maestro-elevated" }}
            className={MENU_ITEM}
          >
            <LayoutIcon size={13} /> Templates
          </Link>

          <hr className="my-1 border-maestro" />

          <div className="px-3 py-1 text-[11px] font-semibold text-maestro-muted uppercase tracking-wide">
            Recent projects
          </div>
          {recent.length === 0 ? (
            <div className="px-3 py-1.5 text-[12px] text-maestro-muted">No projects yet</div>
          ) : (
            recent.map((r) => (
              <button
                key={r.root}
                type="button"
                onClick={() => {
                  void openProject(r.root);
                  close();
                }}
                className="w-full text-left flex flex-col px-3 py-1.5 hover:bg-maestro-elevated cursor-pointer focus:outline-none bg-transparent border-0"
              >
                <span className="text-[13px] text-maestro truncate">{r.name}</span>
                <span className="text-[11px] text-maestro-muted font-mono truncate">{r.root}</span>
              </button>
            ))
          )}

          <div className="border-t border-maestro mt-1 pt-1">
            <button
              type="button"
              onClick={() => {
                void pick();
                close();
              }}
              className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-maestro-muted hover:bg-maestro-elevated hover:text-maestro cursor-pointer focus:outline-none bg-transparent border-0"
            >
              <PlusIcon size={13} /> Add project…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
