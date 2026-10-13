import { FolderOpenIcon, WarningIcon } from "@phosphor-icons/react";
import type { InstallReport } from "../../../shared/ipc";

/** What the install did, listed file by file — the report the plan asks the action to produce. */
export default function InstallReportCard({ report }: { report: InstallReport }) {
  const { orchestratorSkill: skill, scriptsWritten, hooksAdded } = report;
  // The install refused to touch an unusable `.claude/maestro.json` and wrote nothing, so the
  // "What changed on disk" framing (and its "Nothing — already current" line) would be wrong.
  if (report.configRefusal) {
    return (
      <div role="alert" className="flex flex-col gap-2 p-4 rounded-lg border border-red-500/40 bg-red-500/10">
        <div className="flex items-center gap-2 text-[11px] font-semibold text-red-500 uppercase tracking-wide">
          <WarningIcon size={14} className="shrink-0" /> Install refused — nothing was changed
        </div>
        <p className="text-[12px] text-maestro m-0">{report.configRefusal.message}</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-maestro bg-maestro-elevated">
      <div className="text-[11px] font-semibold text-maestro-muted uppercase tracking-wide">What changed on disk</div>
      {report.unchanged ? (
        <p className="text-[12px] text-maestro-muted m-0">
          Nothing — this project already has the runtime the app ships.
        </p>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col gap-1 text-[12px] text-maestro-muted">
          {skill.action !== "unchanged" && (
            <li>
              Orchestrator skill:{" "}
              <span className="text-maestro">
                {skill.action === "installed" && "installed"}
                {skill.action === "synced" && `re-synced (${skill.regions.join(", ")})`}
                {skill.action === "migrated" && "replaced — it predates Maestro's managed regions"}
              </span>
              {skill.backup && (
                <>
                  {" "}
                  <button
                    type="button"
                    onClick={() => void window.maestro.shell.reveal(skill.backup!)}
                    className="inline-flex items-center gap-1 text-maestro-primary underline cursor-pointer bg-transparent border-0 p-0 text-[12px]"
                  >
                    <FolderOpenIcon size={11} /> show the backup
                  </button>
                </>
              )}
            </li>
          )}
          {scriptsWritten.length > 0 && (
            <li>
              {scriptsWritten.length} runtime file{scriptsWritten.length === 1 ? "" : "s"} written:{" "}
              {/*
                A first install writes ~35 files, most of them handoff-protocol templates. Listing
                every one buries the two lines that matter (the skill, the hooks) under a wall of
                paths, so the tail is summarised instead.
              */}
              <span className="font-mono text-maestro-muted">
                {scriptsWritten.slice(0, 6).join(", ")}
                {scriptsWritten.length > 6 && ` and ${scriptsWritten.length - 6} more`}
              </span>
            </li>
          )}
          {hooksAdded.length > 0 && (
            <li>
              {hooksAdded.length} hook{hooksAdded.length === 1 ? "" : "s"} registered in{" "}
              <span className="font-mono text-maestro">.claude/settings.json</span>:{" "}
              <span className="font-mono text-maestro-muted">{hooksAdded.join(", ")}</span>
            </li>
          )}
          {report.gitignoreUpdated && <li>Session files added to the repo&rsquo;s .gitignore.</li>}
          {report.reportsSync.materialized.length > 0 && (
            <li>
              Report{report.reportsSync.materialized.length === 1 ? "" : "s"} materialized from the global default:{" "}
              <span className="font-mono text-maestro-muted">{report.reportsSync.materialized.join(", ")}</span>
            </li>
          )}
          {report.reportsSync.refreshed.length > 0 && (
            <li>
              Report{report.reportsSync.refreshed.length === 1 ? "" : "s"} refreshed from a newer global default:{" "}
              <span className="font-mono text-maestro-muted">{report.reportsSync.refreshed.join(", ")}</span>
            </li>
          )}
          {report.reportsSync.staleCustomized.length > 0 && (
            <li>
              Stale but customized — left alone since you edited{" "}
              {report.reportsSync.staleCustomized.length === 1 ? "it" : "them"}:{" "}
              <span className="font-mono text-maestro-muted">{report.reportsSync.staleCustomized.join(", ")}</span>
            </li>
          )}
          {/*
            The same three lines one tier over (`033`/`034`). Entries are `"<sender>/<receiver>"`
            handoff ids rather than agent names, and a wired route with no template at any tier
            appears in NO bucket — nothing was written, so there is nothing to report.
          */}
          {report.handoffsSync.materialized.length > 0 && (
            <li>
              Handoff protocol{report.handoffsSync.materialized.length === 1 ? "" : "s"} materialized from the global
              default:{" "}
              <span className="font-mono text-maestro-muted">{report.handoffsSync.materialized.join(", ")}</span>
            </li>
          )}
          {report.handoffsSync.refreshed.length > 0 && (
            <li>
              Handoff protocol{report.handoffsSync.refreshed.length === 1 ? "" : "s"} refreshed from a newer global
              default: <span className="font-mono text-maestro-muted">{report.handoffsSync.refreshed.join(", ")}</span>
            </li>
          )}
          {report.handoffsSync.staleCustomized.length > 0 && (
            <li>
              Handoff protocol{report.handoffsSync.staleCustomized.length === 1 ? "" : "s"} stale but customized — left
              alone since you edited {report.handoffsSync.staleCustomized.length === 1 ? "it" : "them"}:{" "}
              <span className="font-mono text-maestro-muted">{report.handoffsSync.staleCustomized.join(", ")}</span>
            </li>
          )}
          {report.skillListsSeeded && (
            <li>
              Skill lists seeded with the defaults:{" "}
              <span className="font-mono text-maestro-muted">
                {[
                  report.skillListsSeeded.start_skills && "start_skills",
                  report.skillListsSeeded.end_skills && "end_skills",
                ]
                  .filter(Boolean)
                  .join(", ") || "none"}
              </span>
              {report.skillListsSeeded.gatesRemoved && " (a leftover gates key was removed)"}. Change them in the skill
              lists card on this page.
            </li>
          )}
        </ul>
      )}
      {/*
        Duplicate-agent-type collisions (`041`) — never auto-repaired, so this is a report, not a
        change, and it must render even when nothing else did (`report.unchanged`): the runtime can
        be current while a hand-edited config still carries the collision. Kept out of the `ul`
        above and its `unchanged` gate for that reason.
      */}
      {report.configIssues.length > 0 && (
        <ul className="list-none p-0 m-0 flex flex-col gap-1 text-[12px]">
          {report.configIssues.map((issue, i) => (
            <li key={i} className="text-amber-500">
              {issue.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
