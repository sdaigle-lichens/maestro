import { useState } from "react";
import { ArrowsClockwiseIcon, WarningIcon, XIcon } from "@phosphor-icons/react";
import { useSkillRefs } from "../utils/skill-ref-context";
import type { UnavailableReason } from "../utils/maestro";

/** Human wording for why a referenced skill does not resolve (`091`). */
export const SKILL_REF_REASON_LABEL: Record<UnavailableReason, string> = {
  "plugin-not-installed": "plugin not installed",
  "plugin-not-enabled": "plugin not enabled",
  "skill-not-in-plugin": "skill not in plugin",
  "not-found": "not found",
};

/**
 * A small amber label shown beside a skill id when it is in the dangling report; renders nothing
 * for a skill that resolves. Matched by id, so one report entry marks every place the id appears.
 * Advisory only — it never disables or removes anything.
 */
export default function SkillRefMark({ id, className = "" }: { id: string; className?: string }) {
  const { find } = useSkillRefs();
  const ref = find(id);
  if (!ref) return null;
  const label = SKILL_REF_REASON_LABEL[ref.reason];
  return (
    <span
      data-testid="skill-ref-mark"
      data-reason={ref.reason}
      title={`${id}: ${label}. Referenced in ${ref.where.join(", ")}`}
      className={`inline-flex items-center gap-0.5 shrink-0 text-[10px] font-sans text-amber-600 ${className}`}
    >
      <WarningIcon size={10} weight="fill" />
      {label}
    </span>
  );
}

/**
 * A small always-visible "Recheck skills" control, shown whether or not the report has anything in
 * it — once the report is clean the notice is gone, and without this nothing would let the user
 * ask again after changing a plugin outside the app.
 */
export function SkillRefRecheck() {
  const { refresh } = useSkillRefs();
  const [checking, setChecking] = useState(false);
  return (
    <button
      type="button"
      data-testid="skill-ref-recheck"
      disabled={checking}
      title="Re-read which skills and plugins are available"
      onClick={() => {
        setChecking(true);
        void refresh().finally(() => setChecking(false));
      }}
      className="inline-flex items-center gap-1 text-[10px] normal-case font-normal tracking-normal text-maestro-muted hover:text-maestro cursor-pointer focus:outline-none disabled:opacity-60 bg-transparent border-0 p-0"
    >
      <ArrowsClockwiseIcon size={10} /> Recheck skills
    </button>
  );
}

/**
 * One dismissible, non-blocking notice listing the project-level suggestions, with a Recheck
 * button. Render it KEYED BY PROJECT ROOT (`key={projectRoot}`) so a project switch remounts it
 * with fresh dismissal state, like `config-issue-banner.tsx`.
 */
export function SkillRefNotice() {
  const { report, refresh } = useSkillRefs();
  const [dismissed, setDismissed] = useState(false);
  const [checking, setChecking] = useState(false);
  if (report.suggestions.length === 0 || dismissed) return null;

  return (
    <div
      role="status"
      data-testid="skill-ref-notice"
      className="flex items-start gap-2 px-4 py-2 border-b border-maestro bg-amber-500/10 text-[12px] text-maestro-muted"
    >
      <WarningIcon size={14} className="shrink-0 mt-px text-amber-500" />
      <div className="flex-1 flex flex-col gap-0.5">
        {report.suggestions.map((s, i) => (
          <span key={i}>{s}</span>
        ))}
      </div>
      <button
        type="button"
        disabled={checking}
        onClick={() => {
          setChecking(true);
          void refresh().finally(() => setChecking(false));
        }}
        className="shrink-0 inline-flex items-center gap-1 text-maestro-muted hover:text-maestro cursor-pointer focus:outline-none disabled:opacity-60"
      >
        <ArrowsClockwiseIcon size={12} /> Recheck
      </button>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 text-maestro-muted hover:text-maestro cursor-pointer focus:outline-none"
      >
        <XIcon size={14} />
      </button>
    </div>
  );
}
