// The /templates page's Agent Types tab — the GLOBAL, one-per-agent classification store
// (agent-types.ts). Unlike the Reports tab, there's no document to edit, just one Select per
// agent — so this is a flat list of rows rather than a two-pane list+editor, each row tracking its
// own dirty state and its own disabled-until-dirty Save button.

import { useState } from "react";
import { Save } from "lucide-react";
import Button from "@repo/ui/button";
import Select from "@repo/ui/select";
import { toast } from "@repo/ui/toast";
import { callMain } from "../../utils/call-main";
import { AGENT_TYPES, type AgentType } from "../../../../shared/ipc";

const TYPE_OPTIONS = AGENT_TYPES.map((t) => ({ id: t, name: t }));

export default function AgentTypesTab({ initial }: { initial: Record<string, AgentType> }) {
  const [types, setTypes] = useState(initial);
  const [drafts, setDrafts] = useState<Record<string, AgentType>>(initial);
  const [saving, setSaving] = useState<string | null>(null);

  const agentNames = Object.keys(types).sort();

  async function handleSave(agentName: string) {
    const tag = drafts[agentName];
    setSaving(agentName);
    try {
      const res = await callMain(() => window.maestro.templates.agentTypes.save(agentName, tag));
      if (!res.ok) {
        toast(<>Could not save the agent type: {res.error}</>, { variant: "error" });
        return;
      }
      setTypes((prev) => ({ ...prev, [agentName]: res.value }));
      toast(
        <>
          Set <span className="font-mono text-(--ink)">{agentName}</span>&apos;s type to{" "}
          <span className="font-mono text-(--ink)">{res.value}</span>.
        </>
      );
    } finally {
      setSaving(null);
    }
  }

  return (
    <div className="rounded-lg border border-(--line) overflow-hidden">
      {agentNames.length === 0 ? (
        <p className="text-[13px] text-subtle m-0 p-4">No agent has a type yet.</p>
      ) : (
        agentNames.map((name) => {
          const dirty = drafts[name] !== types[name];
          return (
            <div
              key={name}
              className="flex items-center gap-3 px-4 py-3 border-b border-(--line) last:border-0"
            >
              <div className="font-mono text-[13px] text-(--ink) w-28 shrink-0">{name}</div>
              <div className="w-48">
                <Select
                  value={drafts[name]}
                  onChange={(v) => setDrafts((prev) => ({ ...prev, [name]: v as AgentType }))}
                  options={TYPE_OPTIONS}
                />
              </div>
              <Button
                variant="primary"
                icon={saving === name ? undefined : <Save size={13} />}
                loading={saving === name}
                disabled={!dirty}
                onClick={() => void handleSave(name)}
              >
                Save
              </Button>
            </div>
          );
        })
      )}
    </div>
  );
}
