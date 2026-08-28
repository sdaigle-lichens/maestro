// Two rows of toggle pills for one skill's row in the Skills tab table — project tags (the live
// Project Tags catalog, plus GLOBAL_TAG) and agent types (AGENT_TYPES, plus GLOBAL_TAG). Both
// dimensions have to match a seeded agent instance's own attributes for a skill to route to it —
// see skill-tags.ts's `skillMapFromTags`.
//
// The first inline edit in any /tools-descended tab: every other tab (Rules, Agents) is pure
// display over loader data, with editing done on a dedicated route. A table cell of checkboxes
// doesn't earn a route and a Save button of its own, so each pill persists on its own click —
// `callMain`'s CallResult pattern, same as every other fallible main-process call, just without a
// form around it.

import { useState } from "react";
import { toast } from "@repo/ui/toast";
import { callMain } from "../../utils/call-main";
import { setSkillAgentTypes, setSkillProjectTags, AGENT_TYPES, GLOBAL_TAG } from "../../utils/tools";

const PILL_BASE =
  "rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const PILL_ON = "border-ring bg-(--primary-dim) text-primary";
const PILL_OFF = "border-(--line) text-subtle hover:text-(--ink-2) hover:border-(--ink-2)";

function PillRow({
  values,
  active,
  pending,
  onToggle,
}: {
  values: readonly string[];
  active: string[];
  pending: string | null;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1">
      {values.map((value) => (
        <button
          key={value}
          type="button"
          disabled={pending === value}
          aria-pressed={active.includes(value)}
          className={`${PILL_BASE} ${active.includes(value) ? PILL_ON : PILL_OFF}`}
          onClick={() => onToggle(value)}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

export default function SkillTagEditor({
  skillId,
  projectTagCatalog,
  projectTags,
  agentTypes,
  onChange,
}: {
  skillId: string;
  /** The live Project Tags catalog — dynamic, unlike AGENT_TYPES. */
  projectTagCatalog: string[];
  projectTags: string[];
  agentTypes: string[];
  /** Called with the store's own echo once a toggle persists — never with the optimistic guess. */
  onChange: (next: { projectTags: string[]; agentTypes: string[] }) => void;
}) {
  const [pendingProjectTag, setPendingProjectTag] = useState<string | null>(null);
  const [pendingAgentType, setPendingAgentType] = useState<string | null>(null);

  async function toggleProjectTag(tag: string) {
    const next = projectTags.includes(tag) ? projectTags.filter((t) => t !== tag) : [...projectTags, tag];
    setPendingProjectTag(tag);
    const res = await callMain(() => setSkillProjectTags(skillId, next));
    setPendingProjectTag(null);
    if (!res.ok) {
      toast(<>Could not update project tags for {skillId}: {res.error}</>, { variant: "error" });
      return;
    }
    onChange({ projectTags: res.value, agentTypes });
  }

  async function toggleAgentType(tag: string) {
    const next = agentTypes.includes(tag) ? agentTypes.filter((t) => t !== tag) : [...agentTypes, tag];
    setPendingAgentType(tag);
    const res = await callMain(() => setSkillAgentTypes(skillId, next));
    setPendingAgentType(null);
    if (!res.ok) {
      toast(<>Could not update agent types for {skillId}: {res.error}</>, { variant: "error" });
      return;
    }
    onChange({ projectTags, agentTypes: res.value });
  }

  return (
    <div className="flex flex-col gap-1.5">
      <PillRow
        values={[...projectTagCatalog, GLOBAL_TAG]}
        active={projectTags}
        pending={pendingProjectTag}
        onToggle={(v) => void toggleProjectTag(v)}
      />
      <PillRow
        values={[...AGENT_TYPES, GLOBAL_TAG]}
        active={agentTypes}
        pending={pendingAgentType}
        onToggle={(v) => void toggleAgentType(v)}
      />
    </div>
  );
}
