import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import Button from "@repo/ui/button";
import { Sparkles } from "lucide-react";
import { toast } from "@repo/ui/toast";
import TopNav from "../components/top-nav";
import RuleTree from "../components/rule-tree";
import ChipMultiSelect from "../components/chip-multi-select";
import SeededBanner from "../components/seeded-banner";
import { callMain } from "../utils/call-main";
import {
  getRulesData,
  submitMaestroConfig,
  type MaestroConfigV3,
  type MaestroRuleV3,
  type MaestroRulesResult,
} from "../utils/maestro";

type RuleSource = "project" | "vibe-rules";

type RulesLoaderData = MaestroRulesResult;

export const Route = createFileRoute("/rules")({
  // One IPC call. The web app fanned this out to four server fns, three of which each walked
  // the whole project directory tree.
  loader: (): Promise<RulesLoaderData> => getRulesData(),
  component: RulesPage,
});

type Phase = "idle" | "saving";

/**
 * Remounts the editor when the open project changes.
 *
 * A project switch invalidates the router, so the loader re-runs — but this route component stays
 * mounted, and `useState(loaderData.…)` initialisers only run on mount. The rule *pool* below
 * comes straight from loader data and updates, while the assignments derived from it do not: the
 * window shows project B's rules with project A's selection, and Save writes A's assignments into
 * B's maestro.json. Keying on projectRoot re-initialises all of that state at once, which is why
 * it is done here rather than by syncing each piece in an effect. `/workflows` has the same hazard
 * and handles it in `seedWorkflowStore`, whose state lives outside React and so cannot use a key.
 */
function RulesPage() {
  const loaderData = Route.useLoaderData() as RulesLoaderData;
  return <RulesEditor key={loaderData.projectRoot} loaderData={loaderData} />;
}

function RulesEditor({ loaderData }: { loaderData: RulesLoaderData }) {
  const { projectRoot, tree, availableRules, vibeRules, vibeRulesAvailable } = loaderData;
  const router = useRouter();

  const [config, setConfig] = useState<MaestroConfigV3>(loaderData.config);
  const [phase, setPhase] = useState<Phase>("idle");

  // IDs of rules the user has "selected" (toggled on) — the pool the tree can assign.
  const [selectedRuleIds, setSelectedRuleIds] = useState<string[]>(loaderData.config.rules.map((r) => r.id));

  const projectRuleIds = useMemo(() => availableRules.map((r) => r.id), [availableRules]);

  // Source lookup. A project rule (on-disk file) wins over a same-named vibe-rules entry,
  // since it's a real file we can move. The vibe section only lists ids that resolve to
  // "vibe-rules" so a name present in both doesn't appear twice.
  const ruleSource = useMemo(() => {
    const map: Record<string, RuleSource> = {};
    for (const id of projectRuleIds) map[id] = "project";
    for (const id of vibeRules) if (!(id in map)) map[id] = "vibe-rules";
    return map;
  }, [projectRuleIds, vibeRules]);

  const vibeOnlyIds = useMemo(() => vibeRules.filter((id) => ruleSource[id] === "vibe-rules"), [vibeRules, ruleSource]);

  const selectedProject = selectedRuleIds.filter((id) => projectRuleIds.includes(id));
  const selectedVibe = selectedRuleIds.filter((id) => vibeOnlyIds.includes(id));

  // Toggle selection within one source group, leaving the other group's selection intact.
  // De-selecting a rule also drops any assignment it had (config.rules is pruned to the
  // still-selected ids) — removing it from the menu unassigns it everywhere.
  const setGroupSelection = (groupIds: string[], next: string[]) => {
    const others = selectedRuleIds.filter((id) => !groupIds.includes(id));
    const merged = [...others, ...next];
    setSelectedRuleIds(merged);
    setConfig((c) => ({ ...c, rules: c.rules.filter((r) => merged.includes(r.id)) }));
  };

  // One location per rule: assigning replaces any prior assignment of the same id
  // (root or another path), so re-assigning effectively MOVES it. Source is stamped
  // from the lookup so the host-side apply step knows move-file vs vibe-rules-load.
  const handleAssign = (assignment: MaestroRuleV3) => {
    setConfig((c) => ({
      ...c,
      rules: [
        ...c.rules.filter((r) => r.id !== assignment.id),
        { ...assignment, source: ruleSource[assignment.id] ?? "project" },
      ],
    }));
  };

  const handleUnassign = (ruleId: string) => {
    setConfig((c) => ({ ...c, rules: c.rules.filter((r) => r.id !== ruleId) }));
  };

  const handleSubmit = async () => {
    setPhase("saving");
    // try/finally, not a bare `setPhase("idle")` after the await — see the same note in
    // workflows.tsx. A rejected save must still return the button to its resting state.
    try {
      // Saving rules both persists the slice AND places the files — the move/install step that
      // used to be `node maestro-apply-rules.js` run by a Claude session after the form closed.
      const res = await callMain(() =>
        submitMaestroConfig({
          data: {
            sliceType: "rules",
            slice: { rules: config.rules },
          },
        })
      );

      if (!res.ok) {
        toast(<>Could not save rules: {res.error}</>, { variant: "error" });
        return;
      }

      // Refresh loader data: `seeded` is now stale (see the same note in workflows.tsx), and a
      // rules save also MOVES rule files on disk, so the tree and the project-rule pool the
      // loader walked are stale too. The editor is keyed on projectRoot, which is unchanged, so
      // it does not remount and the current assignments survive the invalidation.
      void router.invalidate();

      const result = res.value;
      const placed = result.rules.moved.length + result.rules.installed.length;
      if (result.warnings.length > 0) {
        // The save succeeded — a warning is a caveat, not a failure. See workflows.tsx's matching
        // save toast for the same reasoning.
        toast(<>Saved, but: {result.warnings.join(" ")}</>, { variant: "warning" });
        return;
      }
      toast(
        <>
          Rules saved to <span className="font-mono text-(--ink)">{result.configPath}</span>
          {placed > 0 ? ` and ${placed} rule file${placed === 1 ? "" : "s"} placed.` : "."}
        </>
      );
    } finally {
      setPhase("idle");
    }
  };

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) overflow-hidden flex flex-col">
      <TopNav />

      {loaderData.seeded && (
        <SeededBanner>Assignments start empty, and are written only when you press Save rules.</SeededBanner>
      )}

      <div className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: "280px 1fr" }}>
        {/* Left pane */}
        <div className="border-r border-(--line) overflow-y-auto flex flex-col p-4 gap-4">
          <div>
            <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide mb-2">Available rules</div>
            {projectRuleIds.length === 0 ? (
              <p className="text-[12px] text-subtle">
                No rules found under{" "}
                <span className="font-mono">{(projectRoot || "<project>").replace(/\/+$/, "")}/.claude/rules/</span>.
                Create <span className="font-mono">.md</span> files there to see them here.
              </p>
            ) : (
              <ChipMultiSelect
                options={projectRuleIds}
                value={selectedProject}
                onChange={(next) => setGroupSelection(projectRuleIds, next)}
                emptyText="No rules found."
              />
            )}
          </div>

          <div>
            <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide mb-2">
              Installable rules (vibe-rules)
            </div>
            {vibeOnlyIds.length === 0 ? (
              // "CLI missing" and "CLI present but empty" used to look identical — an empty list
              // either way. vibeRulesAvailable tells them apart.
              <p className="text-[12px] text-subtle">
                {vibeRulesAvailable ? (
                  <>
                    None found via <span className="font-mono">vibe-rules list</span>. These are installed into the
                    assigned directory with <span className="font-mono">vibe-rules load</span> on save.
                  </>
                ) : (
                  <>
                    The <span className="font-mono">vibe-rules</span> CLI isn&rsquo;t installed, so no installable rules
                    can be listed. Project rules below still work.
                  </>
                )}
              </p>
            ) : (
              <ChipMultiSelect
                options={vibeOnlyIds}
                value={selectedVibe}
                onChange={(next) => setGroupSelection(vibeOnlyIds, next)}
                emptyText="No installable rules."
              />
            )}
          </div>

          {selectedRuleIds.length > 0 && (
            <p className="text-[12px] text-subtle">
              Use the directory tree on the right to assign selected rules to paths. Each rule lives in one place —
              assigning it elsewhere moves it.
            </p>
          )}

          <div className="flex-1" />

          <Button
            variant="primary"
            icon={phase === "idle" ? <Sparkles size={14} /> : undefined}
            loading={phase === "saving"}
            onClick={() => void handleSubmit()}
          >
            {phase === "saving" ? "Saving…" : "Save rules"}
          </Button>
        </div>

        {/* Center — tree */}
        <div className="overflow-y-auto p-4">
          {selectedRuleIds.length === 0 ? (
            <div className="flex items-center justify-center h-full text-(--ink-2) text-[13px]">
              Select rules on the left to assign them to paths.
            </div>
          ) : (
            <RuleTree
              tree={tree}
              rules={availableRules}
              selectedRuleIds={selectedRuleIds}
              ruleAssignments={config.rules}
              ruleSource={ruleSource}
              onAssign={handleAssign}
              onUnassign={handleUnassign}
            />
          )}
        </div>
      </div>
    </div>
  );
}
