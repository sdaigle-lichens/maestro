// The Rules tab: local-only. There is no global rule tier anywhere in this codebase —
// `discoverProjectRules` and `discoverRuleLibrary` are both project-relative — so this tab shows
// what is ASSIGNED in the selected project (`.claude/rules/`, the same set `/rules` edits) and
// says plainly that nothing wider exists, rather than inventing a global tier that isn't real.

import { Link } from "@tanstack/react-router";
import { WarningIcon } from "@phosphor-icons/react";
import type { ProjectRule } from "../../utils/tools";

const TH =
  "border-b border-maestro px-4 py-2.5 text-left text-[12px] font-semibold uppercase tracking-[0.08em] text-maestro-muted";
const ROW = "border-b border-maestro last:border-0 hover:bg-maestro-elevated transition-colors";

export default function RulesTab({ projectRules }: { projectRules: ProjectRule[] }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-amber-500/10 text-[12px]">
        <WarningIcon size={14} className="shrink-0 mt-px text-amber-500" />
        <span className="text-maestro-muted">
          There is no global rule tier yet — every rule below is local to this project. Assigning rules to directories
          happens in{" "}
          <Link to="/rules" className="text-maestro-primary underline">
            Rules
          </Link>
          .
        </span>
      </div>

      {projectRules.length === 0 ? (
        <p className="text-[13px] text-maestro-muted m-0">
          No rules are assigned in this project — nothing under <span className="font-mono">.claude/rules/</span>.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-maestro">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-maestro-elevated">
                <th className={TH}>Rule</th>
                <th className={TH}>Assigned to</th>
                <th className={TH}>Description</th>
              </tr>
            </thead>
            <tbody>
              {projectRules.map((rule) => (
                <tr key={rule.id} className={ROW}>
                  <td className="px-4 py-2.5 align-top">
                    <span className="inline-block rounded-md border border-maestro-focus-ring bg-maestro-primary-subtle px-2 py-0.5 font-mono text-[12px] text-maestro-primary">
                      {rule.id}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 align-top font-mono text-[12px] text-maestro-muted">
                    {rule.dir === "" ? "Project root" : rule.dir}
                  </td>
                  <td className="px-4 py-2.5 align-top text-[13px] text-maestro-muted">{rule.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
