// /agents — browse the project's subagents, read the report a run would actually receive, and
// edit an agent's properties and its cosmetic avatar in place.
//
// Three panes inside the real TopNav: the agent list, the agent card, and the Interactions pane.
// A single horizontal scroller wraps the pane row at a 1120px floor, so a narrow window scrolls
// rather than crushing the centre column.
//
// ONE EDIT SESSION, SIX WRITE PATHS. Pressing Edit — from the card footer, a list row's pencil, or
// the Interactions pencil — clones the agent into a draft and every control edits the draft.
// Nothing touches disk until Save, which then fans out to the channel that owns each field:
//
//   report        reports:save                     -> .claude/reports/<agent>.md, a PROJECT override
//   avatar        avatar:set                       -> ~/.claude/maestro-avatars.sqlite, global
//   type          template:agent-types:save        -> ~/.claude/maestro-agent-types.sqlite, global
//   project tag   template:agent-project-tags:save -> ~/.claude/maestro-agent-project-tags.sqlite
//   description   agent:describe                   -> the agent's OWN .md frontmatter
//   skills        config:save (workflows slice)    -> .claude/maestro.json's workflow_instances
//
// The description is the odd one and deliberately so: it is the line Claude Code itself reads to
// decide when to dispatch the agent, so a copy kept beside the app would show one sentence here
// while every run used another. See src/core/agent-descriptions.ts.
//
// Skills are the instance's, not the agent's: `loaded_skills` are injected by the SubagentStart
// hook before the agent works, `referenced_skills` are only offered. Each chip carries a toggle
// between the two, because a control that showed only "attached" would silently demote every
// loaded skill on the next save.

import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Users } from "lucide-react";
import { toast } from "@repo/ui/toast";
import TopNav from "../components/top-nav";
import AgentList, { type AgentListItem } from "../components/agents/agent-list";
import AgentCard from "../components/agents/agent-card";
import InteractionsPane from "../components/agents/interactions-pane";
import { PANE_SURFACES, RIGHT_PANE_DEFAULT, type AgentDraft, type AgentSkill } from "../components/agents/agent-shared";
import { defaultAvatarLayers } from "../utils/avatar";
import { callMain, type CallResult } from "../utils/call-main";
import { getToolsData, type ToolsData } from "../utils/tools";
import { useProject } from "../utils/project-context";
import {
  AGENT_TYPES,
  AVATAR_CATEGORIES,
  GLOBAL_TAG,
  isEditableAgentSource,
  type AgentType,
  type AvatarCategory,
  type AvatarLayers,
  type MaestroInstanceV3,
  type ResolvedReport,
  type WorkflowsData,
} from "../../../shared/ipc";

export const Route = createFileRoute("/agents")({
  loader: async () => callMain(() => getToolsData()),
  component: AgentsPage,
});

/** The per-agent attributes that live in a global store rather than on the agent's own file. */
interface AgentAttributes {
  types: Record<string, AgentType>;
  projectTags: Record<string, string>;
  avatars: Record<string, AvatarLayers>;
  catalog: string[];
}

const EMPTY_ATTRIBUTES: AgentAttributes = { types: {}, projectTags: {}, avatars: {}, catalog: [] };
const NO_REPORT: ResolvedReport = { source: "none", content: "" };

function sourceLabel(source: ResolvedReport["source"]): string {
  if (source === "project") return "Project override";
  if (source === "global") return "Global default";
  return "No report configured";
}

function sameLayers(a: AvatarLayers, b: AvatarLayers): boolean {
  return AVATAR_CATEGORIES.every((cat) => a[cat] === b[cat]);
}

function sameSkills(a: AgentSkill[], b: AgentSkill[]): boolean {
  return a.length === b.length && a.every((s, i) => s.id === b[i].id && s.mode === b[i].mode);
}

/** The instance's two skill lists, flattened into the chip model the card renders. */
function skillsOf(instance: MaestroInstanceV3 | null): AgentSkill[] {
  if (!instance) return [];
  return [
    ...instance.loaded_skills.map((id): AgentSkill => ({ id, mode: "loaded" })),
    ...instance.referenced_skills.map((id): AgentSkill => ({ id, mode: "referenced" })),
  ];
}

function AgentsPage() {
  const loaderResult = Route.useLoaderData();
  const { current } = useProject();

  const [result, setResult] = useState<CallResult<ToolsData>>(loaderResult);
  const [workflows, setWorkflows] = useState<WorkflowsData | null>(null);
  const [attributes, setAttributes] = useState<AgentAttributes>(EMPTY_ATTRIBUTES);

  const [selected, setSelected] = useState<string | null>(null);
  const [report, setReport] = useState<ResolvedReport>(NO_REPORT);

  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [pendingEdit, setPendingEdit] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activeCat, setActiveCat] = useState<AvatarCategory>("hair");
  const [query, setQuery] = useState("");
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [rightWidth, setRightWidth] = useState(RIGHT_PANE_DEFAULT);

  const projectRoot = current?.root ?? null;

  // Everything on this page reads the OPEN project — the report resolution, the workflow instances
  // and the agent list all have to agree about which project they describe, and only the top nav's
  // folder button changes it.
  const refresh = useCallback(async () => {
    const [tools, flows, types, tags, avatars, catalog] = await Promise.all([
      callMain(() => getToolsData()),
      callMain(() => window.maestro.data.workflows()),
      callMain(() => window.maestro.templates.agentTypes.list()),
      callMain(() => window.maestro.templates.agentProjectTags.list()),
      callMain(() => window.maestro.avatar.list()),
      callMain(() => window.maestro.templates.projectTags.list()),
    ]);
    setResult(tools);
    setWorkflows(flows.ok ? flows.value : null);
    setAttributes({
      types: types.ok ? types.value : {},
      projectTags: tags.ok ? tags.value : {},
      avatars: avatars.ok ? avatars.value : {},
      catalog: catalog.ok ? catalog.value : [],
    });
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, projectRoot]);

  // The report is the one per-agent thing that is project-scoped, so it is the one thing refetched
  // per selection. Avatars arrive with the rest of the global attributes, in one read.
  useEffect(() => {
    if (!selected) {
      setReport(NO_REPORT);
      return;
    }
    let cancelled = false;
    void callMain(() => window.maestro.reports.get(selected)).then((res) => {
      if (cancelled) return;
      if (!res.ok) toast(<>Could not load this agent&rsquo;s report: {res.error}</>, { variant: "error" });
      setReport(res.ok ? res.value : NO_REPORT);
    });
    return () => {
      cancelled = true;
    };
  }, [selected, projectRoot]);

  const data = result.ok ? result.value : null;
  const config = workflows?.config ?? null;

  // The draft's avatar wins for the selected row, so the list thumb tracks the arrows live while
  // the user is cycling parts. Agents with nothing saved fall back to the neutral placeholder.
  const listItems: AgentListItem[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.agents ?? [])
      .filter((a) => !q || a.id.toLowerCase().includes(q) || a.description.toLowerCase().includes(q))
      .map((a) => ({
        id: a.id,
        description: a.description,
        layers: (a.id === selected && draft ? draft.layers : attributes.avatars[a.id]) ?? defaultAvatarLayers(),
      }));
  }, [data, query, selected, draft, attributes.avatars]);

  const agent = data?.agents.find((a) => a.id === selected) ?? null;
  const instance = useMemo<MaestroInstanceV3 | null>(
    () => config?.workflow_instances.find((i) => i.agent === selected) ?? null,
    [config, selected]
  );

  const base: AgentDraft | null = useMemo(() => {
    if (!agent) return null;
    return {
      id: agent.id,
      description: agent.description,
      type: attributes.types[agent.id] ?? AGENT_TYPES[0],
      projectTag: attributes.projectTags[agent.id] ?? GLOBAL_TAG,
      layers: attributes.avatars[agent.id] ?? defaultAvatarLayers(),
      skills: skillsOf(instance),
      report: report.content,
    };
  }, [agent, attributes, instance, report]);

  const live = draft ?? base;
  const editing = draft !== null;

  const descriptionEditable = agent !== null && isEditableAgentSource(agent.source);
  const skillsEditable = instance !== null && workflows !== null && !workflows.seeded;
  /**
   * One line of explanation, and it lives in the card's FOOTER rather than beside the field it
   * describes: anything inside the card changes the card's height, and the card being the same
   * height in both modes is what stops the page reflowing under the pointer on Edit.
   *
   * A caveat outranks the ordinary case — a field the user is about to find disabled matters more
   * than where a working one writes to.
   */
  const footerNote = !instance
    ? `${selected ?? "This agent"} isn't in this project's workflow yet — add it on /workflows to give it skills.`
    : workflows?.seeded
      ? "This project has no maestro.json yet — save a workflow on /workflows before editing skills here."
      : !descriptionEditable
        ? `Shipped by the ${agent?.source} plugin, whose files a plugin update overwrites — edit its description there.`
        : "The description is written back into this agent's own .md — it is the line Claude Code reads when deciding to dispatch it.";

  const projectTagOptions = useMemo(() => {
    const seen = [GLOBAL_TAG, ...attributes.catalog];
    if (live && !seen.includes(live.projectTag)) seen.push(live.projectTag);
    return [...new Set(seen)];
  }, [attributes.catalog, live]);

  const nextSkill = useMemo(() => {
    if (!live || !config) return null;
    const attached = new Set(live.skills.map((s) => s.id));
    return config.skills_available.find((s) => !attached.has(s)) ?? null;
  }, [live, config]);

  function startEdit(id?: string) {
    const target = id ?? selected;
    if (!target) return;
    if (target !== selected) {
      // A pencil on an unselected row selects it first; its report and avatar are still loading, so
      // the draft is built on the next render instead of from stale state.
      setSelected(target);
      setDraft(null);
      setPendingEdit(true);
      return;
    }
    if (base) setDraft({ ...base, layers: { ...base.layers }, skills: base.skills.map((s) => ({ ...s })) });
  }

  // A pencil press on a row that wasn't selected: enter edit as soon as that agent's data lands.
  useEffect(() => {
    if (!pendingEdit || !base) return;
    setDraft({ ...base, layers: { ...base.layers }, skills: base.skills.map((s) => ({ ...s })) });
    setPendingEdit(false);
  }, [pendingEdit, base]);

  function patch(next: Partial<AgentDraft>) {
    setDraft((d) => (d ? { ...d, ...next } : d));
  }

  function toggleSkill(index: number) {
    setDraft((d) =>
      d
        ? {
            ...d,
            // Ticking selects as REFERENCED, the same default the workflow canvas's instance picker
            // uses: offering a skill is the reversible choice, loading it costs context on every run.
            skills: d.skills.map((s, i) => (i === index ? { ...s, mode: s.mode === null ? "referenced" : null } : s)),
          }
        : d
    );
  }

  function cycleSkillMode(index: number) {
    setDraft((d) =>
      d
        ? {
            ...d,
            skills: d.skills.map((s, i) =>
              i === index ? { ...s, mode: s.mode === "loaded" ? "referenced" : "loaded" } : s
            ),
          }
        : d
    );
  }

  function addSkill() {
    if (!nextSkill) return;
    setDraft((d) => (d ? { ...d, skills: [...d.skills, { id: nextSkill, mode: "referenced" }] } : d));
  }

  async function saveSkills(d: AgentDraft): Promise<string | null> {
    if (!instance) return null;
    // Re-read the config immediately before writing it: this page holds it for as long as the user
    // is reading, and the workflows canvas may have saved in between. The slice merge replaces the
    // whole workflows block, so a stale copy would silently revert someone else's edit.
    const fresh = await callMain(() => window.maestro.data.workflows());
    if (!fresh.ok) return fresh.error;
    const cfg = fresh.value.config;
    const loaded = d.skills.filter((s) => s.mode === "loaded").map((s) => s.id);
    const referenced = d.skills.filter((s) => s.mode === "referenced").map((s) => s.id);
    const res = await callMain(() =>
      window.maestro.config.save({
        sliceType: "workflows",
        slice: {
          agents_available: cfg.agents_available,
          skills_available: cfg.skills_available,
          workflow_instances: cfg.workflow_instances.map((inst) =>
            inst.name === instance.name ? { ...inst, loaded_skills: loaded, referenced_skills: referenced } : inst
          ),
          workflows: cfg.workflows,
        },
      })
    );
    return res.ok ? null : res.error;
  }

  async function handleSave() {
    const d = draft;
    if (!d || !base) return;
    setSaving(true);
    const failures: string[] = [];
    try {
      if (d.report !== base.report) {
        const res = await callMain(() => window.maestro.reports.save(d.id, d.report));
        if (res.ok) setReport(res.value);
        else failures.push(`report: ${res.error}`);
      }
      if (!sameLayers(d.layers, base.layers)) {
        const res = await callMain(() => window.maestro.avatar.set(d.id, d.layers));
        if (!res.ok) failures.push(`avatar: ${res.error}`);
      }
      if (d.type !== base.type) {
        const res = await callMain(() => window.maestro.templates.agentTypes.save(d.id, d.type));
        if (!res.ok) failures.push(`type: ${res.error}`);
      }
      if (d.projectTag !== base.projectTag) {
        const res = await callMain(() => window.maestro.templates.agentProjectTags.save(d.id, d.projectTag));
        if (!res.ok) failures.push(`project tag: ${res.error}`);
      }
      if (descriptionEditable && d.description.trim() !== base.description.trim()) {
        const res = await callMain(() => window.maestro.agents.describe(d.id, d.description));
        if (!res.ok) failures.push(`description: ${res.error}`);
      }
      if (skillsEditable && !sameSkills(d.skills, base.skills)) {
        const error = await saveSkills(d);
        if (error) failures.push(`skills: ${error}`);
      }

      await refresh();

      if (failures.length > 0) {
        toast(<>Some changes could not be saved — {failures.join("; ")}</>, { variant: "error" });
        return;
      }
      setDraft(null);
      toast(
        <>
          Saved <span className="font-mono text-(--ink)">{d.id}</span>.
        </>
      );
    } finally {
      setSaving(false);
    }
  }

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

  const paneNote = selected
    ? `${sourceLabel(report.source)} — saving always writes this project's override at .claude/reports/${selected}.md, so editing this agent never changes what another agent resolves to.`
    : null;

  return (
    <div
      className="w-full h-screen bg-(--bg) font-sans text-[13px] text-(--ink) overflow-hidden flex flex-col"
      style={PANE_SURFACES}
    >
      {/*
        One horizontal scroller wrapping the nav AND the pane row, so chrome and content scroll
        together and nothing clips on a narrow window. This is a desktop window — there are no
        breakpoints, just a floor.
      */}
      <div className="flex-1 min-h-0 overflow-x-auto flex flex-col">
        <div className="flex-1 min-h-0 min-w-[1120px] flex flex-col">
          <TopNav />

          <div className="flex-1 min-h-0 flex">
            <AgentList
              items={listItems}
              selected={selected}
              open={leftOpen}
              query={query}
              onQueryChange={setQuery}
              onToggleOpen={() => setLeftOpen((v) => !v)}
              onSelect={(id) => {
                setSelected(id);
                setDraft(null);
              }}
              onEdit={(id) => startEdit(id)}
            />

            <main className="flex-1 min-w-[560px] overflow-y-auto bg-(--bg)">
              {live ? (
                <AgentCard
                  name={live.id}
                  description={live.description}
                  type={live.type}
                  projectTag={live.projectTag}
                  projectTagOptions={projectTagOptions}
                  layers={live.layers}
                  skills={live.skills}
                  editing={editing}
                  saving={saving}
                  activeCat={activeCat}
                  descriptionEditable={descriptionEditable}
                  skillsEditable={skillsEditable}
                  footerNote={footerNote}
                  nextSkill={nextSkill}
                  onActiveCat={setActiveCat}
                  onDescription={(description) => patch({ description })}
                  onType={(type) => patch({ type })}
                  onProjectTag={(projectTag) => patch({ projectTag })}
                  onLayers={(layers) => patch({ layers })}
                  onToggleSkill={toggleSkill}
                  onCycleSkillMode={cycleSkillMode}
                  onAddSkill={addSkill}
                  onStartEdit={() => startEdit()}
                  onCancel={() => setDraft(null)}
                  onSave={() => void handleSave()}
                />
              ) : (
                <div className="h-full flex flex-col items-center justify-center gap-2 text-center text-(--ink-2)">
                  <Users size={18} className="text-(--ink-3)" />
                  <p className="text-[12px] m-0">Select an agent on the left to see its card.</p>
                </div>
              )}
            </main>

            <InteractionsPane
              report={live?.report ?? ""}
              editing={editing}
              open={rightOpen}
              width={rightWidth}
              note={paneNote}
              onToggleOpen={() => setRightOpen((v) => !v)}
              onStartEdit={() => startEdit()}
              onReport={(value) => patch({ report: value })}
              onWidth={setRightWidth}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
