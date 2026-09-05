import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import Button from "@repo/ui/button";
import { toast } from "@repo/ui/toast";
import {
  AlertTriangle,
  Check,
  Download,
  FolderOpen,
  GitBranch,
  Inbox,
  PowerOff,
  RefreshCw,
  ShieldCheck,
  Tag as TagIcon,
  Trash2,
  X,
} from "lucide-react";
import TopNav from "../components/top-nav";
import { callMain, type CallResult } from "../utils/call-main";
import { useProject } from "../utils/project-context";
import { useInstall } from "../utils/install-context";
import type {
  AgentSyncSummary,
  InstallReport,
  InstallStatus,
  GatesData,
  PendingLane,
  ProjectTagsData,
  UninstallPlan,
  UninstallReport,
} from "../../../shared/ipc";

export const Route = createFileRoute("/maestro")({
  component: InstallPage,
});

type Phase = "idle" | "installing" | "uninstalling" | "purging";

/** The last thing that ran, so the page reports install and removal in the same slot. */
type Outcome = { kind: "install"; report: InstallReport } | { kind: "uninstall"; report: UninstallReport };

function Row({ ok, label, detail }: { ok: boolean; label: string; detail: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-(--line) last:border-b-0">
      {ok ? (
        <Check size={14} className="shrink-0 mt-0.5 text-(--green)" />
      ) : (
        <X size={14} className="shrink-0 mt-0.5 text-amber-500" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-[13px] text-(--ink)">{label}</div>
        <div className="text-[12px] text-(--ink-3)">{detail}</div>
      </div>
    </div>
  );
}

function Note({ variant, children }: { variant: "warn" | "error"; children: React.ReactNode }) {
  const tone = variant === "error" ? "bg-red-500/10 text-red-500" : "bg-amber-500/10 text-amber-500";
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg text-[12px] ${tone}`}>
      <AlertTriangle size={14} className="shrink-0 mt-px" />
      <span className="text-(--ink-2)">{children}</span>
    </div>
  );
}

/** What the install did, listed file by file — the report the plan asks the action to produce. */
function ReportCard({ report }: { report: InstallReport }) {
  const { orchestratorSkill: skill, scriptsWritten, hooksAdded } = report;
  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-(--line) bg-(--bg-elev)">
      <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide">What changed on disk</div>
      {report.unchanged ? (
        <p className="text-[12px] text-(--ink-2) m-0">Nothing — this project already has the runtime the app ships.</p>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col gap-1 text-[12px] text-(--ink-2)">
          {skill.action !== "unchanged" && (
            <li>
              Orchestrator skill:{" "}
              <span className="text-(--ink)">
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
                    className="inline-flex items-center gap-1 text-primary underline cursor-pointer bg-transparent border-0 p-0 text-[12px]"
                  >
                    <FolderOpen size={11} /> show the backup
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
              <span className="font-mono text-(--ink-3)">
                {scriptsWritten.slice(0, 6).join(", ")}
                {scriptsWritten.length > 6 && ` and ${scriptsWritten.length - 6} more`}
              </span>
            </li>
          )}
          {hooksAdded.length > 0 && (
            <li>
              {hooksAdded.length} hook{hooksAdded.length === 1 ? "" : "s"} registered in{" "}
              <span className="font-mono text-(--ink)">.claude/settings.json</span>:{" "}
              <span className="font-mono text-(--ink-3)">{hooksAdded.join(", ")}</span>
            </li>
          )}
          {report.gitignoreUpdated && <li>Session files added to the repo&rsquo;s .gitignore.</li>}
          {report.reportsSync.materialized.length > 0 && (
            <li>
              Report{report.reportsSync.materialized.length === 1 ? "" : "s"} materialized from the global default:{" "}
              <span className="font-mono text-(--ink-3)">{report.reportsSync.materialized.join(", ")}</span>
            </li>
          )}
          {report.reportsSync.refreshed.length > 0 && (
            <li>
              Report{report.reportsSync.refreshed.length === 1 ? "" : "s"} refreshed from a newer global default:{" "}
              <span className="font-mono text-(--ink-3)">{report.reportsSync.refreshed.join(", ")}</span>
            </li>
          )}
          {report.reportsSync.staleCustomized.length > 0 && (
            <li>
              Stale but customized — left alone since you edited{" "}
              {report.reportsSync.staleCustomized.length === 1 ? "it" : "them"}:{" "}
              <span className="font-mono text-(--ink-3)">{report.reportsSync.staleCustomized.join(", ")}</span>
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
              default: <span className="font-mono text-(--ink-3)">{report.handoffsSync.materialized.join(", ")}</span>
            </li>
          )}
          {report.handoffsSync.refreshed.length > 0 && (
            <li>
              Handoff protocol{report.handoffsSync.refreshed.length === 1 ? "" : "s"} refreshed from a newer global
              default: <span className="font-mono text-(--ink-3)">{report.handoffsSync.refreshed.join(", ")}</span>
            </li>
          )}
          {report.handoffsSync.staleCustomized.length > 0 && (
            <li>
              Handoff protocol{report.handoffsSync.staleCustomized.length === 1 ? "" : "s"} stale but customized — left
              alone since you edited {report.handoffsSync.staleCustomized.length === 1 ? "it" : "them"}:{" "}
              <span className="font-mono text-(--ink-3)">{report.handoffsSync.staleCustomized.join(", ")}</span>
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

/** What the uninstall took — and, just as importantly, what it left. */
function RemovalCard({ report }: { report: UninstallReport }) {
  return (
    <div className="flex flex-col gap-2 p-4 rounded-lg border border-(--line) bg-(--bg-elev)">
      <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide">
        {report.purge ? "What was deleted" : "What was removed"}
      </div>
      {report.noop ? (
        <p className="text-[12px] text-(--ink-2) m-0">
          Nothing — this project had no Maestro runtime installed. No files were changed.
        </p>
      ) : (
        <ul className="list-none p-0 m-0 flex flex-col gap-1 text-[12px] text-(--ink-2)">
          {report.hooksRemoved.length > 0 && (
            <li>
              {report.hooksRemoved.length} hook{report.hooksRemoved.length === 1 ? "" : "s"} unregistered from{" "}
              <span className="font-mono text-(--ink)">.claude/settings.json</span>:{" "}
              <span className="font-mono text-(--ink-3)">{report.hooksRemoved.join(", ")}</span>
            </li>
          )}
          {report.sessionFilesRemoved.length > 0 && (
            <li>
              {report.sessionFilesRemoved.length} ephemeral session file
              {report.sessionFilesRemoved.length === 1 ? "" : "s"} deleted — recreated by the next session.
            </li>
          )}
          {report.legacyAgentSettingRemoved && (
            <li>
              The legacy <span className="font-mono">agent: &quot;maestro&quot;</span> setting was cleared.
            </li>
          )}
          {report.purged.length > 0 && (
            <li>
              {report.purged.length} file{report.purged.length === 1 ? "" : "s"} deleted:{" "}
              <span className="font-mono text-(--ink-3)">
                {report.purged.slice(0, 6).join(", ")}
                {report.purged.length > 6 && ` and ${report.purged.length - 6} more`}
              </span>
            </li>
          )}
          {report.maestroTasksDeleted && (
            <li>
              The task queue at <span className="font-mono text-(--ink)">.claude/maestro-tasks/</span> was deleted too —
              you opted into that separately.
            </li>
          )}
        </ul>
      )}
      {/* The half that makes the two levels legible: say what is still there. */}
      <div className="pt-2 mt-1 border-t border-(--line) text-[12px] text-(--ink-3)">
        {report.configKept ? (
          <>
            Kept: <span className="font-mono text-(--ink-2)">.claude/maestro.json</span> — your workflow and rule
            configuration. Install again to switch the hooks back on.
          </>
        ) : report.purge ? (
          <>Nothing of Maestro&rsquo;s is left in this project. Installing again starts from a fresh config.</>
        ) : (
          <>
            This project had no <span className="font-mono text-(--ink-2)">.claude/maestro.json</span> to keep.
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The purge confirmation.
 *
 * It lists the files by name rather than asking "are you sure?", because the list is the whole
 * point: `maestro.json` is on it, it is hand-authored, and nothing else in the app can restore it.
 * A generic confirmation would be consent to something the user hasn't been told.
 */
function PurgeDialog({
  plan,
  busy,
  onCancel,
  onConfirm,
}: {
  plan: UninstallPlan;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (opts: { deleteMaestroTasks: boolean }) => void;
}) {
  // Opt-in, unchecked by default: ticking this box IS the "explicit permission" that
  // .claude/maestro-tasks/ needs on top of purge. Kept out of `plan.purgeFiles` on purpose, so
  // the two consents — purge, and delete-the-task-queue — can't be conflated into one click.
  const [deleteMaestroTasks, setDeleteMaestroTasks] = useState(false);
  const hasTasks = plan.maestroTasks.files.length > 0 || plan.maestroTasks.hasStatusJson;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !busy && onCancel();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [busy, onCancel]);

  return (
    <div
      className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
      onClick={() => !busy && onCancel()}
    >
      <div
        className="bg-(--bg) border border-(--line) rounded-xl p-5 shadow-xl w-[520px] max-w-[90vw] flex flex-col gap-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-[13px] font-semibold text-(--ink)">
          <Trash2 size={14} className="text-red-500" />
          Delete Maestro from this project
        </div>
        <p className="text-[12px] text-(--ink-2) m-0">
          This permanently deletes {plan.purgeFiles.length} file
          {plan.purgeFiles.length === 1 ? "" : "s"} from{" "}
          <span className="font-mono text-(--ink)">{plan.projectRoot}</span>, plus the registered hooks and the session
          files. It cannot be undone from the app.
        </p>
        {plan.purgeRemovesConfig && (
          <div className="flex items-start gap-2 px-3 py-2 rounded-lg text-[12px] bg-red-500/10 text-red-500">
            <AlertTriangle size={14} className="shrink-0 mt-px" />
            <span className="text-(--ink-2)">
              <span className="font-mono text-(--ink)">.claude/maestro.json</span> is included — your workflow graph and
              rule assignments go with it. Plain <b>Uninstall</b> keeps that file.
            </span>
          </div>
        )}
        {hasTasks && (
          <label className="flex items-start gap-2 px-3 py-2 rounded-lg text-[12px] bg-amber-500/10 cursor-pointer">
            <input
              type="checkbox"
              checked={deleteMaestroTasks}
              onChange={(e) => setDeleteMaestroTasks(e.target.checked)}
              disabled={busy}
              className="mt-0.5 shrink-0 cursor-pointer"
            />
            <span className="text-(--ink-2)">
              Also delete <span className="font-mono text-(--ink)">{plan.maestroTasks.dir}/</span> —{" "}
              {plan.maestroTasks.files.length} task file{plan.maestroTasks.files.length === 1 ? "" : "s"} written by{" "}
              <span className="font-mono">/to-maestro-tasks</span>. Unchecked, this purge leaves it alone.
            </span>
          </label>
        )}
        <div className="max-h-60 overflow-y-auto rounded-lg border border-(--line) bg-(--bg-elev) p-2">
          <ul className="list-none p-0 m-0 flex flex-col">
            {plan.purgeFiles.map((file) => (
              <li
                key={file}
                className={`font-mono text-[11px] leading-5 truncate ${
                  file.endsWith("maestro.json") ? "text-red-500" : "text-(--ink-3)"
                }`}
                title={file}
              >
                {file}
              </li>
            ))}
          </ul>
        </div>
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-3 py-1.5 text-[12px] rounded-lg bg-(--bg-elev) border border-(--line) text-(--ink-2) hover:text-(--ink) cursor-pointer focus:outline-none disabled:opacity-60 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm({ deleteMaestroTasks })}
            className="px-3 py-1.5 text-[12px] rounded-lg bg-red-500 text-white cursor-pointer focus:outline-none hover:bg-red-600 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {busy
              ? "Deleting…"
              : `Delete ${plan.purgeFiles.length + (deleteMaestroTasks ? plan.maestroTasks.files.length : 0)} file${
                  plan.purgeFiles.length + (deleteMaestroTasks ? plan.maestroTasks.files.length : 0) === 1 ? "" : "s"
                }`}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The post-install Project Tags section — only shown once `status.installed` is true (the
 * grilling answer this page follows: tags are shown/editable here only after install, never
 * before). Mirrors `ReportCard`/`RemovalCard`'s styling.
 */
function ProjectTagsCard({ viewedRoot }: { viewedRoot: string }) {
  const [data, setData] = useState<ProjectTagsData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void callMain(() => window.maestro.data.projectTags()).then((res) => {
      if (!cancelled && res.ok) setData(res.value);
    });
    return () => {
      cancelled = true;
    };
  }, [viewedRoot]);

  if (!data) return null;

  const toggle = async (tag: string) => {
    if (!data) return;
    const next = data.selected.includes(tag) ? data.selected.filter((t) => t !== tag) : [...data.selected, tag];
    setBusy(true);
    try {
      const res = await callMain(() => window.maestro.project.tags.set(next));
      if (!res.ok) {
        toast(<>Could not save project tags: {res.error}</>, { variant: "error" });
        return;
      }
      setData({ ...data, selected: res.value });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-(--line) bg-(--bg-elev)">
      <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide flex items-center gap-1.5">
        <TagIcon size={12} /> Project tags
      </div>
      <p className="text-[12px] text-(--ink-2) m-0">
        Which of the catalog&rsquo;s categories this project belongs to. Tags matched from repo detection at install
        time are pre-checked; adding one may add a matching bundled agent (backend/frontend/mobile) to{" "}
        <span className="font-mono">agents_available</span> — unchecking never removes one, that stays a manual edit on
        Workflows. Edited from the same catalog as the <span className="font-mono">/templates</span> page&rsquo;s
        Project Tags tab.
      </p>
      {data.catalog.length === 0 ? (
        <p className="text-[12px] text-(--ink-3) m-0">
          The catalog is empty — add tags from <span className="font-mono">/templates</span> first.
        </p>
      ) : (
        <div className="flex items-center gap-1.5 flex-wrap">
          {data.catalog.map((tag) => {
            const checked = data.selected.includes(tag);
            return (
              <label
                key={tag}
                className={`inline-flex items-center gap-1.5 h-7 pl-2 pr-2.5 rounded-full border font-mono text-[12px] cursor-pointer ${
                  checked ? "border-primary text-(--ink) bg-(--primary-dim)" : "border-(--line) text-(--ink-2)"
                } ${busy ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={busy}
                  onChange={() => void toggle(tag)}
                  className="cursor-pointer"
                />
                {tag}
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The post-install Step 1 gates section. Structurally `ProjectTagsCard` above — a checkbox card
 * that writes `maestro.json` on every click with no Save button — because it is the same kind of
 * thing, and the two should stay easy to read side by side.
 *
 * What it writes is read by nothing in this app: `maestro-step1-gates.cjs` reads `gates` at
 * `/maestro` invocation time and prints the one line the orchestrator's Step 1 injects. So a
 * change here shows up in the NEXT orchestration, not in anything on screen.
 */
function GatesCard({ viewedRoot }: { viewedRoot: string }) {
  const [data, setData] = useState<GatesData | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void callMain(() => window.maestro.data.gates()).then((res) => {
      if (!cancelled && res.ok) setData(res.value);
    });
    return () => {
      cancelled = true;
    };
  }, [viewedRoot]);

  if (!data) return null;

  const toggle = async (key: keyof GatesData["gates"]) => {
    const next = { ...data.gates, [key]: !data.gates[key] };
    setBusy(true);
    try {
      const res = await callMain(() => window.maestro.project.gates.set(next));
      if (!res.ok) {
        toast(<>Could not save the Step 1 gates: {res.error}</>, { variant: "error" });
        return;
      }
      setData({ gates: res.value });
    } finally {
      setBusy(false);
    }
  };

  const rows: { key: keyof GatesData["gates"]; skill: string; blurb: string }[] = [
    {
      key: "confidence_check",
      skill: "/confidence-check",
      blurb: "Score how well the request is understood before committing a workflow to it.",
    },
    {
      key: "use_code_architecture_design_check",
      skill: "/use-code-architecture-design-check",
      blurb: "Decide whether the work needs a design pass first. Runs on its own if you leave the box above unchecked.",
    },
  ];

  return (
    <div className="flex flex-col gap-3 p-4 rounded-lg border border-(--line) bg-(--bg-elev)">
      <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide flex items-center gap-1.5">
        <ShieldCheck size={12} /> Step 1 gates
      </div>
      <p className="text-[12px] text-(--ink-2) m-0">
        Which gate skills the <span className="font-mono">/maestro</span> orchestrator runs before it classifies a
        request. Both start off — uncheck both and Step 1 is skipped entirely, and the run goes straight to matching a
        workflow. Saved to <span className="font-mono">.claude/maestro.json</span> on every click and read at the start
        of the next orchestration.
      </p>
      <div className="flex flex-col gap-2">
        {rows.map((row) => (
          <label
            key={row.key}
            className={`flex items-start gap-2 text-[12px] text-(--ink-2) ${
              busy ? "opacity-60 cursor-not-allowed" : "cursor-pointer"
            }`}
          >
            <input
              type="checkbox"
              checked={data.gates[row.key]}
              disabled={busy}
              onChange={() => void toggle(row.key)}
              className="mt-0.5 accent-primary cursor-pointer"
            />
            <span>
              Run <span className="font-mono">{row.skill}</span>
              <span className="block text-(--ink-3)">{row.blurb}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

/** `oldestAgeMs` in the words `/maestro` shows beside a lane — never sub-hour, this is a backlog view. */
function formatAge(ms: number): string {
  const hours = ms / (60 * 60 * 1000);
  if (hours < 24) return `${Math.max(1, Math.round(hours))} hour${Math.round(hours) === 1 ? "" : "s"}`;
  const days = hours / 24;
  const rounded = days < 10 ? Math.round(days * 10) / 10 : Math.round(days);
  return `${rounded} day${rounded === 1 ? "" : "s"}`;
}

/**
 * `037`'s entry point — every `.claude/channels/<receiver>/` lane still holding a file, right now.
 *
 * READ-ONLY, same discipline as `ForkedAgentsCard` below: nothing here delivers, retires or sweeps
 * a channel file — that is entirely `036`'s hooks' job, inside a live session. This just names what
 * is waiting, and whether the CURRENT run (if one is live) will deliver it or it is queued for an
 * agent nothing has invoked yet — which is a backlog, not an error, and is worded that way rather
 * than as "stranded".
 */
function ChannelsCard({ viewedRoot }: { viewedRoot: string }) {
  const [lanes, setLanes] = useState<PendingLane[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void callMain(() => window.maestro.channels.pending()).then((res) => {
      if (!cancelled && res.ok) setLanes(res.value);
    });
    return () => {
      cancelled = true;
    };
  }, [viewedRoot]);

  if (!lanes || lanes.length === 0) return null;

  return (
    <div
      data-testid="maestro-channels"
      data-lanes={lanes.length}
      className="flex flex-col gap-3 p-4 rounded-lg border border-(--line) bg-(--bg-elev)"
    >
      <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide flex items-center gap-1.5">
        <Inbox size={12} /> Channels
      </div>
      <p className="text-[12px] text-(--ink-2) m-0">
        Payloads waiting in <span className="font-mono">.claude/channels/</span> for an agent that hasn&rsquo;t consumed
        them yet. A route with no workflow to it — like the scribe&rsquo;s concept-skill gaps — simply queues here until
        that agent is next invoked, which can be a later run.
      </p>
      <ul className="list-none p-0 m-0 flex flex-col gap-1.5">
        {lanes.map((lane) => (
          <li
            key={lane.receiver}
            data-testid={`channel-lane-${lane.receiver}`}
            className="text-[12px] flex flex-wrap items-baseline gap-x-1.5"
          >
            <span className="font-mono text-(--ink)">{lane.receiver}</span>
            <span className="text-(--ink-2)">{lane.count} pending</span>
            <span className="text-(--ink-3)">
              {lane.stranded === 0
                ? "— will be delivered this run"
                : lane.current > 0
                  ? `— ${lane.current} this run, ${lane.stranded} queued (oldest ${formatAge(lane.oldestAgeMs)})`
                  : `— queued for ${lane.receiver}, from a previous run (oldest ${formatAge(lane.oldestAgeMs)})`}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * `031`'s entry point, and deliberately only that: a COUNT and a link, not a modal.
 *
 * The summary behind it is computed on project selection (see `InstallProvider`) and writes
 * nothing — those `.claude/agents/*.md` may be committed, and a diff nobody asked for is hard to
 * explain. The per-agent review, the diff and the update / keep / detach actions all live on
 * `/agents`, where the agent itself is already on screen.
 *
 * Renders nothing when no fork has diverged, which is the normal state.
 */
function ForkedAgentsCard({ summary }: { summary: AgentSyncSummary }) {
  const count = summary.diverged.length;
  if (count === 0) return null;
  return (
    <div
      data-testid="maestro-diverged-forks"
      data-count={count}
      className="flex flex-col gap-2 p-4 rounded-lg border border-(--line) bg-(--bg-elev)"
    >
      <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide flex items-center gap-1.5">
        <GitBranch size={12} /> Forked agents
      </div>
      <p className="text-[12px] text-(--ink-2) m-0">
        <b>
          {count} forked agent{count === 1 ? "" : "s"} differ{count === 1 ? "s" : ""} from{" "}
          {count === 1 ? "its" : "their"} template
        </b>{" "}
        — <span className="font-mono text-(--ink-3)">{summary.diverged.join(", ")}</span>. Nothing has been rewritten:
        reviewing each one is how you take the new body, keep the fork as it is, or detach it.
      </p>
      <div>
        <Link
          to="/agents"
          className="inline-flex items-center gap-1.5 text-[12px] text-primary underline cursor-pointer"
        >
          Review them on /agents
        </Link>
      </div>
    </div>
  );
}

function StatusCard({ status }: { status: InstallStatus }) {
  const scriptTrouble = status.scriptsMissing.length + status.scriptsOutOfDate.length;
  return (
    <div className="p-4 rounded-lg border border-(--line) bg-(--bg-elev)">
      <Row
        ok={status.orchestratorSkill && !status.orchestratorSkillOutOfDate}
        label="Orchestrator skill"
        detail={
          !status.orchestratorSkill
            ? "Not installed — .claude/skills/maestro/SKILL.md is absent."
            : status.orchestratorSkillOutOfDate
              ? "Older than the template the app ships. Updating re-syncs it and keeps your handoff table."
              : "Current."
        }
      />
      <Row
        ok={scriptTrouble === 0}
        label="Runtime scripts"
        detail={
          scriptTrouble === 0
            ? "Every hook script in .claude/scripts/ matches what the app ships."
            : [
                status.scriptsMissing.length > 0 && `${status.scriptsMissing.length} missing`,
                status.scriptsOutOfDate.length > 0 && `${status.scriptsOutOfDate.length} out of date`,
              ]
                .filter(Boolean)
                .join(", ")
        }
      />
      <Row
        ok={status.hooksMissing.length === 0}
        label="Session hooks"
        detail={
          status.hooksMissing.length === 0
            ? `All ${status.hooksRegistered.length} registered in this project's .claude/settings.json.`
            : `${status.hooksMissing.length} not registered: ${status.hooksMissing.join(", ")}`
        }
      />
      <Row
        ok={status.configFile}
        label="Workflow config"
        detail={
          status.configFile
            ? ".claude/maestro.json exists."
            : "No .claude/maestro.json yet — it is written the first time you save on Workflows."
        }
      />
      <div className="pt-3 mt-1 border-t border-(--line) text-[11px] text-(--ink-3) font-mono">
        runtime {status.installedRuntimeId} · ships {status.shippedRuntimeId}
      </div>
    </div>
  );
}

/**
 * Install / update Maestro's runtime in a project.
 *
 * The whole page exists because the runtime used to be installed by `/maestro-install` inside a
 * Claude session — a model acting as transport for a file copy. Everything here is one IPC call.
 *
 * This is the project's own landing page now — opening a project from `/` comes straight here —
 * so it shows the runtime for the app's CURRENT project, same as Workflows or Rules, with no
 * separate "which project am I viewing" picker of its own. Every `window.maestro.install.*` call
 * still takes an optional `projectRoot`, which is simply `current.root` here; main falls back to
 * the open project when it is omitted, which only matters for callers that don't have one handy.
 */
function InstallPage() {
  const { current } = useProject();
  const { agentSync } = useInstall();
  const viewedRoot = current?.root ?? null;
  const [status, setStatus] = useState<InstallStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  /** Non-null while the purge confirmation is open — and it is the only way to reach a purge. */
  const [purgePlan, setPurgePlan] = useState<UninstallPlan | null>(null);

  const refreshStatus = useCallback(async () => {
    if (!viewedRoot) {
      setStatus(null);
      setStatusError(null);
      return;
    }
    const res = await callMain(() => window.maestro.install.status(viewedRoot));
    if (res.ok) {
      setStatus(res.value);
      setStatusError(null);
    } else {
      setStatus(null);
      setStatusError(res.error);
    }
  }, [viewedRoot]);

  useEffect(() => {
    setOutcome(null);
    void refreshStatus();
  }, [refreshStatus]);

  const run = async () => {
    setPhase("installing");
    setOutcome(null);
    // try/finally, not a bare reset after the await: a rejected install must still return the
    // button to its resting state rather than spinning forever.
    try {
      const res = await callMain(() => window.maestro.install.run(viewedRoot ?? undefined));
      if (!res.ok) {
        toast(<>Could not install the runtime: {res.error}</>, { variant: "error" });
        return;
      }
      setStatus(res.value.status);
      setOutcome({ kind: "install", report: res.value });
      // A warning here rides on a SUCCESSFUL install (res.ok is true) — it's a caveat, not a
      // failure, so it gets the amber "warning" toast rather than the red "error" one the `!res.ok`
      // branch above uses. Styling it as an error is what made a completed install read as though
      // it had failed.
      for (const warning of res.value.warnings) toast(<>{warning}</>, { variant: "warning" });
      if (!res.value.unchanged && res.value.warnings.length === 0) {
        toast(<>Maestro&rsquo;s runtime is installed and up to date in this project.</>);
      }
    } finally {
      setPhase("idle");
    }
  };

  const runUninstall = async (purge: boolean, deleteMaestroTasks = false) => {
    setPhase(purge ? "purging" : "uninstalling");
    setOutcome(null);
    try {
      const res: CallResult<UninstallReport> = await callMain(() =>
        window.maestro.install.uninstall({ purge, deleteMaestroTasks }, viewedRoot ?? undefined)
      );
      if (!res.ok) {
        toast(<>Could not uninstall: {res.error}</>, { variant: "error" });
        return;
      }
      setStatus(res.value.status);
      setPurgePlan(null);
      setOutcome({ kind: "uninstall", report: res.value });
      // Same reasoning as the install path above: a warning on a successful call is a caveat, not
      // a failure.
      for (const warning of res.value.warnings) toast(<>{warning}</>, { variant: "warning" });
      if (res.value.noop) {
        toast(<>Nothing to remove — this project has no Maestro runtime installed.</>);
      } else if (res.value.warnings.length === 0) {
        toast(
          purge ? (
            <>Maestro was deleted from this project.</>
          ) : (
            <>Maestro&rsquo;s hooks are off. Your maestro.json was kept.</>
          )
        );
      }
    } finally {
      setPhase("idle");
    }
  };

  /** Fetch the plan, then open the confirmation — the dialog never renders an unnamed file list. */
  const openPurge = async () => {
    const res = await callMain(() => window.maestro.install.uninstallPlan(viewedRoot ?? undefined));
    if (!res.ok) {
      toast(<>Could not work out what to delete: {res.error}</>, { variant: "error" });
      return;
    }
    // The dialog is also how the maestro-tasks opt-in is offered, so it still has to open when
    // purgeFiles is empty but the task queue isn't — otherwise that queue has no route to deletion.
    const hasTasks = res.value.maestroTasks.files.length > 0 || res.value.maestroTasks.hasStatusJson;
    if (res.value.purgeFiles.length === 0 && !hasTasks) {
      toast(<>No Maestro files to delete — this project has none left.</>);
      return;
    }
    setPurgePlan(res.value);
  };

  const action = !status || !status.installed ? "install" : status.stale ? "update" : "reinstall";
  const busy = phase !== "idle";
  const error = statusError;

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) overflow-hidden flex flex-col">
      <TopNav />

      <div className="flex-1 overflow-y-auto">
        <div className="max-w-2xl mx-auto p-8 flex flex-col gap-4">
          <div>
            <h1 className="text-[15px] font-semibold m-0">Maestro runtime</h1>
            <p className="text-[12px] text-(--ink-3) m-0 mt-1">
              The hook scripts that run inside a Claude Code session, installed into{" "}
              <span className="font-mono">
                {viewedRoot ? `${viewedRoot.replace(/\/+$/, "")}/.claude/` : "the open project"}
              </span>
              . Registered in that project&rsquo;s own settings — your global Claude configuration is never touched.
            </p>
          </div>

          {!viewedRoot && <Note variant="warn">No project is open. Choose one from the top bar first.</Note>}

          {error && <Note variant="error">Could not read the install status: {error}</Note>}

          {status?.settingsUnreadable && (
            <Note variant="error">
              <span className="font-mono">.claude/settings.json</span> is not valid JSON. Installing would overwrite it,
              so nothing will be written until you fix or move that file — then press the button again.
            </Note>
          )}

          {status && <StatusCard status={status} />}

          {agentSync && <ForkedAgentsCard summary={agentSync} />}

          {status?.installed && viewedRoot && <ChannelsCard key={viewedRoot} viewedRoot={viewedRoot} />}

          {status?.installed && viewedRoot && <ProjectTagsCard key={viewedRoot} viewedRoot={viewedRoot} />}

          {status?.installed && viewedRoot && <GatesCard key={viewedRoot} viewedRoot={viewedRoot} />}

          <div className="flex items-center gap-2">
            <Button
              variant={action === "reinstall" ? "secondary" : "primary"}
              icon={action === "update" ? <RefreshCw size={14} /> : <Download size={14} />}
              loading={phase === "installing"}
              disabled={!viewedRoot || busy}
              onClick={() => void run()}
            >
              {phase === "installing"
                ? "Installing…"
                : action === "install"
                  ? "Install Maestro runtime"
                  : action === "update"
                    ? "Update runtime"
                    : "Reinstall"}
            </Button>
            <Button variant="ghost" icon={<RefreshCw size={13} />} onClick={() => void refreshStatus()}>
              Re-check
            </Button>
            {status && !status.stale && status.installed && (
              <span className="text-[12px] text-(--ink-3)">Up to date — nothing to do.</span>
            )}
          </div>

          {outcome?.kind === "install" && <ReportCard report={outcome.report} />}
          {outcome?.kind === "uninstall" && <RemovalCard report={outcome.report} />}

          {/*
            Two removal levels, kept visibly apart. The default is the one a user reaching for
            "turn this off" means; the purge is a differently-shaped, differently-coloured control
            behind a confirmation that names its files. Collapsing them into one button — or giving
            the destructive one the same weight — is how "stop the hooks firing" becomes data loss.
          */}
          <div className="mt-2 p-4 rounded-lg border border-(--line) bg-(--bg-elev) flex flex-col gap-4">
            <div className="text-[11px] font-semibold text-subtle uppercase tracking-wide">Remove</div>

            <div className="flex flex-col gap-1.5">
              <div>
                <Button
                  variant="secondary"
                  icon={<PowerOff size={14} />}
                  loading={phase === "uninstalling"}
                  disabled={!viewedRoot || busy}
                  onClick={() => void runUninstall(false)}
                >
                  Uninstall
                </Button>
              </div>
              <p className="text-[12px] text-(--ink-3) m-0">
                Unregisters the hooks and deletes the ephemeral session files, so nothing fires in a Claude session any
                more. <span className="font-mono">.claude/maestro.json</span>, the orchestrator skill and the copied
                scripts all stay — installing again switches it back on.
              </p>
            </div>

            <div className="flex flex-col gap-1.5 pt-3 border-t border-(--line)">
              <div>
                <button
                  type="button"
                  disabled={!viewedRoot || busy}
                  onClick={() => void openPurge()}
                  className="inline-flex items-center gap-2 h-9 px-3.5 rounded-lg text-[13px] font-semibold border box-border transition-all duration-150 border-red-500/40 text-red-500 hover:bg-red-500/10 cursor-pointer focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-transparent"
                >
                  <Trash2 size={14} />
                  <span>{phase === "purging" ? "Deleting…" : "Delete everything…"}</span>
                </button>
              </div>
              <p className="text-[12px] text-(--ink-3) m-0">
                Everything above, plus the orchestrator skill, the copied scripts and{" "}
                <span className="font-mono">.claude/maestro.json</span> — your workflow graph and rule assignments. You
                will see the exact list of files before anything is deleted.{" "}
                <span className="font-mono">.claude/maestro-tasks/</span> is a separate opt-in inside that confirmation
                — purging never takes it unless you tick the box.
              </p>
            </div>
          </div>
        </div>
      </div>

      {purgePlan && (
        <PurgeDialog
          plan={purgePlan}
          busy={phase === "purging"}
          onCancel={() => setPurgePlan(null)}
          onConfirm={({ deleteMaestroTasks }) => void runUninstall(true, deleteMaestroTasks)}
        />
      )}
    </div>
  );
}
