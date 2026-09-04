// /templates — the global tier's own editing surface, reached from the HAMBURGER MENU rather
// than the per-project nav bar: a report default is the same on every project, so it belongs
// beside the concerns (/docs, /tools) that don't need a project open. Low edit frequency was the
// other reason — closer to a settings surface than a frequently-visited one.
//
// Tabbed like /tools's TABS pattern: "Reports", "Handoffs", "Agent Types" and "Project Tags"
// today. A future global-template class (anything else that lands in a similar per-machine store)
// gets a new tab here instead of a new hamburger entry — which is exactly how Handoffs arrived
// (`034`), over `handoff-defaults.ts`'s own `~/.claude/maestro-handoff-defaults.sqlite`.
//
// No project context anywhere on this page — no ProjectSelect, no projectRoot threaded into any
// of its calls. Every store behind it (report-defaults.ts, agent-types.ts, project-tags.ts) is
// global, not project-scoped.

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import TopNav from "../components/top-nav";
import GlobalReportsTab from "../components/tabs/global-reports-tab";
import GlobalHandoffsTab from "../components/tabs/global-handoffs-tab";
import AgentTypesTab from "../components/tabs/agent-types-tab";
import ProjectTagsTab from "../components/tabs/project-tags-tab";
import { callMain } from "../utils/call-main";

export const Route = createFileRoute("/templates")({
  loader: async () => {
    const [reports, handoffs, agentTypes, projectTags, agentProjectTags] = await Promise.all([
      callMain(() => window.maestro.templates.reports.list()),
      callMain(() => window.maestro.templates.handoffs.list()),
      callMain(() => window.maestro.templates.agentTypes.list()),
      callMain(() => window.maestro.templates.projectTags.list()),
      callMain(() => window.maestro.templates.agentProjectTags.list()),
    ]);
    return { reports, handoffs, agentTypes, projectTags, agentProjectTags };
  },
  component: TemplatesPage,
});

type TabId = "reports" | "handoffs" | "agent-types" | "project-tags";

const TABS: { id: TabId; label: string }[] = [
  { id: "reports", label: "Reports" },
  { id: "handoffs", label: "Handoffs" },
  { id: "agent-types", label: "Agent Types" },
  { id: "project-tags", label: "Project Tags" },
];

function TemplatesPage() {
  const { reports, handoffs, agentTypes, projectTags, agentProjectTags } = Route.useLoaderData();
  const [tab, setTab] = useState<TabId>("reports");

  const failed = !reports.ok
    ? reports
    : !handoffs.ok
      ? handoffs
      : !agentTypes.ok
        ? agentTypes
        : !projectTags.ok
          ? projectTags
          : !agentProjectTags.ok
            ? agentProjectTags
            : null;
  if (failed) {
    return (
      <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) flex flex-col overflow-hidden">
        <TopNav />
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-500/10 max-w-lg">
            <AlertTriangle size={16} className="shrink-0 mt-px text-red-500" />
            <div>
              <p className="text-[13px] text-(--ink) m-0 mb-1">Templates could not be loaded.</p>
              <p className="text-[12px] text-(--ink-2) m-0">{failed.error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) overflow-hidden flex flex-col">
      <TopNav />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-10">
          <div className="mb-8">
            <span className="section-label mb-3 inline-block">AI Dev Tools</span>
            <h1 className="text-2xl font-semibold text-(--ink) m-0 mb-1">Templates</h1>
            <p className="text-[13px] text-subtle m-0">
              Global defaults every project falls back to when it has no override of its own.
            </p>
          </div>

          <div className="tabs mb-6">
            {TABS.map((t) => (
              <button key={t.id} type="button" aria-selected={tab === t.id} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </div>

          {tab === "reports" && reports.ok && <GlobalReportsTab initial={reports.value} />}
          {tab === "handoffs" && handoffs.ok && <GlobalHandoffsTab initial={handoffs.value} />}
          {tab === "agent-types" && agentTypes.ok && <AgentTypesTab initial={agentTypes.value} />}
          {tab === "project-tags" && projectTags.ok && agentProjectTags.ok && (
            <ProjectTagsTab initial={projectTags.value} initialAgentTags={agentProjectTags.value} />
          )}
        </div>
      </div>
    </div>
  );
}
