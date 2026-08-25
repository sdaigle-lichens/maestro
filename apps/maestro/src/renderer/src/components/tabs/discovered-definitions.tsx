// Shared grouping for the Skills and Agents tabs: both render the same `DiscoveredDefinition[]`
// shape, split into sections by `source`, so the grouping rule lives once rather than twice.
//
// `discoverSkills`/`discoverAgents` (src/core/discovery.ts) tag every entry with `source`:
// "project" (this project's own `.claude/skills|agents/`), "user" (this machine's `~/.claude/`),
// "maestro" (bundled with Maestro itself), or a plugin's name (from a marketplace).

import type { DiscoveredDefinition, SkillTag } from "../../utils/tools";
import SkillTagEditor from "./skill-tag-editor";

const TH =
  "border-b border-(--line) px-4 py-2.5 text-left text-[12px] font-semibold uppercase tracking-[0.08em] text-(--ink-2)";
const ROW = "border-b border-(--line) last:border-0 hover:bg-(--bg-elev) transition-colors";

function groupLabel(source: string): string {
  if (source === "project") return "Local (this project)";
  if (source === "user") return "Global (this machine)";
  if (source === "maestro") return "Bundled with Maestro";
  return `From plugin: ${source}`;
}

/** Stable group ordering: local, then global, then Maestro's own, then every plugin by name. */
function groupOrder(source: string): number {
  if (source === "project") return 0;
  if (source === "user") return 1;
  if (source === "maestro") return 2;
  return 3;
}

function groupDefinitions(
  items: DiscoveredDefinition[]
): { source: string; label: string; items: DiscoveredDefinition[] }[] {
  const bySource = new Map<string, DiscoveredDefinition[]>();
  for (const item of items) {
    const list = bySource.get(item.source) ?? [];
    list.push(item);
    bySource.set(item.source, list);
  }
  return [...bySource.entries()]
    .map(([source, list]) => ({ source, label: groupLabel(source), items: list }))
    .sort((a, b) => {
      const oa = groupOrder(a.source);
      const ob = groupOrder(b.source);
      return oa !== ob ? oa - ob : a.source.localeCompare(b.source);
    });
}

export default function DiscoveredDefinitionsList({
  items,
  emptyLabel,
  onTagsChange,
}: {
  items: DiscoveredDefinition[];
  /** e.g. "skills" or "agents" — used only in the empty-state sentence. */
  emptyLabel: string;
  /**
   * Only the Skills tab supplies this. Its presence is what turns on the Tags column — Agents
   * reuses this same list component but has nothing to tag, so it keeps its plain two-column table.
   */
  onTagsChange?: (id: string, tags: SkillTag[]) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="text-[13px] text-subtle m-0">
        No {emptyLabel} were found — locally, on this machine, or from a plugin.
      </p>
    );
  }

  const groups = groupDefinitions(items);

  return (
    <div className="flex flex-col gap-8">
      {groups.map((group) => (
        <section key={group.source}>
          <div className="mb-3 flex items-center gap-3">
            <span className="section-label">{group.label}</span>
            <span className="text-[10px] text-subtle">{group.items.length}</span>
          </div>
          <div className="overflow-hidden rounded-lg border border-(--line)">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-(--bg-elev)">
                  <th className={TH}>Name</th>
                  <th className={TH}>Description</th>
                  {onTagsChange && <th className={TH}>Tags</th>}
                </tr>
              </thead>
              <tbody>
                {group.items.map((item) => (
                  <tr key={item.id} className={ROW}>
                    <td className="px-4 py-2.5 align-top">
                      <span className="inline-block rounded-md border border-ring bg-(--primary-dim) px-2 py-0.5 font-mono text-[12px] text-primary">
                        {item.id}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 align-top text-[13px] text-(--ink-2)">{item.description}</td>
                    {onTagsChange && (
                      <td className="px-4 py-2.5 align-top">
                        <SkillTagEditor
                          skillId={item.id}
                          tags={item.tags}
                          onChange={(next) => onTagsChange(item.id, next)}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
