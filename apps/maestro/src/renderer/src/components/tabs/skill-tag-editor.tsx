// Seven toggle pills — one per SKILL_TAGS value — for one skill's row in the Skills tab table.
//
// The first inline edit in any /tools tab: every other tab (Rules, Agents, Skills itself before
// this) is pure display over loader data, with editing done on a dedicated route. A table cell of
// checkboxes doesn't earn a route and a Save button of its own, so this persists on every click —
// `callMain`'s CallResult pattern, same as every other fallible main-process call, just without a
// form around it.

import { useState } from "react";
import { toast } from "@repo/ui/toast";
import { callMain } from "../../utils/call-main";
import { setSkillTags, SKILL_TAGS, type SkillTag } from "../../utils/tools";

const PILL_BASE =
  "rounded-md border px-2 py-0.5 font-mono text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-60";
const PILL_ON = "border-ring bg-(--primary-dim) text-primary";
const PILL_OFF = "border-(--line) text-subtle hover:text-(--ink-2) hover:border-(--ink-2)";

export default function SkillTagEditor({
  skillId,
  tags,
  onChange,
}: {
  skillId: string;
  tags: SkillTag[];
  /** Called with the store's own echo once a toggle persists — never with the optimistic guess. */
  onChange: (tags: SkillTag[]) => void;
}) {
  const [pending, setPending] = useState<SkillTag | null>(null);

  async function toggle(tag: SkillTag) {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    setPending(tag);
    const res = await callMain(() => setSkillTags(skillId, next));
    setPending(null);
    if (!res.ok) {
      toast(<>Could not update tags for {skillId}: {res.error}</>, { variant: "error" });
      return;
    }
    onChange(res.value);
  }

  return (
    <div className="flex flex-wrap gap-1">
      {SKILL_TAGS.map((tag) => (
        <button
          key={tag}
          type="button"
          disabled={pending === tag}
          aria-pressed={tags.includes(tag)}
          className={`${PILL_BASE} ${tags.includes(tag) ? PILL_ON : PILL_OFF}`}
          onClick={() => void toggle(tag)}
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
