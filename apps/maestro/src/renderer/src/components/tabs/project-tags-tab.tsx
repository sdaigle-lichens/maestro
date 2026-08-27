// The /templates page's Project Tags tab — a global CATALOG editor (project-tags.ts), not a
// per-item assignment like the Reports/Agent Types tabs beside it. There's no "content" to edit
// and no per-row Save: adding or removing a tag is a single action that lands immediately, and the
// list re-renders from the store's own echo (`add`/`remove` both return the full catalog).
//
// No rename: the tag text is the identity in the store, same as skill-tags.ts's tag column.
// Renaming is delete-old, add-new, same as everywhere else in this UI that lets one string stand
// in for a whole row.

import { useState } from "react";
import { Plus, Tag as TagIcon, X } from "lucide-react";
import Button from "@repo/ui/button";
import { Input } from "@repo/ui/field";
import { toast } from "@repo/ui/toast";
import { callMain } from "../../utils/call-main";

export default function ProjectTagsTab({ initial }: { initial: string[] }) {
  const [tags, setTags] = useState(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleAdd() {
    const value = draft.trim();
    if (!value) return;
    setBusy(true);
    try {
      const res = await callMain(() => window.maestro.templates.projectTags.add(value));
      if (!res.ok) {
        toast(<>Could not add the tag: {res.error}</>, { variant: "error" });
        return;
      }
      setTags(res.value);
      setDraft("");
    } finally {
      setBusy(false);
    }
  }

  async function handleRemove(tag: string) {
    setBusy(true);
    try {
      const res = await callMain(() => window.maestro.templates.projectTags.remove(tag));
      if (!res.ok) {
        toast(<>Could not remove the tag: {res.error}</>, { variant: "error" });
        return;
      }
      setTags(res.value);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-(--line) p-4">
      <p className="text-[12px] text-(--ink-3) m-0 mb-4">
        The project-classification categories detection looks for evidence of on a repo's first open.
        A tag added beyond backend/frontend/mobile is catalogued here, but detection won&apos;t find
        evidence for it on its own — it's picked manually wherever a project's category is assigned.
      </p>

      <div className="flex items-center gap-1.5 flex-wrap mb-4">
        {tags.length === 0 ? (
          <p className="text-[13px] text-subtle m-0">No project tags yet.</p>
        ) : (
          tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1.5 rounded-full border border-(--line) font-mono text-[12px] text-(--ink)"
            >
              <TagIcon size={11} className="text-(--ink-3)" />
              {tag}
              <button
                type="button"
                title={`Remove ${tag}`}
                disabled={busy}
                onClick={() => void handleRemove(tag)}
                className="flex items-center justify-center w-4 h-4 rounded-full text-(--ink-3) hover:text-(--ink) cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none bg-transparent border-0"
              >
                <X size={11} />
              </button>
            </span>
          ))
        )}
      </div>

      <div className="flex items-center gap-2 max-w-sm">
        <Input
          value={draft}
          onChange={setDraft}
          placeholder="New tag…"
          mono
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleAdd();
          }}
        />
        <Button variant="primary" icon={<Plus size={13} />} disabled={busy || !draft.trim()} onClick={() => void handleAdd()}>
          Add
        </Button>
      </div>
    </div>
  );
}
