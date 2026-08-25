// The Rules tab: local-only. There is no global rule tier anywhere in this codebase —
// `discoverProjectRules` and `discoverRuleLibrary` are both project-relative — so this tab shows
// what is ASSIGNED in the selected project (`.claude/rules/`, the same set `/rules` edits) and
// says plainly that nothing wider exists, rather than inventing a global tier that isn't real.

import { Link } from "@tanstack/react-router";
import { AlertTriangle } from "lucide-react";
import type { ProjectRule } from "../../utils/tools";

const TH =
  "border-b border-(--line) px-4 py-2.5 text-left text-[12px] font-semibold uppercase tracking-[0.08em] text-(--ink-2)";
const ROW = "border-b border-(--line) last:border-0 hover:bg-(--bg-elev) transition-colors";

export default function RulesTab({ projectRules }: { projectRules: ProjectRule[] }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 text-[12px]">
        <AlertTriangle size={14} className="shrink-0 mt-px text-amber-500" />
        <span className="text-(--ink-2)">
          There is no global rule tier yet — every rule below is local to this project. Assigning rules to directories
          happens in{" "}
          <Link to="/rules" className="text-primary underline">
            Rules
          </Link>
          .
        </span>
      </div>

      {projectRules.length === 0 ? (
        <p className="text-[13px] text-subtle m-0">
          No rules are assigned in this project — nothing under <span className="font-mono">.claude/rules/</span>.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-(--line)">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-(--bg-elev)">
                <th className={TH}>Rule</th>
                <th className={TH}>Assigned to</th>
                <th className={TH}>Description</th>
              </tr>
            </thead>
            <tbody>
              {projectRules.map((rule) => (
                <tr key={rule.id} className={ROW}>
                  <td className="px-4 py-2.5 align-top">
                    <span className="inline-block rounded-md border border-ring bg-(--primary-dim) px-2 py-0.5 font-mono text-[12px] text-primary">
                      {rule.id}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 align-top font-mono text-[12px] text-(--ink-2)">
                    {rule.dir === "" ? "Project root" : rule.dir}
                  </td>
                  <td className="px-4 py-2.5 align-top text-[13px] text-(--ink-2)">{rule.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
