import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useStore } from "@tanstack/react-store";
import Button from "@repo/ui/button";
import { Plus, Sparkles } from "lucide-react";
import { toast } from "@repo/ui/toast";
import TopNav from "../components/top-nav";
import WorkflowCanvas from "../components/workflow-canvas";
import SeededBanner from "../components/seeded-banner";
import ConfigIssueBanner from "../components/config-issue-banner";
import DetectedChain from "../components/detected-chain";
import { groupBySource, sourceLabel, CollapsibleGroup } from "../components/source-group";
import { callMain } from "../utils/call-main";
import {
  getMaestroConfig,
  reseedMaestroConfig,
  submitMaestroConfig,
  type MaestroWorkflowV3,
  type MaestroConfigResult,
} from "../utils/maestro";
import {
  workflowStore,
  seedWorkflowStore,
  replaceConfig as storeReplaceConfig,
  setActiveWorkflowIdx,
  setAgentsAvailable as storeSetAgentsAvailable,
  setSkillsAvailable as storeSetSkillsAvailable,
  setInstances as storeSetInstances,
  updateWorkflow as storeUpdateWorkflow,
  renameWorkflow as storeRenameWorkflow,
  removeWorkflow as storeRemoveWorkflow,
  addWorkflow as storeAddWorkflow,
} from "../store/workflow-store";

export const Route = createFileRoute("/workflows")({
  loader: () => getMaestroConfig(),
  component: WorkflowsPage,
});

type Phase = "idle" | "saving";

/**
 * The agents every seed carries whatever the repo is. Subtracting them from the config's instances
 * leaves the implementation chain — the part detection proposes and the user may correct.
 */
const CORE_SEED_AGENTS = ["test", "reviewer", "refactor", "scribe"];

function WorkflowsPage() {
  const loaderData = Route.useLoaderData() as MaestroConfigResult;
  const { bundledAgents, projectSkills } = loaderData;
  const router = useRouter();

  // Seed the store from loader data. Re-renders within a project won't clobber in-memory edits;
  // a project switch replaces the config outright — see seedWorkflowStore.
  useEffect(() => {
    seedWorkflowStore(loaderData.config, loaderData.projectRoot);
  }, [loaderData.config, loaderData.projectRoot]);

  const config = useStore(workflowStore, (s) => s.config);
  const activeWorkflowIdx = useStore(workflowStore, (s) => s.activeWorkflowIdx);

  const [phase, setPhase] = useState<Phase>("idle");
  const [reseeding, setReseeding] = useState(false);
  const [creatingWorkflow, setCreatingWorkflow] = useState(false);
  const [newWorkflowName, setNewWorkflowName] = useState("");
  const [newWorkflowSource, setNewWorkflowSource] = useState<number | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);

  const allAgents = bundledAgents;
  const allSkills = projectSkills;

  // What the instance picker's fork affordance (`041`) may offer as a source. `forkAgent` throws
  // on a project-tier agent — there is nothing to copy from, it is already in `.claude/agents/` —
  // which is why `/agents` hides its own fork button for those (`agent-card.tsx`'s
  // `isProjectTier`). Deriving the list here applies the same rule rather than letting the picker
  // offer a choice that can only fail; a fork's own output is project-tier, so it drops out of
  // this list the moment the loader invalidation below reloads the discovered agents.
  const forkableAgentIds = bundledAgents.filter((a) => a.source !== "project").map((a) => a.id);

  const openCreateWorkflow = () => {
    setNewWorkflowName("");
    setNewWorkflowSource(null);
    setCreatingWorkflow(true);
    setTimeout(() => createInputRef.current?.focus(), 0);
  };

  const confirmCreateWorkflow = () => {
    if (!config) return;
    const source = newWorkflowSource !== null ? config.workflows[newWorkflowSource] : null;
    const name =
      newWorkflowName.trim() || (source ? `Copy of ${source.name}` : `Workflow ${config.workflows.length + 1}`);
    const newWf: MaestroWorkflowV3 = source
      ? { name, nodes: structuredClone(source.nodes), edges: structuredClone(source.edges) }
      : { name, nodes: [], edges: [] };
    storeAddWorkflow(newWf);
    setCreatingWorkflow(false);
  };

  const cancelCreateWorkflow = () => setCreatingWorkflow(false);

  /**
   * The user correcting the detected implementation chain. The seed builder lives in the main
   * process — it is the same `defaultV3Config` the loader used, so a corrected chain produces
   * exactly the graph the repo would have got had detection been right in the first place.
   * Nothing is written: the project stays unconfigured until Save.
   */
  const changeImplAgents = async (implAgents: string[]) => {
    setReseeding(true);
    try {
      const res = await callMain(() => reseedMaestroConfig(implAgents));
      if (!res.ok) {
        toast(<>Could not re-seed the workflows: {res.error}</>, { variant: "error" });
        return;
      }
      storeReplaceConfig(res.value, loaderData.projectRoot);
    } finally {
      setReseeding(false);
    }
  };

  const handleSubmit = async () => {
    if (!config) return;
    setPhase("saving");
    // try/finally, not a bare `setPhase("idle")` after the await: the handler rejects when no
    // project is open, and on that path an unguarded reset never runs — leaving the button
    // spinning with no toast and an unhandled rejection in the console.
    try {
      // One call: write maestro.json, re-render the orchestrator's HANDOFFS table, apply rules.
      // The web app stopped after writing a /tmp result file and needed a Claude session to run
      // the last two steps.
      const res = await callMain(() =>
        submitMaestroConfig({
          data: {
            sliceType: "workflows",
            slice: {
              agents_available: config.agents_available,
              skills_available: config.skills_available,
              workflow_instances: config.workflow_instances,
              workflows: config.workflows,
            },
          },
        })
      );

      if (!res.ok) {
        toast(<>Could not save: {res.error}</>, { variant: "error" });
        return;
      }

      // The write succeeded, so `seeded` — computed by the loader from whether maestro.json
      // existed when the route loaded — is now stale, and the banner would keep telling the user
      // their workflows are "not saved" after they just saved them. Loader data is only refreshed
      // by an invalidation, and nothing else triggers one here: a save doesn't navigate, and the
      // `project:changed` broadcast that ProjectProvider invalidates on doesn't fire either.
      // Safe for the canvas: seedWorkflowStore keeps the in-memory config when projectRoot is
      // unchanged, so re-running the loader cannot discard unsaved edits.
      void router.invalidate();

      const result = res.value;
      if (result.warnings.length > 0) {
        toast(
          <>
            Saved to <span className="font-mono text-(--ink)">{result.configPath}</span>. {result.warnings.join(" ")}
          </>,
          // The save succeeded (res.ok is true) — a warning here is a caveat, not a failure, so it
          // gets the amber "warning" toast rather than red "error", which read as though the save
          // itself had failed.
          { variant: "warning" }
        );
        return;
      }
      toast(
        <>
          Saved to <span className="font-mono text-(--ink)">{result.configPath}</span> and re-rendered{" "}
          {result.render.rows.length} workflow{result.render.rows.length === 1 ? "" : "s"} into the orchestrator.
        </>
      );
    } finally {
      setPhase("idle");
    }
  };

  /**
   * The instance picker's fork-into-a-second-agent affordance (`041`) just wrote
   * `.claude/agents/<newAgentName>.md` and its provenance record. Two things make it selectable
   * immediately, without a restart: add it to `config.agents_available` (the store update is what
   * `availableAgentsForNew` below is reactively derived from), and invalidate the loader so
   * `bundledAgents` — the discovered-agents list `/workflows`' left panel renders — picks up the
   * new file too. Safe to call mid-edit: `seedWorkflowStore` keeps the in-memory config when
   * `projectRoot` is unchanged, so this cannot discard unsaved canvas edits.
   */
  const handleAgentForked = (newAgentName: string) => {
    if (!config) return;
    if (!config.agents_available.includes(newAgentName)) {
      storeSetAgentsAvailable([...config.agents_available, newAgentName]);
    }
    void router.invalidate();
  };

  // Guard: store not yet seeded
  if (!config) return null;

  const activeWorkflow = config.workflows[activeWorkflowIdx] ?? null;
  const availableSkillIds = config.skills_available;

  // Read the chain back off the config rather than tracking it separately, so the chips can never
  // disagree with the graph on the canvas.
  const implChain = config.workflow_instances.map((i) => i.name).filter((name) => !CORE_SEED_AGENTS.includes(name));
  // Every discovered agent that isn't one of the core four is a candidate — including a project's
  // own. `implChain` is unioned in so an agent the seed used but discovery didn't find still shows.
  const implCandidates = [
    ...new Set([...implChain, ...allAgents.map((a) => a.id).filter((id) => !CORE_SEED_AGENTS.includes(id))]),
  ];

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) overflow-hidden flex flex-col">
      <TopNav
        workflowSelector={{
          workflows: config.workflows.map((wf, i) => wf.name || `Workflow ${i + 1}`),
          activeIndex: activeWorkflowIdx,
          onSelect: setActiveWorkflowIdx,
          onAdd: openCreateWorkflow,
          onRemove: storeRemoveWorkflow,
          onRename: storeRenameWorkflow,
        }}
      />

      {loaderData.seeded && (
        <SeededBanner>
          The workflows below are a starter configuration and are <strong className="text-(--ink)">not saved</strong> —
          press Save workflows to write them.
        </SeededBanner>
      )}

      <ConfigIssueBanner key={loaderData.projectRoot} issues={loaderData.configIssues} />

      <div className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: "280px 1fr" }}>
        {/* Left pane. Split into a scrollable body and a footer that never scrolls out of view —
            Save used to sit at the end of the same scroll region as Agents/Skills, so a project
            with enough of either pushed it below the fold. */}
        <div className="border-r border-(--line) flex flex-col overflow-hidden">
          <div className="flex-1 overflow-y-auto flex flex-col p-4 gap-4">
            {/*
              Only while seeded, and only for the default (first) workflow — every other seeded
              workflow is a variation someone already added on top of the detected one, not the
              thing detection itself produced. Once maestro.json exists the chain is the user's
              saved answer, and re-proposing a detected one — over a graph they may have spent an
              afternoon on — would be offering to overwrite their work.
            */}
            {loaderData.seeded && loaderData.detection && activeWorkflowIdx === 0 && (
              <DetectedChain
                detection={loaderData.detection}
                selected={implChain}
                candidates={implCandidates}
                busy={reseeding}
                onChange={(agents) => void changeImplAgents(agents)}
              />
            )}

            {/* Agents — grouped by source (this repo, ~/.claude, bundled, per-plugin), each group
                collapsible so a project with many plugins doesn't turn this into a wall of rows.
                Collapsed by default except the repository's own agents and the bundled ones. */}
            <div>
              <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide mb-2">Agents</div>
              <div className="flex flex-col gap-1">
                {groupBySource(allAgents).map((group) => (
                  <CollapsibleGroup
                    key={group.source}
                    title={sourceLabel(group.source)}
                    count={group.items.length}
                    defaultOpen={group.source === "project" || group.source === "maestro"}
                  >
                    {group.items.map((agent) => {
                      const checked = config.agents_available.includes(agent.id);
                      return (
                        <label
                          key={agent.id}
                          title={agent.description}
                          className="flex items-center gap-2 py-1 px-1 rounded hover:bg-(--bg-elev) cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              storeSetAgentsAvailable(
                                checked
                                  ? config.agents_available.filter((a) => a !== agent.id)
                                  : [...config.agents_available, agent.id]
                              )
                            }
                            className="w-3.5 h-3.5 accent-primary cursor-pointer"
                          />
                          <span className="font-mono text-[13px] text-(--ink) truncate">{agent.id}</span>
                        </label>
                      );
                    })}
                  </CollapsibleGroup>
                ))}
                {allAgents.length === 0 && <p className="text-[12px] text-subtle">No agents found.</p>}
              </div>
              <button
                type="button"
                onClick={() => {
                  const name = window.prompt("Agent ID:");
                  if (name?.trim()) storeSetAgentsAvailable([...config.agents_available, name.trim()]);
                }}
                className="mt-1.5 flex items-center gap-1 text-[11px] text-(--ink-3) hover:text-(--ink) cursor-pointer py-0.5 px-1 rounded focus:outline-none"
              >
                <Plus size={10} /> Agent
              </button>
            </div>

            {/* Skills — same grouping/collapse rule as Agents above. */}
            <div>
              <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide mb-2">Skills</div>
              <div className="flex flex-col gap-1">
                {groupBySource(allSkills).map((group) => (
                  <CollapsibleGroup
                    key={group.source}
                    title={sourceLabel(group.source)}
                    count={group.items.length}
                    defaultOpen={group.source === "project"}
                  >
                    {group.items.map((skill) => {
                      const checked = config.skills_available.includes(skill.id);
                      return (
                        <label
                          key={skill.id}
                          title={skill.description}
                          className="flex items-center gap-2 py-1 px-1 rounded hover:bg-(--bg-elev) cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              storeSetSkillsAvailable(
                                checked
                                  ? config.skills_available.filter((s) => s !== skill.id)
                                  : [...config.skills_available, skill.id]
                              )
                            }
                            className="w-3.5 h-3.5 accent-primary cursor-pointer"
                          />
                          <span className="font-mono text-[13px] text-(--ink) truncate">{skill.id}</span>
                        </label>
                      );
                    })}
                  </CollapsibleGroup>
                ))}
                {allSkills.length === 0 && <p className="text-[12px] text-subtle">No skills found.</p>}
              </div>
              <button
                type="button"
                onClick={() => {
                  const name = window.prompt("Skill ID:");
                  if (name?.trim()) storeSetSkillsAvailable([...config.skills_available, name.trim()]);
                }}
                className="mt-1.5 flex items-center gap-1 text-[11px] text-(--ink-3) hover:text-(--ink) cursor-pointer py-0.5 px-1 rounded focus:outline-none"
              >
                <Plus size={10} /> Skill
              </button>
            </div>
          </div>

          {/* Footer — outside the scroll region, so Save is always visible. */}
          <div className="shrink-0 border-t border-(--line) p-4">
            <Button
              variant="primary"
              icon={phase === "idle" ? <Sparkles size={14} /> : undefined}
              loading={phase === "saving"}
              onClick={() => void handleSubmit()}
            >
              {phase === "saving" ? "Saving…" : "Save workflows"}
            </Button>
          </div>
        </div>

        {/* Center — canvas or create form */}
        <div className="flex flex-col overflow-hidden bg-(--bg-elev)">
          {creatingWorkflow ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="bg-(--bg) border border-(--line) rounded-xl p-6 shadow-lg w-80 flex flex-col gap-4">
                <h2 className="text-[15px] font-semibold text-(--ink) m-0">New workflow</h2>
                {config.workflows.length > 0 && (
                  <label className="flex flex-col gap-1.5">
                    <span className="text-[11px] font-semibold text-subtle uppercase tracking-wide">Start from</span>
                    <select
                      value={newWorkflowSource ?? ""}
                      onChange={(e) => setNewWorkflowSource(e.target.value === "" ? null : Number(e.target.value))}
                      className="w-full text-[13px] bg-(--bg-elev) border border-(--line) rounded-md px-3 py-2 text-(--ink) focus:outline-none focus:border-primary cursor-pointer"
                    >
                      <option value="">Empty workflow</option>
                      {config.workflows.map((wf, i) => (
                        <option key={i} value={i}>
                          Copy of {wf.name || `Workflow ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <input
                  ref={createInputRef}
                  type="text"
                  value={newWorkflowName}
                  onChange={(e) => setNewWorkflowName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmCreateWorkflow();
                    if (e.key === "Escape") cancelCreateWorkflow();
                  }}
                  placeholder="e.g. Backend update"
                  className="w-full text-[13px] bg-(--bg-elev) border border-(--line) rounded-md px-3 py-2 text-(--ink) focus:outline-none focus:border-primary"
                />
                <div className="flex gap-2 justify-end">
                  <button
                    type="button"
                    onClick={cancelCreateWorkflow}
                    className="px-3 py-1.5 text-[13px] rounded-lg bg-(--bg-elev) border border-(--line) text-(--ink-2) hover:text-(--ink) cursor-pointer focus:outline-none"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={confirmCreateWorkflow}
                    className="px-3 py-1.5 text-[13px] rounded-lg bg-primary text-white cursor-pointer focus:outline-none hover:opacity-90"
                  >
                    Create
                  </button>
                </div>
              </div>
            </div>
          ) : activeWorkflow ? (
            <WorkflowCanvas
              workflow={activeWorkflow}
              workflowKey={activeWorkflowIdx}
              availableAgents={config.agents_available}
              availableSkills={availableSkillIds}
              instances={config.workflow_instances}
              onChange={(wf) => storeUpdateWorkflow(activeWorkflowIdx, wf)}
              onInstancesChange={storeSetInstances}
              onAgentForked={handleAgentForked}
              forkableAgents={forkableAgentIds}
            />
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-3">
              <p className="text-[13px] text-(--ink-2)">Add a workflow to get started.</p>
              <button
                type="button"
                onClick={openCreateWorkflow}
                className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-primary text-white text-[13px] font-medium cursor-pointer focus:outline-none hover:opacity-90"
              >
                <Plus size={14} /> Add workflow
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
