// The /templates page's Reports tab — the GLOBAL tier's own editor. Two-pane, mirroring /agents's
// right pane (Textarea, disabled-until-dirty Save) so the two pages read as the same app; the
// difference is what gets written: /agents always saves a PROJECT override for the open project,
// this always saves the machine-wide fallback every project without one falls back to.
//
// Strictly "edit the agents that already have a global default" for this slice — it does not offer
// creating a brand-new one for an agent with none (e.g. refactor/reviewer never had a
// `## Mandatory Output Format` section, so they have no seed row). The store has no obstacle to
// adding one, but nothing on this page does it yet; see task.md.

import { useEffect, useState } from "react";
import { FileText, Save } from "lucide-react";
import Button from "@repo/ui/button";
import { Textarea } from "@repo/ui/field";
import { toast } from "@repo/ui/toast";
import { callMain } from "../../utils/call-main";
import type { ReportDefault } from "../../../../shared/ipc";

type Phase = "idle" | "saving";

export default function GlobalReportsTab({ initial }: { initial: Record<string, ReportDefault> }) {
  const [reports, setReports] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [dirty, setDirty] = useState(false);

  const agentNames = Object.keys(reports).sort();

  // Re-seed the editor whenever the selected agent changes, or after a save updates `reports`.
  useEffect(() => {
    if (!selected) return;
    setContent(reports[selected]?.content ?? "");
    setDirty(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  async function handleSave() {
    if (!selected) return;
    setPhase("saving");
    try {
      const res = await callMain(() => window.maestro.templates.reports.save(selected, content));
      if (!res.ok) {
        toast(<>Could not save the global default: {res.error}</>, { variant: "error" });
        return;
      }
      setReports((prev) => ({ ...prev, [selected]: res.value }));
      setDirty(false);
      toast(
        <>
          Saved as the global default for <span className="font-mono text-(--ink)">{selected}</span> (version{" "}
          {res.value.version}).
        </>
      );
    } finally {
      setPhase("idle");
    }
  }

  return (
    <div
      className="grid overflow-hidden rounded-lg border border-(--line)"
      style={{ gridTemplateColumns: "280px 1fr", minHeight: 520 }}
    >
      <div className="border-r border-(--line) overflow-y-auto">
        {agentNames.length === 0 ? (
          <p className="text-[13px] text-subtle m-0 p-4">No agent has a global default yet.</p>
        ) : (
          agentNames.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setSelected(name)}
              className={`w-full text-left px-4 py-2.5 border-b border-(--line) last:border-0 font-mono text-[13px] cursor-pointer bg-transparent border-x-0 border-t-0 ${
                selected === name ? "bg-(--primary-dim) text-primary" : "text-(--ink) hover:bg-(--bg-elev)"
              }`}
            >
              {name}
            </button>
          ))
        )}
      </div>

      <div className="flex flex-col p-4 gap-3">
        {!selected ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center text-(--ink-2)">
            <FileText size={18} className="text-(--ink-3)" />
            <p className="text-[12px] m-0">Select an agent on the left to edit its global default.</p>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <div>
                <div className="font-mono text-[13px] text-(--ink)">{selected}</div>
                <div className="text-[11px] text-(--ink-3)">Global default · version {reports[selected]?.version}</div>
              </div>
              <Button
                variant="primary"
                icon={phase === "saving" ? undefined : <Save size={13} />}
                loading={phase === "saving"}
                disabled={!dirty}
                onClick={() => void handleSave()}
              >
                Save
              </Button>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <Textarea
                id="global-report-editor"
                value={content}
                onChange={(v) => {
                  setContent(v);
                  setDirty(true);
                }}
                rows={24}
              />
            </div>

            <p className="text-[11px] text-(--ink-3) m-0">
              Saving updates the global fallback every project without its own override for{" "}
              <span className="font-mono">{selected}</span> receives, and bumps its version — the next install or
              update in a project still on the old content will refresh it.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
