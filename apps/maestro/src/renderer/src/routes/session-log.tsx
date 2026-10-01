import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollText } from "lucide-react";
import { toast } from "@repo/ui/toast";
import TopNav from "../components/top-nav";
import CleanSessionsButton from "../components/clean-sessions-button";
import SessionLogPanes from "../components/session-log-panes";
import WorktreeTabBar from "../components/worktree-tab-bar";
import { useWorktreeLog, worktreeLabel, type WorktreeTab } from "../utils/worktree-log-context";
import { useSessionLog, sessionKey } from "../utils/session-log-context";
import { callMain } from "../utils/call-main";
import type { ProjectState } from "../../../shared/ipc";

export const Route = createFileRoute("/session-log")({
  loader: async () => ({ projectState: await window.maestro.project.get() }),
  component: SessionLogPage,
});

function SessionLogPage() {
  const { projectState: initialProjectState } = Route.useLoaderData();
  const { sessions, connected, dismiss } = useSessionLog();
  const [projectState, setProjectState] = useState<ProjectState>(initialProjectState);

  // Recent/current project list can change (open, forget) while this route stays mounted — keep
  // the tab groups' names and membership current. Session tracking itself doesn't depend on this:
  // a forgotten project's sessions are dropped via the tail's own wholesale `onReset`, not by
  // reacting to this event.
  useEffect(() => window.maestro.project.onChanged(setProjectState), []);

  /**
   * Sessions whose directory `sessions.delete` would accept (idle past the running window). A
   * crashed session never emits `onEnd`, so its tab stays "live" here; this list is what lets it
   * show the x anyway. Re-queried on mount, every 30s, and after each delete.
   */
  const [deletable, setDeletable] = useState<Set<string>>(new Set());
  const refreshDeletable = useCallback(async () => {
    const res = await callMain(() => window.maestro.sessions.deletable());
    // A failed query just keeps the previous list; the ended-status x still works.
    if (res.ok) setDeletable(new Set(res.value.map(sessionKey)));
  }, []);
  useEffect(() => {
    void refreshDeletable();
    const timer = setInterval(() => void refreshDeletable(), 30_000);
    return () => clearInterval(timer);
  }, [refreshDeletable]);

  /**
   * Backend titles (maestro task name, else `claude --resume` title), keyed like `sessionKey`.
   * Re-queried when the session set changes and every 30s, since AI titles appear mid-session. A
   * failed or partial answer leaves tabs on their derived fallback title.
   */
  const [titles, setTitles] = useState<Record<string, string | null>>({});
  const refsKey = useMemo(() => sessions.map(sessionKey).sort().join("\n"), [sessions]);
  const refsRef = useRef<{ projectRoot: string; sessionId: string }[]>([]);
  refsRef.current = sessions.map((s) => ({ projectRoot: s.projectRoot, sessionId: s.sessionId }));
  const refreshTitles = useCallback(async () => {
    if (refsRef.current.length === 0) return;
    const res = await callMain(() => window.maestro.sessions.titles(refsRef.current));
    if (res.ok) setTitles(res.value);
  }, []);
  useEffect(() => {
    void refreshTitles();
  }, [refsKey, refreshTitles]);
  useEffect(() => {
    const timer = setInterval(() => void refreshTitles(), 30_000);
    return () => clearInterval(timer);
  }, [refreshTitles]);

  const handleDelete = async (projectRoot: string, sessionId: string): Promise<void> => {
    // The backend accepts anything idle >15 min, which includes a session parked on a long human
    // review. An ended tab is certainly over; anything else gets a confirm first.
    const record = sessions.find((s) => sessionKey(s) === sessionKey({ projectRoot, sessionId }));
    if (
      record?.status !== "ended" &&
      !window.confirm(
        "Delete this session's directory? It has been idle for a while but may still be waiting for input (for example a human review). Deleting it cannot be undone."
      )
    ) {
      return;
    }
    const res = await callMain(() => window.maestro.sessions.delete(projectRoot, sessionId));
    if (!res.ok) {
      toast(<>Could not delete session: {res.error}</>, { variant: "error" });
    } else if (!res.value.removed) {
      const reason = res.value.reason;
      if (reason === "not-found") {
        dismiss(projectRoot, sessionId); // already gone from disk - just drop the tab
      } else {
        const why = {
          running: "it is still running",
          "own-session": "it is this app's own session",
          invalid: "its id is invalid",
          failed: "the directory could not be removed",
        }[reason];
        toast(`Session not deleted: ${why}`, { variant: "error" });
      }
    }
    // On success main resets the tails and the tab drops via the normal reset/init burst.
    void refreshDeletable();
  };

  const [view, setView] = useState<string>("main");
  const { tabs: worktreeTabs, close: closeWorktree } = useWorktreeLog();
  // A view whose tab vanished (closed) falls back to the main checkout.
  const activeTab = view === "main" ? null : (worktreeTabs.find((t) => t.path === view) ?? null);
  useEffect(() => {
    if (view !== "main" && !activeTab) setView("main");
  }, [view, activeTab]);

  const mainEmpty = (
    <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center px-6">
      <div className="w-12 h-12 rounded-full bg-(--bg-elev) border border-(--line) flex items-center justify-center">
        <ScrollText size={20} className="text-(--ink-3)" />
      </div>
      <div>
        <p className="text-[13px] font-medium text-(--ink) mb-1">No live sessions in any known project</p>
        <p className="text-[12px] text-(--ink-3) max-w-xs">
          A tab appears here while a Maestro session is running, in this project or a recent one.
        </p>
      </div>
      <div className={`flex items-center gap-1.5 text-[11px] ${connected ? "text-(--green)" : "text-(--ink-3)"}`}>
        <span className="text-[8px]">{connected ? "●" : "○"}</span>
        {connected ? "live" : "connecting…"}
      </div>
    </div>
  );

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) overflow-hidden flex flex-col">
      <TopNav />

      <div className="shrink-0 flex items-center justify-end px-3 py-1.5 border-b border-(--line)">
        <CleanSessionsButton />
      </div>

      {worktreeTabs.length > 0 && <WorktreeTabBar tabs={worktreeTabs} active={view} onSelect={setView} />}

      {activeTab ? (
        <WorktreeView
          key={activeTab.path}
          tab={activeTab}
          projectState={projectState}
          connected={connected}
          onClose={closeWorktree}
        />
      ) : (
        <SessionLogPanes
          sessions={sessions}
          projectState={projectState}
          connected={connected}
          deletable={deletable}
          titles={titles}
          onDelete={(root, id) => void handleDelete(root, id)}
          empty={mainEmpty}
          fallbackRoot={projectState.current?.root ?? ""}
        />
      )}
    </div>
  );
}

/** One worktree tab (`075`): its own sessions in the shared panes, or an explicit removed / no-log state. */
function WorktreeView({
  tab,
  projectState,
  connected,
  onClose,
}: {
  tab: WorktreeTab;
  projectState: ProjectState;
  connected: boolean;
  onClose: (path: string) => void;
}) {
  const sessions = useMemo(() => [...tab.sessions.values()], [tab.sessions]);
  const label = worktreeLabel(tab);

  if (tab.state === "removed") {
    return (
      <Notice title={`Worktree ${label} was removed`} testId="worktree-removed">
        <p className="font-mono break-all">{tab.path}</p>
        <p>Its log is no longer shown. Nothing from another run is displayed in its place.</p>
        <button
          type="button"
          onClick={() => onClose(tab.path)}
          className="mt-2 px-3 py-1 rounded-md border border-(--line-2) bg-(--bg-elev) text-(--ink) hover:border-primary cursor-pointer"
        >
          Close tab
        </button>
      </Notice>
    );
  }

  return (
    <SessionLogPanes
      sessions={sessions}
      projectState={projectState}
      connected={connected}
      fallbackRoot={tab.path}
      // Mostly the transient "pending" case: a tab only exists for a worktree that had a log, but
      // "no-log" is still reachable once every session of a tab has been dismissed or evicted.
      empty={
        <Notice
          title={tab.state === "pending" ? `Opening ${label}…` : `No session log in ${label}`}
          testId="worktree-no-log"
        >
          <p className="font-mono break-all">{tab.path}</p>
          {tab.state !== "pending" && <p>No Maestro session has written a log in this worktree yet.</p>}
        </Notice>
      }
    />
  );
}

function Notice({ title, testId, children }: { title: string; testId: string; children: React.ReactNode }) {
  return (
    <div data-testid={testId} className="flex-1 flex flex-col items-center justify-center gap-3 text-center px-6">
      <div className="w-12 h-12 rounded-full bg-(--bg-elev) border border-(--line) flex items-center justify-center">
        <ScrollText size={20} className="text-(--ink-3)" />
      </div>
      <p className="text-[13px] font-medium text-(--ink)">{title}</p>
      <div className="text-[12px] text-(--ink-3) max-w-md flex flex-col items-center gap-1">{children}</div>
    </div>
  );
}
