// The Project Marketplace tab: what the OPEN PROJECT publishes, and the rule library beside it.
//
// PORTED FROM apps/help-server/src/components/tabs/MarketplaceTab.tsx. Both halves used to be
// pinned to this repo by Docker mounts (`/plugins`, `/rules`); they now read the open project, so
// the tab is empty for a project that publishes nothing — and says so, rather than looking broken.

import { Link } from "@tanstack/react-router";
import CopyableText from "@repo/ui/copyable-text";
import type { MarketplacePluginInfo, RuleLibraryEntry } from "../../utils/tools";

const TH =
  "border-b border-(--line) px-4 py-2 text-left text-[12px] font-semibold uppercase tracking-[0.08em] text-(--ink-2)";
const ROW = "border-b border-(--line) last:border-0 hover:bg-(--bg-elev) transition-colors";

function InstalledDot({ installed }: { installed: boolean }) {
  return installed ? (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-(--green-dim) bg-(--green-dim) px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
      <span className="h-1.5 w-1.5 rounded-full bg-success" />
      Installed
    </span>
  ) : (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-(--line) bg-(--bg-elev) px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-subtle">
      <span className="h-1.5 w-1.5 rounded-full bg-subtle" />
      Not installed
    </span>
  );
}

function TypeTag({ type }: { type: "skill" | "agent" }) {
  return (
    <span
      className={`inline-block rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider border ${
        type === "skill" ? "border-ring text-primary bg-(--primary-dim)" : "border-(--line) text-subtle bg-(--bg-elev)"
      }`}
    >
      {type}
    </span>
  );
}

function PluginCard({ plugin }: { plugin: MarketplacePluginInfo }) {
  const hasContent = plugin.skills.length > 0 || plugin.agents.length > 0;
  return (
    <div>
      <div className="flex flex-col gap-3 border-b border-(--line) bg-(--bg-elev) px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[14px] font-medium text-(--ink)">{plugin.name}</span>
            {plugin.version && <span className="font-mono text-[12px] text-subtle">v{plugin.version}</span>}
            <InstalledDot installed={plugin.isInstalled} />
          </div>
          {plugin.description && <p className="mt-1.5 text-[13px] text-(--ink-2) m-0">{plugin.description}</p>}
        </div>
        {!plugin.isInstalled && (
          <div className="flex shrink-0 items-center gap-2 rounded-md border border-(--line) bg-(--bg-elev) px-3 py-1.5">
            <CopyableText text={plugin.installCommand}>
              <code className="font-mono text-[12px] text-(--ink-2)">{plugin.installCommand}</code>
            </CopyableText>
          </div>
        )}
      </div>

      {hasContent ? (
        <table className="w-full border-collapse">
          <thead>
            <tr className="bg-(--bg-elev)">
              <th className={TH}>Name</th>
              <th className={TH}>Type</th>
              <th className={TH}>Description</th>
            </tr>
          </thead>
          <tbody>
            {plugin.skills.map((skill) => (
              <tr key={`skill-${skill.name}`} className={ROW}>
                <td className="px-4 py-2 align-top">
                  <span className="inline-block rounded-md border border-ring bg-(--primary-dim) px-2 py-0.5 font-mono text-[12px] text-primary">
                    {skill.name}
                  </span>
                </td>
                <td className="px-4 py-2 align-top">
                  <TypeTag type="skill" />
                </td>
                <td className="px-4 py-2 text-[13px] text-(--ink-2)">{skill.description}</td>
              </tr>
            ))}
            {plugin.agents.map((agent) => (
              <tr key={`agent-${agent.name}`} className={ROW}>
                <td className="px-4 py-2 align-top">
                  <span className="inline-block rounded-md border border-(--line) bg-(--bg-elev) px-2 py-0.5 font-mono text-[12px] text-(--ink-2)">
                    {agent.name}
                  </span>
                </td>
                <td className="px-4 py-2 align-top">
                  <TypeTag type="agent" />
                </td>
                <td className="px-4 py-2 text-[13px] text-(--ink-2)">{agent.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="px-5 py-3 text-[12px] text-subtle m-0">No skills or agents found.</p>
      )}
    </div>
  );
}

export default function ProjectMarketplace({
  plugins,
  ruleLibrary,
}: {
  plugins: MarketplacePluginInfo[];
  ruleLibrary: RuleLibraryEntry[];
}) {
  return (
    <div className="flex flex-col gap-10">
      <section>
        <div className="mb-4 flex items-center gap-3">
          <span className="section-label">Project Marketplace</span>
          <span className="rounded-full bg-(--bg-elev) px-2.5 py-0.5 text-[12px] font-medium text-subtle">
            {plugins.length} plugins
          </span>
        </div>
        {plugins.length === 0 ? (
          <p className="text-[13px] text-subtle m-0">
            This project publishes no marketplace — there is no{" "}
            <span className="font-mono">.claude-plugin/marketplace.json</span> at its root.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {plugins.map((plugin) => (
              <div key={plugin.name} className="overflow-hidden rounded-lg border border-(--line)">
                <PluginCard plugin={plugin} />
              </div>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex items-center gap-3">
          <span className="section-label">Rule Library</span>
          <span className="rounded-full bg-(--bg-elev) px-2.5 py-0.5 text-[12px] font-medium text-subtle">
            {ruleLibrary.length}
          </span>
        </div>
        {/*
          Named "library", and linked to /rules rather than merged with it. These are the rule
          files the project AUTHORS, in `rules/`; /rules assigns the ones under `.claude/rules/`
          to directories and moves them on save. Two questions, two views — see
          `discoverRuleLibrary` in src/core/discovery.ts for why they were not unified.
        */}
        <p className="mb-4 text-[12px] text-subtle m-0">
          Rule files this project publishes, from <span className="font-mono">rules/</span>. Assigning them to
          directories happens in{" "}
          <Link to="/rules" className="text-primary underline">
            Rules
          </Link>
          .
        </p>
        {ruleLibrary.length === 0 ? (
          <p className="text-[13px] text-subtle m-0">
            No <span className="font-mono">rules/</span> directory in this project.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-(--line)">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-(--bg-elev)">
                  <th className={TH}>Rule</th>
                  <th className={TH}>File</th>
                  <th className={TH}>Applies to</th>
                </tr>
              </thead>
              <tbody>
                {ruleLibrary.map((rule) => (
                  <tr key={rule.filename} className={ROW}>
                    <td className="px-4 py-2.5 text-[13px] font-medium text-(--ink)">
                      {rule.title}
                      {rule.description && (
                        <div className="text-[12px] text-subtle font-normal">{rule.description}</div>
                      )}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="inline-block rounded-md border border-(--line) bg-(--bg-elev) px-2 py-0.5 font-mono text-[12px] text-(--ink-2)">
                        {rule.filename}
                      </span>
                    </td>
                    <td className="px-4 py-2.5">
                      {rule.paths.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {rule.paths.map((p) => (
                            <span
                              key={p}
                              className="inline-block rounded-md border border-(--line) bg-(--bg-elev) px-2 py-0.5 font-mono text-[12px] text-subtle"
                            >
                              {p}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[12px] text-subtle">All files</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
