import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { BookOpen, FolderOpen, LayoutGrid, X } from "lucide-react";
import Button from "@repo/ui/button";
import { useProject } from "../utils/project-context";
import { installBadge, useInstall } from "../utils/install-context";
import HamburgerMenu from "../components/hamburger-menu";
import { NAV_LINK } from "../components/top-nav";

export const Route = createFileRoute("/")({
  component: Home,
});

/**
 * The landing page is a project picker, not a splash screen. The web app opened already scoped
 * to one repo — the container was launched per-project with that path bind-mounted, so there was
 * nothing to choose. A desktop app starts with no project at all.
 *
 * It used to also show a grid of links into every route — Workflows, Rules, Session Log, etc.
 * Those all need a project open anyway, and the hamburger menu already carries the app-wide
 * destinations that don't, so repeating them here as a second navigation surface was redundant
 * with TopNav's own direct-link row. Docs and Tools get a direct link in this bar too, same as
 * they would on any other route once a project is open — the hamburger stays for the recent-
 * projects list and "+ Add project…". So the home page's own job is just: which project, and add
 * one if it isn't listed yet.
 *
 * Opening a project from here goes straight to `/maestro` — that route is the project's own
 * landing page now, not a page reached from a menu — rather than dropping the user on Workflows,
 * which presumes they're here to edit a graph.
 */
function Home() {
  const { current, recent, pick, open, forget } = useProject();
  const badge = installBadge(useInstall().status);
  const navigate = useNavigate();

  const openAndGo = async (root: string) => {
    await open(root);
    void navigate({ to: "/maestro" });
  };

  const pickAndGo = async () => {
    const opened = await pick();
    if (opened) void navigate({ to: "/maestro" });
  };

  return (
    <div className="min-h-screen bg-(--bg) text-(--ink) flex flex-col">
      <nav className="h-11 border-b border-(--line) bg-(--bg) flex items-center px-4 gap-1 shrink-0">
        <HamburgerMenu badge={badge} />
        <span className="w-px h-4 bg-(--line) mx-1.5 shrink-0" aria-hidden />
        <Link to="/docs" activeProps={{ className: "text-(--ink) bg-(--bg-elev)" }} className={NAV_LINK}>
          <BookOpen size={13} /> Docs
        </Link>
        <Link to="/tools" activeProps={{ className: "text-(--ink) bg-(--bg-elev)" }} className={NAV_LINK}>
          <LayoutGrid size={13} /> Tools
        </Link>
      </nav>

      <div className="flex-1 flex flex-col items-center justify-center gap-8 p-8">
        <div className="text-center">
          <h1 className="mb-1 text-2xl font-semibold">Maestro</h1>
          <p className="text-[13px] text-(--ink-3) m-0">
            {current ? (
              <>
                Open: <span className="font-mono text-(--ink-2)">{current.root}</span>
              </>
            ) : (
              "Choose a project to configure."
            )}
          </p>
        </div>

        <Button variant="primary" icon={<FolderOpen size={14} />} onClick={() => void pickAndGo()}>
          {current ? "Switch project…" : "Open project…"}
        </Button>

        {recent.length > 0 && (
          <div className="w-full max-w-md">
            <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide mb-2">Recent</div>
            <ul className="flex flex-col gap-1 list-none p-0 m-0">
              {recent.map((r) => (
                <li key={r.root} className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void openAndGo(r.root)}
                    className="flex-1 text-left px-3 py-2 rounded-md border border-(--line) bg-(--bg-elev) hover:border-(--ink-3) cursor-pointer focus:outline-none"
                  >
                    <div className="text-[13px] text-(--ink)">{r.name}</div>
                    <div className="text-[11px] text-(--ink-3) font-mono truncate">{r.root}</div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void forget(r.root)}
                    title="Remove from recent"
                    className="w-7 h-7 rounded-md flex items-center justify-center text-(--ink-3) hover:text-(--ink) cursor-pointer focus:outline-none"
                  >
                    <X size={13} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}
