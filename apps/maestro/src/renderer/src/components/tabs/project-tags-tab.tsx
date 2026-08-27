// The /templates page's Project Tags tab — a global CATALOG editor (project-tags.ts), not a
// per-item assignment like the Reports/Agent Types tabs beside it. There's no "content" to edit
// and no per-row Save: adding or removing a tag is a single action that lands immediately, and the
// list re-renders from the store's own echo (`add`/`remove` both return the full catalog).
//
// No rename: the tag text is the identity in the store, same as skill-tags.ts's tag column.
// Renaming is delete-old, add-new, same as everywhere else in this UI that lets one string stand
// in for a whole row.
//
// A second section below the catalog is the OTHER half of the project ↔ agent mapping this tab
// exists for: which of the catalog's tags (or "global") each seeded agent belongs to
// (agent-project-tags.ts). Same flat-list-of-rows, own-dirty-state, own-Save pattern as the Agent
// Types tab, except the Select's options come from THIS tab's own catalog state rather than a
// fixed constant — a tag added/removed above should be reflected in the dropdown immediately.

import { useState } from "react";
import { Plus, Save, Tag as TagIcon, X } from "lucide-react";
import Button from "@repo/ui/button";
import { Input } from "@repo/ui/field";
import Select from "@repo/ui/select";
import { toast } from "@repo/ui/toast";
import { callMain } from "../../utils/call-main";

export default function ProjectTagsTab({
  initial,
  initialAgentTags,
}: {
  initial: string[];
  initialAgentTags: Record<string, string>;
}) {
  const [tags, setTags] = useState(initial);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  const [agentTags, setAgentTags] = useState(initialAgentTags);
  const [agentDrafts, setAgentDrafts] = useState(initialAgentTags);
  const [savingAgent, setSavingAgent] = useState<string | null>(null);

  const agentTagOptions = [{ id: "global", name: "global" }, ...tags.map((t) => ({ id: t, name: t }))];
  const agentNames = Object.keys(agentTags).sort();

  async function handleSaveAgentTag(agentName: string) {
    const tag = agentDrafts[agentName];
    setSavingAgent(agentName);
    try {
      const res = await callMain(() => window.maestro.templates.agentProjectTags.save(agentName, tag));
      if (!res.ok) {
        toast(<>Could not save the project tag: {res.error}</>, { variant: "error" });
        return;
      }
      setAgentTags((prev) => ({ ...prev, [agentName]: res.value }));
      toast(
        <>
          Set <span className="font-mono text-(--ink)">{agentName}</span>&apos;s project tag to{" "}
          <span className="font-mono text-(--ink)">{res.value}</span>.
        </>
      );
    } finally {
      setSavingAgent(null);
    }
  }

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
    <>
      <div className="rounded-lg border border-(--line) p-4 mb-4">
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

      <div className="rounded-lg border border-(--line) overflow-hidden">
        <p className="text-[12px] text-(--ink-3) m-0 p-4 pb-0">
          Which of the tags above each agent belongs to — the <b>project tag</b>, distinct from the Agent
          Types tab&apos;s developer/planner/reviewer/annotator/tester classification. An agent tagged{" "}
          <span className="font-mono text-(--ink-2)">global</span> applies to every project regardless of
          category (reviewer, scribe, test, refactor); the rest match the project&apos;s own selected tags
          on <span className="font-mono text-(--ink-2)">/maestro</span>.
        </p>
        <div className="mt-3">
          {agentNames.length === 0 ? (
            <p className="text-[13px] text-subtle m-0 p-4">No agent has a project tag yet.</p>
          ) : (
            agentNames.map((name) => {
              const dirty = agentDrafts[name] !== agentTags[name];
              return (
                <div
                  key={name}
                  className="flex items-center gap-3 px-4 py-3 border-b border-(--line) last:border-0"
                >
                  <div className="font-mono text-[13px] text-(--ink) w-28 shrink-0">{name}</div>
                  <div className="w-48">
                    <Select
                      value={agentDrafts[name]}
                      onChange={(v) => setAgentDrafts((prev) => ({ ...prev, [name]: v }))}
                      options={agentTagOptions}
                    />
                  </div>
                  <Button
                    variant="primary"
                    icon={savingAgent === name ? undefined : <Save size={13} />}
                    loading={savingAgent === name}
                    disabled={!dirty}
                    onClick={() => void handleSaveAgentTag(name)}
                  >
                    Save
                  </Button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
