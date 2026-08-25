// /tools — help-server's tabbed dashboard, landed BESIDE the app's own sections.
//
// help-server put this at `/`. Maestro's `/` is the project picker and stays that way: the desktop
// app opens with no project at all, so the first question it has to ask is which one — a dashboard
// there would be describing a machine and a project the user has not chosen yet. So the dashboard
// is a route like any other, reached from the top bar's hamburger menu.
//
// SIX TABS, AND ONE IS NOT LIKE THE OTHERS. Five are pure reads of this machine and the VIEWED
// project (see `ProjectSelect` below), served by one `data:tools` round trip. Usage Stats is a
// COMMAND — help-server ran `npx ccusage@latest` on every view of it, downloading and executing a
// package from the network unannounced. It therefore has no loader data at all: it previews what
// it would run, shows that, and runs only when the user says so. See src/core/ccusage.ts.
//
// Skills used to be a seventh tab here; it now lives at its own top-level `/skills` page (frequent
// enough to tag, especially with "Update skill tags", to earn a nav slot). This route still reads
// `data.skills` off the shared `data:tools` payload for nothing — see `ToolsData` — that field is
// unused here and kept only because narrowing the shared payload per-consumer isn't worth it.

import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, FolderOpen } from "lucide-react";
import TopNav from "../components/top-nav";
import ProjectSelect from "../components/project-select";
import CommandCenter from "../components/tabs/command-center";
import MarketplaceTab from "../components/tabs/marketplace";
import CuratedTools from "../components/tabs/curated-tools";
import UsageStatsTab from "../components/tabs/usage-stats";
import RulesTab from "../components/tabs/rules-tab";
import AgentsTab from "../components/tabs/agents-tab";
import { callMain, type CallResult } from "../utils/call-main";
import { getToolsData, type ToolsData } from "../utils/tools";
import { useProject } from "../utils/project-context";

export const Route = createFileRoute("/tools")({
  // Through `callMain`, like every other fallible channel: a loader that let the call reject would
  // hand TanStack an error boundary with Electron's `Error invoking remote method 'data:tools'`
  // framing in it, which tells a user nothing they can act on.
  loader: async () => callMain(() => getToolsData()),
  component: ToolsPage,
});

// Skills moved to its own top-level /skills page (see routes/skills.tsx) — tagging is frequent
// enough, especially with the "Update skill tags" button, to earn a place in the project nav
// rather than staying a tab here.
type TabId = "plugins" | "stats" | "marketplace" | "curated" | "rules" | "agents";

const TABS: { id: TabId; label: string }[] = [
  { id: "plugins", label: "Plugins" },
  { id: "marketplace", label: "Marketplace" },
  { id: "stats", label: "Usage Stats" },
  { id: "curated", label: "Curated Tools" },
  { id: "rules", label: "Rules" },
  { id: "agents", label: "Agents" },
];

function ToolsPage() {
  const loaderResult = Route.useLoaderData();
  const { current, recent } = useProject();
  const [tab, setTab] = useState<TabId>("plugins");
  const [viewedRoot, setViewedRoot] = useState<string | null>(current?.root ?? null);
  // Seeded from the loader (which read the app's CURRENT project) and re-fetched whenever
  // `viewedRoot` changes to something else — the loader itself cannot react to that local state.
  const [result, setResult] = useState<CallResult<ToolsData>>(loaderResult);

  // Adopt `current` whenever the viewed root is missing or no longer known. "Missing" covers the
  // mount-time race: `ProjectProvider` starts with `current: null` and only learns the real open
  // project asynchronously, so a route that renders before that resolves captures `null` here —
  // and nothing else ever revisits it. The fetched data stays correct either way (the effect below
  // falls back to the app's own current project when `viewedRoot` is null), but without this,
  // `ProjectSelect` is stuck showing "No project" even once the real one is known. See the matching
  // fix in routes/maestro.tsx for the fuller writeup.
  useEffect(() => {
    if (!current) return;
    const known = [current.root, ...recent.map((r) => r.root)];
    if (!viewedRoot || !known.includes(viewedRoot)) setViewedRoot(current.root);
  }, [viewedRoot, current, recent]);

  useEffect(() => {
    let cancelled = false;
    void callMain(() => getToolsData(viewedRoot ?? undefined)).then((res) => {
      if (!cancelled) setResult(res);
    });
    return () => {
      cancelled = true;
    };
  }, [viewedRoot]);

  if (!result.ok) {
    return (
      <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) flex flex-col overflow-hidden">
        <TopNav />
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-500/10 max-w-lg">
            <AlertTriangle size={16} className="shrink-0 mt-px text-red-500" />
            <div>
              <p className="text-[13px] text-(--ink) m-0 mb-1">The dashboard could not be loaded.</p>
              <p className="text-[12px] text-(--ink-2) m-0">{result.error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const data = result.value;

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) flex flex-col overflow-hidden">
      <TopNav />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-10">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <span className="section-label mb-3 inline-block">AI Dev Tools</span>
              <h1 className="text-2xl font-semibold text-(--ink) m-0 mb-1">Tools</h1>
              <p className="text-[13px] text-subtle m-0">
                Plugins, commands, marketplaces, rules, skills and agents — what this machine and{" "}
                {data.projectRoot ? (
                  <span className="font-mono text-(--ink-2)">{data.projectRoot}</span>
                ) : (
                  "the viewed project"
                )}{" "}
                already have.
              </p>
            </div>
            <ProjectSelect value={viewedRoot} onChange={setViewedRoot} />
          </div>

          {/*
            The project-scoped tabs read the VIEWED PROJECT, so with none selected several of them
            are empty for a reason the user can't see from the tables. Say it once, here.
          */}
          {!data.projectRoot && (
            <div className="mb-6 flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 text-[12px]">
              <FolderOpen size={14} className="shrink-0 mt-px text-amber-500" />
              <span className="text-(--ink-2)">
                No project is open, so the project&rsquo;s marketplace, rules, and command table are empty. Installed
                and curated plugins, plus every registered marketplace, are read from{" "}
                <span className="font-mono">~/.claude</span> and are shown either way.{" "}
                <Link to="/" className="text-primary underline">
                  Open a project
                </Link>
                .
              </span>
            </div>
          )}

          <div className="tabs mb-6">
            {TABS.map((t) => (
              <button key={t.id} type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === "plugins" && <CommandCenter installedPlugins={data.installedPlugins} commands={data.commands} />}
          {/* No loader data: this tab reads nothing until the user asks it to run something. */}
          {tab === "stats" && <UsageStatsTab />}
          {tab === "marketplace" && (
            <MarketplaceTab
              marketplaces={data.marketplaces}
              projectMarketplace={data.projectMarketplace}
              ruleLibrary={data.ruleLibrary}
            />
          )}
          {tab === "curated" && <CuratedTools plugins={data.curated} />}
          {tab === "rules" && <RulesTab projectRules={data.projectRules} />}
          {tab === "agents" && <AgentsTab agents={data.agents} />}
        </div>
      </div>
    </div>
  );
}
