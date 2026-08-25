import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ListChecks, Copy, Check, CircleCheck, CircleDot, CircleDashed, CheckCheck, Terminal } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CopyableText from "@repo/ui/copyable-text";
import { toast } from "@repo/ui/toast";
import ClaudeRunDialog from "../components/claude-run-dialog";
import TopNav from "../components/top-nav";
import { callMain } from "../utils/call-main";
import { getMaestroTasks, closeMaestroTask, type MaestroTask, type TaskStatus } from "../utils/maestro-tasks";
import type { ClaudePreview } from "../../../shared/ipc";

export const Route = createFileRoute("/maestro-tasks")({
  loader: async () => ({ tasks: await getMaestroTasks() }),
  component: MaestroTasksPage,
});

/**
 * The paste-into-your-own-session prompt.
 *
 * The bridge builds the same sentence in `src/core/claude-preview.ts` for the
 * executable path, deliberately not shared from here: the renderer must not be the source of a
 * prompt the main process will run. Copying it and running it must produce the same session, so
 * the two stay in step — change one, change the other.
 */
function promptFor(task: MaestroTask): string {
  return `Use /maestro to complete the task described in file ${task.relativePath}`;
}

type Filter = "open" | "closed";
const isOpen = (t: MaestroTask) => t.status !== "done";

const STATUS_META: Record<TaskStatus, { Icon: typeof CircleCheck; cls: string; label: string }> = {
  done: { Icon: CircleCheck, cls: "text-emerald-500", label: "Done" },
  ready: { Icon: CircleDot, cls: "text-sky-500", label: "Ready" },
  blocked: { Icon: CircleDashed, cls: "text-(--ink-3)", label: "Blocked" },
};

function StatusBadge({ status }: { status: TaskStatus }) {
  const { Icon, cls, label } = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${cls}`} title={label}>
      <Icon size={12} /> {label}
    </span>
  );
}

function MaestroTasksPage() {
  const loaderData = Route.useLoaderData();
  const [tasks, setTasks] = useState<MaestroTask[]>(loaderData.tasks);
  const [filter, setFilter] = useState<Filter>("open");
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);
  /**
   * The previewed invocation the confirmation dialog is showing, or null.
   *
   * Non-null means a prompt has been BUILT, not that anything is running: `claude:preview` cannot
   * spawn. The dialog is the only thing that can turn this into a process, and only on Run.
   */
  const [preview, setPreview] = useState<{ preview: ClaudePreview; title: string } | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const openCount = useMemo(() => tasks.filter(isOpen).length, [tasks]);
  const closedCount = tasks.length - openCount;

  const visible = useMemo(() => tasks.filter((t) => (filter === "open" ? isOpen(t) : !isOpen(t))), [tasks, filter]);

  // Keep a valid selection within the current filter; default to the first row.
  const active = visible.find((t) => t.filename === activeFile) ?? visible[0];

  const handleClose = async (task: MaestroTask) => {
    setClosing(true);
    try {
      // closeTask writes status.json — a failure there (permissions, a read-only checkout) has to
      // reach the user rather than vanish into an unhandled rejection.
      const res = await callMain(() => closeMaestroTask({ data: { filename: task.filename } }));
      if (!res.ok) {
        toast(
          <>
            Could not close {task.title}: {res.error}
          </>,
          { variant: "error" }
        );
        return;
      }
      setTasks(res.value);
      setActiveFile(null);
      toast(`Closed ${task.title}`);
    } finally {
      setClosing(false);
    }
  };

  /**
   * Build the invocation and open the confirmation. Nothing is spawned by this — the preview
   * channel has no access to a process — so a user who opens this and changes their mind has run
   * nothing at all.
   */
  const openRun = async (task: MaestroTask) => {
    setPreviewing(true);
    try {
      const res = await callMain(() =>
        window.maestro.claude.preview({ kind: "maestro-task", filename: task.filename })
      );
      if (!res.ok) {
        toast(<>Could not prepare the run: {res.error}</>, { variant: "error" });
        return;
      }
      setPreview({ preview: res.value, title: task.title });
    } finally {
      setPreviewing(false);
    }
  };

  const isEmpty = tasks.length === 0;

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) overflow-hidden flex flex-col">
      <TopNav />

      {isEmpty ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
          <div className="w-12 h-12 rounded-full bg-(--bg-elev) border border-(--line) flex items-center justify-center">
            <ListChecks size={20} className="text-(--ink-3)" />
          </div>
          <div>
            <p className="text-[13px] font-medium text-(--ink) mb-1">No Maestro tasks found</p>
            <p className="text-[12px] text-(--ink-3) max-w-xs">
              Run <span className="font-mono">/to-maestro-tasks</span> to break a plan into task files under{" "}
              <span className="font-mono">.claude/maestro-tasks/</span>.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid overflow-hidden" style={{ gridTemplateColumns: "320px 1fr" }}>
          {/* Left — task list */}
          <aside className="border-r border-(--line) overflow-y-auto p-3 flex flex-col gap-1.5">
            {/* Open / Closed filter */}
            <div className="flex gap-1 p-0.5 mb-1 rounded-lg bg-(--bg-elev) border border-(--line)">
              {(["open", "closed"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`flex-1 rounded-md px-2 py-1 text-[11px] font-medium capitalize cursor-pointer transition-colors ${
                    filter === f ? "bg-(--primary-dim) text-(--ink)" : "text-(--ink-3) hover:text-(--ink)"
                  }`}
                >
                  {f} ({f === "open" ? openCount : closedCount})
                </button>
              ))}
            </div>

            {visible.length === 0 ? (
              <div className="text-[12px] text-(--ink-3) px-1 py-4 text-center">No {filter} tasks.</div>
            ) : (
              visible.map((task) => (
                <button
                  key={task.filename}
                  type="button"
                  onClick={() => setActiveFile(task.filename)}
                  className={`text-left rounded-lg border px-3 py-2 cursor-pointer focus:outline-none transition-colors ${
                    active?.filename === task.filename
                      ? "border-primary bg-(--primary-dim)"
                      : "border-(--line) bg-(--bg-elev) hover:border-primary"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-mono text-[10px] text-(--ink-3) truncate">{task.filename}</div>
                    <StatusBadge status={task.status} />
                  </div>
                  <div className="text-[13px] text-(--ink) leading-snug mt-0.5">{task.title}</div>
                  {task.blockedBy.length > 0 && task.status !== "done" && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {task.blockedBy.map((b) => (
                        <span
                          key={b}
                          title={`Blocked by ${b}`}
                          className="font-mono text-[9px] px-1.5 py-0.5 rounded bg-(--bg-3) text-(--ink-3) border border-(--line)"
                        >
                          ⛔ {b}
                        </span>
                      ))}
                    </div>
                  )}
                </button>
              ))
            )}
          </aside>

          {/* Right — selected task */}
          <main className="overflow-y-auto">
            {active && (
              <div className="max-w-3xl mx-auto px-6 py-6">
                {/* Copy-prompt header */}
                <div className="flex items-center justify-between gap-3 mb-5 pb-4 border-b border-(--line)">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <div className="font-mono text-[11px] text-(--ink-3) truncate">{active.relativePath}</div>
                      <StatusBadge status={active.status} />
                    </div>
                    <h2 className="text-[16px] font-semibold text-(--ink) mt-0.5 truncate">{active.title}</h2>
                  </div>
                  <div className="shrink-0 flex items-center gap-2">
                    {/*
                      Run the task through the bridge instead of pasting the prompt into a terminal.
                      Copy prompt stays beside it and always works — with no CLI installed it is the
                      only thing that does, which is why it is not replaced by this.
                    */}
                    {active.status !== "done" && (
                      <button
                        type="button"
                        data-testid="run-with-claude"
                        onClick={() => void openRun(active)}
                        disabled={previewing || preview !== null}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-(--line) px-3 py-1.5 text-[12px] font-medium text-(--ink-3) transition-colors hover:border-primary hover:text-(--ink) disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <Terminal size={13} /> Run with Claude
                      </button>
                    )}
                    {active.status !== "done" && (
                      <button
                        type="button"
                        onClick={() => handleClose(active)}
                        disabled={closing}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-(--line) px-3 py-1.5 text-[12px] font-medium text-(--ink-3) transition-colors hover:border-(--green) hover:text-(--green) disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                      >
                        <CheckCheck size={13} /> Close task
                      </button>
                    )}
                    <CopyableText
                      text={promptFor(active)}
                      copiedText="Prompt copied!"
                      previewText="Copy prompt for Claude Code"
                      className="inline-flex items-center gap-1.5 rounded-lg border border-primary bg-(--primary-dim) px-3 py-1.5 text-[12px] font-medium text-(--ink) transition-colors hover:brightness-110 data-[copied]:border-(--green) data-[copied]:bg-(--green-dim) data-[copied]:text-(--green)"
                    >
                      {(copied) =>
                        copied ? (
                          <>
                            <Check size={13} /> Copied!
                          </>
                        ) : (
                          <>
                            <Copy size={13} /> Copy prompt
                          </>
                        )
                      }
                    </CopyableText>
                  </div>
                </div>

                <div className="prose prose-neutral max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{active.content}</ReactMarkdown>
                </div>
              </div>
            )}
          </main>
        </div>
      )}

      {preview && <ClaudeRunDialog preview={preview.preview} title={preview.title} onClose={() => setPreview(null)} />}
    </div>
  );
}
