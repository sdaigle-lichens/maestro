// /skills — every skill this project, this machine, or an installed plugin makes available, with
// its tags editable inline. Split out of /tools' old Skills tab into its own top-level page: skills
// are edited often enough (especially with "Update skill tags" below) to earn a place in the
// project nav rather than a tab buried behind Plugins/Marketplace/Stats/Rules/Agents.
//
// Reuses `data:tools` — the same one-call loader `/tools` reads from — rather than a narrower
// channel of its own: this page only ever needed `.skills` off that payload, and a second channel
// would be a second thing to keep discovering the same set the same way.

import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AlertTriangle, Sparkles } from "lucide-react";
import Button from "@repo/ui/button";
import { toast } from "@repo/ui/toast";
import TopNav from "../components/top-nav";
import ProjectSelect from "../components/project-select";
import DiscoveredDefinitionsList from "../components/tabs/discovered-definitions";
import CreateLink from "../components/tabs/create-link";
import { callMain, type CallResult } from "../utils/call-main";
import { getToolsData, type ToolsData, type SkillTag } from "../utils/tools";
import { useProject } from "../utils/project-context";
import { useSession } from "../utils/session-context";

export const Route = createFileRoute("/skills")({
  loader: async () => callMain(() => getToolsData()),
  component: SkillsPage,
});

function SkillsPage() {
  const loaderResult = Route.useLoaderData();
  const { current, recent } = useProject();
  const session = useSession();
  const [viewedRoot, setViewedRoot] = useState<string | null>(current?.root ?? null);
  const [result, setResult] = useState<CallResult<ToolsData>>(loaderResult);
  const [updating, setUpdating] = useState(false);

  // Same "adopt the app's current project once it's known" fix as /tools — see the note there.
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
              <p className="text-[13px] text-(--ink) m-0 mb-1">Skills could not be loaded.</p>
              <p className="text-[12px] text-(--ink-2) m-0">{result.error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const data = result.value;

  function handleTagsChange(id: string, tags: SkillTag[]) {
    setResult((prev) =>
      prev.ok ? { ...prev, value: { ...prev.value, skills: prev.value.skills.map((s) => (s.id === id ? { ...s, tags } : s)) } } : prev
    );
  }

  async function handleUpdateSkillTags() {
    setUpdating(true);
    try {
      const res = await callMain(() => window.maestro.claude.preview({ kind: "update-skill-tags" }));
      if (!res.ok) {
        toast(<>Could not start: {res.error}</>, { variant: "error" });
        return;
      }
      if (!res.value.token) {
        toast(<>{res.value.unavailable ?? "The Claude CLI is not available."}</>, { variant: "error" });
        return;
      }
      // Opens the pane if it's closed, and seeds it with the description/tags table — no
      // confirmation dialog in between, per the button's own name and the plan it implements.
      await session.handoff(res.value.token);
    } finally {
      setUpdating(false);
    }
  }

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) flex flex-col overflow-hidden">
      <TopNav />

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 pb-16 pt-10">
          <div className="mb-8 flex items-start justify-between gap-4">
            <div>
              <span className="section-label mb-3 inline-block">AI Dev Tools</span>
              <h1 className="text-2xl font-semibold text-(--ink) m-0 mb-1">Skills</h1>
              <p className="text-[13px] text-subtle m-0">
                Every skill this project, this machine, or an installed plugin makes available, tagged with the agent(s)
                it belongs to.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ProjectSelect value={viewedRoot} onChange={setViewedRoot} />
              <span title={data.projectRoot ? undefined : "Open a project to update its skills' tags."}>
                <Button
                  variant="secondary"
                  icon={<Sparkles size={14} />}
                  loading={updating}
                  disabled={!data.projectRoot}
                  onClick={() => void handleUpdateSkillTags()}
                >
                  Update skill tags
                </Button>
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-6">
            <DiscoveredDefinitionsList items={data.skills} emptyLabel="skills" onTagsChange={handleTagsChange} />
            <CreateLink to="/create-skill" label="Create a skill" />
          </div>
        </div>
      </div>
    </div>
  );
}
