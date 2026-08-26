// /agents — replaces the Tools "Agents" tab, the same graduation /skills got when it grew an
// inline editor: a tab-behind-a-hamburger stopped fitting once there was something to DO here
// beyond reading a table.
//
// Left pane is the exact same list `DiscoveredDefinitionsList` renders today (no new status
// badge — confirmed against the task), sourced from the shared `data:tools` payload exactly as
// /skills reuses it for its own list. Right pane shows the RESOLVED report for the selected
// agent — project override, else global default, else empty — via `reports:get`/`reports:save`,
// which is the same `report-resolution.ts` order the SubagentStart hook uses, so this page can
// never show something other than what a run would actually receive.
//
// Save semantics: any edit + save always writes a PROJECT override keyed by the agent's OWN name
// (`reports:save` -> `saveProjectReportOverride`), never whatever id it may have inherited from
// the global tier. It is a plain file write — no Claude session, no claude:preview/run, no token.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, FileText, Save } from "lucide-react";
import Button from "@repo/ui/button";
import { Textarea } from "@repo/ui/field";
import { toast } from "@repo/ui/toast";
import TopNav from "../components/top-nav";
import ProjectSelect from "../components/project-select";
import DiscoveredDefinitionsList from "../components/tabs/discovered-definitions";
import CreateLink from "../components/tabs/create-link";
import { callMain, type CallResult } from "../utils/call-main";
import { getToolsData, type ToolsData } from "../utils/tools";
import { useProject } from "../utils/project-context";

export const Route = createFileRoute("/agents")({
  loader: async () => callMain(() => getToolsData()),
  component: AgentsPage,
});

type ReportSource = "project" | "global" | "none";
type Phase = "idle" | "loading" | "saving";

function sourceLabel(source: ReportSource): string {
  if (source === "project") return "Project override";
  if (source === "global") return "Global default";
  return "No report configured";
}

function AgentsPage() {
  const loaderResult = Route.useLoaderData();
  const { current, recent } = useProject();
  const [viewedRoot, setViewedRoot] = useState<string | null>(current?.root ?? null);
  const [result, setResult] = useState<CallResult<ToolsData>>(loaderResult);

  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [source, setSource] = useState<ReportSource>("none");
  const [phase, setPhase] = useState<Phase>("idle");
  const [dirty, setDirty] = useState(false);

  // Same "adopt the app's current project once it's known" fix as /tools and /skills.
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

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    setPhase("loading");
    void callMain(() => window.maestro.reports.get(selected)).then((res) => {
      if (cancelled) return;
      setPhase("idle");
      if (!res.ok) {
        toast(<>Could not load this agent&rsquo;s report: {res.error}</>, { variant: "error" });
        return;
      }
      setContent(res.value.content);
      setSource(res.value.source);
      setDirty(false);
    });
    return () => {
      cancelled = true;
    };
    // Re-fetch whenever the selected agent OR the viewed project changes — the same agent name in
    // a different project can resolve to a different report.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, viewedRoot]);

  if (!result.ok) {
    return (
      <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) flex flex-col overflow-hidden">
        <TopNav />
        <div className="flex-1 flex items-center justify-center px-6">
          <div className="flex items-start gap-2 px-4 py-3 rounded-lg bg-red-500/10 max-w-lg">
            <AlertTriangle size={16} className="shrink-0 mt-px text-red-500" />
            <div>
              <p className="text-[13px] text-(--ink) m-0 mb-1">Agents could not be loaded.</p>
              <p className="text-[12px] text-(--ink-2) m-0">{result.error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const data = result.value;

  async function handleSave() {
    if (!selected) return;
    setPhase("saving");
    try {
      const res = await callMain(() => window.maestro.reports.save(selected, content));
      if (!res.ok) {
        toast(<>Could not save the report: {res.error}</>, { variant: "error" });
        return;
      }
      setSource(res.value.source);
      setDirty(false);
      toast(
        <>
          Saved as this project&rsquo;s override for <span className="font-mono text-(--ink)">{selected}</span>.
        </>
      );
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) overflow-hidden flex flex-col">
      <TopNav />

      <div className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: "1fr 420px" }}>
        {/* Left pane — the discovered-agents list, unchanged from the old Tools tab. */}
        <div className="overflow-y-auto">
          <div className="mx-auto max-w-3xl px-6 pb-16 pt-10">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div>
                <span className="section-label mb-3 inline-block">AI Dev Tools</span>
                <h1 className="text-2xl font-semibold text-(--ink) m-0 mb-1">Agents</h1>
                <p className="text-[13px] text-subtle m-0">
                  Every subagent this project, this machine, or an installed plugin makes available. Select one to
                  see its resolved report.
                </p>
              </div>
              <ProjectSelect value={viewedRoot} onChange={setViewedRoot} />
            </div>

            <div className="flex flex-col gap-6">
              <DiscoveredDefinitionsList
                items={data.agents}
                emptyLabel="agents"
                selectedId={selected}
                onSelect={setSelected}
              />
              <CreateLink to="/create-subagent" label="Create a subagent" />
            </div>
          </div>
        </div>

        {/* Right pane — the resolved report for the selected agent, one freeform editor. */}
        <div className="border-l border-(--line) overflow-y-auto flex flex-col p-4 gap-3">
          {!selected ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center text-(--ink-2)">
              <FileText size={18} className="text-(--ink-3)" />
              <p className="text-[12px] m-0">Select an agent on the left to view its resolved report.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-mono text-[13px] text-(--ink)">{selected}</div>
                  <div className="text-[11px] text-(--ink-3)">{sourceLabel(source)}</div>
                </div>
                <Button
                  variant="primary"
                  icon={phase === "saving" ? undefined : <Save size={13} />}
                  loading={phase === "saving"}
                  disabled={!dirty || phase === "loading"}
                  onClick={() => void handleSave()}
                >
                  Save
                </Button>
              </div>

              <div className="flex-1 min-h-0 flex flex-col">
                <Textarea
                  id="agent-report-editor"
                  value={content}
                  onChange={(v) => {
                    setContent(v);
                    setDirty(true);
                  }}
                  rows={24}
                  placeholder="No report configured for this agent. Write one here — saving creates this project's override."
                />
              </div>

              <p className="text-[11px] text-(--ink-3) m-0">
                Saving always writes a project override at{" "}
                <span className="font-mono">.claude/reports/{selected}.md</span> — editing this agent never changes
                what another agent resolves to, even one currently sharing the same global default.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
