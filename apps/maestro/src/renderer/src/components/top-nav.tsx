import { Link } from "@tanstack/react-router";
import ThemeToggle from "@repo/ui/theme-toggle";
import {
  BookBookmarkIcon,
  BookOpenIcon,
  CaretDownIcon,
  ChatsCircleIcon,
  CheckIcon,
  FlowArrowIcon,
  FolderOpenIcon,
  ListChecksIcon,
  PencilSimpleIcon,
  PlusIcon,
  ScrollIcon,
  SparkleIcon,
  TagIcon,
  TrashIcon,
  UsersIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useState, useRef, useEffect } from "react";
import { useSession } from "../utils/session-context";
import { useSessionLog } from "../utils/session-log-context";
import { useProject } from "../utils/project-context";
import { installBadge, useInstall } from "../utils/install-context";
import HamburgerMenu from "./hamburger-menu";

/**
 * THE BAR IS GROUPED, NOT APPENDED TO.
 *
 * The hamburger menu (leftmost) separates APP-WIDE concerns — the global Docs page, the /tools
 * dashboard, and project switching — from what stays as direct top-nav links: things that need
 * the CURRENT project open and that a user came here to DO. Maestro used to live in the
 * hamburger too, back when it carried a `ProjectSelect` of its own and could be viewed without
 * one being open; now that it's the project's own landing page (opening a project from `/` goes
 * straight here), it belongs beside Workflows/Rules/etc, not among the project-agnostic items.
 * The runtime staleness badge still rides on the hamburger button itself, because that badge is
 * the one item here nobody goes looking for, so it has to be visible from whatever route the
 * user is on.
 *
 * The old top-of-file `Library`/`Create` dropdowns are gone: Library's three destinations moved
 * into the hamburger menu, and Create's four routes are reached instead from buttons at the
 * bottom of the Marketplace/Plugins/Agents/Skills tabs on /tools.
 */
export const NAV_LINK =
  "flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[13px] text-maestro-muted hover:text-maestro";
export const MENU_ITEM =
  "flex items-center gap-2 px-3 py-1.5 text-[13px] text-maestro-muted hover:bg-maestro-elevated hover:text-maestro";

/** Close on an outside click — shared by the workflow selector and the hamburger/project menus. */
export function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as globalThis.Node)) close();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open, close]);
  return ref;
}

interface WorkflowSelectorProps {
  workflows: string[];
  activeIndex: number;
  onSelect: (i: number) => void;
  onAdd: () => void;
  onRemove: (i: number) => void;
  onRename: (i: number, name: string) => void;
}

export default function TopNav({ workflowSelector }: { workflowSelector?: WorkflowSelectorProps }) {
  const { connected } = useSessionLog();
  const badge = installBadge(useInstall().status);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  // Not local state: the session outlives this component, which remounts on every navigation.
  const session = useSession();
  const { current, pick } = useProject();

  // Reset editing + close menu when active workflow changes
  useEffect(() => {
    setEditing(false);
    setMenuOpen(false);
  }, [workflowSelector?.activeIndex]);

  // Close the dropdown on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  // Dismiss the delete-confirmation modal on Escape
  useEffect(() => {
    if (pendingDelete === null) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPendingDelete(null);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [pendingDelete]);

  const confirmDelete = () => {
    if (pendingDelete === null || !workflowSelector) return;
    workflowSelector.onRemove(pendingDelete);
    setPendingDelete(null);
  };

  const startEdit = () => {
    if (!workflowSelector) return;
    setEditValue(workflowSelector.workflows[workflowSelector.activeIndex] ?? "");
    setEditing(true);
    setTimeout(() => editInputRef.current?.select(), 0);
  };

  const confirmEdit = () => {
    if (!workflowSelector) return;
    workflowSelector.onRename(
      workflowSelector.activeIndex,
      editValue.trim() || `Workflow ${workflowSelector.activeIndex + 1}`
    );
    setEditing(false);
  };

  const cancelEdit = () => setEditing(false);

  return (
    <nav className="h-11 border-b border-maestro bg-maestro flex items-center px-4 gap-1 shrink-0">
      <HamburgerMenu badge={badge} />

      {/* Where the hamburger's app-wide items end and "what I'm editing in this project" begins. */}
      <span className="w-px h-4 bg-maestro-border mx-1.5 shrink-0" aria-hidden />

      <Link to="/maestro" activeProps={{ className: "text-maestro bg-maestro-elevated" }} className={NAV_LINK}>
        <SparkleIcon size={13} /> Maestro
      </Link>
      <Link to="/skills" activeProps={{ className: "text-maestro bg-maestro-elevated" }} className={NAV_LINK}>
        <TagIcon size={13} /> Skills
      </Link>
      <Link to="/agents" activeProps={{ className: "text-maestro bg-maestro-elevated" }} className={NAV_LINK}>
        <UsersIcon size={13} /> Agents
      </Link>
      <Link to="/project-docs" activeProps={{ className: "text-maestro bg-maestro-elevated" }} className={NAV_LINK}>
        <BookOpenIcon size={13} /> Project Docs
      </Link>
      <Link to="/workflows" activeProps={{ className: "text-maestro bg-maestro-elevated" }} className={NAV_LINK}>
        <FlowArrowIcon size={13} /> Workflows
      </Link>
      <Link to="/rules" activeProps={{ className: "text-maestro bg-maestro-elevated" }} className={NAV_LINK}>
        <BookBookmarkIcon size={13} /> Rules
      </Link>
      <Link to="/session-log" activeProps={{ className: "text-maestro bg-maestro-elevated" }} className={NAV_LINK}>
        <ScrollIcon size={13} /> Session Log
        <span
          title={connected ? "Live" : "Connecting…"}
          className={`text-[7px] leading-none ${connected ? "text-maestro-success" : "text-maestro-muted"}`}
        >
          ●
        </span>
      </Link>
      <Link to="/maestro-tasks" activeProps={{ className: "text-maestro bg-maestro-elevated" }} className={NAV_LINK}>
        <ListChecksIcon size={13} /> Maestro Tasks
      </Link>

      {/* Centered workflow selector */}
      <div className="flex-1 flex items-center justify-center">
        {workflowSelector && (
          <div className="flex items-center gap-1">
            {editing ? (
              <>
                <input
                  ref={editInputRef}
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") confirmEdit();
                    if (e.key === "Escape") cancelEdit();
                  }}
                  className="h-7 px-2.5 rounded-md text-[13px] bg-maestro-elevated border border-maestro-primary-strong text-maestro focus:outline-none w-44"
                />
                <button
                  type="button"
                  onClick={confirmEdit}
                  title="Confirm"
                  className="w-7 h-7 rounded-md flex items-center justify-center bg-maestro-elevated border border-maestro text-maestro-primary hover:bg-maestro-primary-subtle cursor-pointer focus:outline-none"
                >
                  <CheckIcon size={13} />
                </button>
                <button
                  type="button"
                  onClick={cancelEdit}
                  title="Cancel"
                  className="w-7 h-7 rounded-md flex items-center justify-center bg-maestro-elevated border border-maestro text-maestro-muted hover:text-maestro cursor-pointer focus:outline-none"
                >
                  <XIcon size={13} />
                </button>
              </>
            ) : (
              <>
                <div className="relative" ref={menuRef}>
                  <button
                    type="button"
                    onClick={() => setMenuOpen((v) => !v)}
                    title="Switch workflow"
                    className="h-7 pl-2.5 pr-2 min-w-[20em] rounded-md text-[13px] bg-maestro-elevated border border-maestro text-maestro cursor-pointer focus:outline-none hover:border-maestro-primary-strong flex items-center justify-between gap-2"
                  >
                    <span className="truncate">
                      {workflowSelector.workflows.length === 0
                        ? "No workflows"
                        : workflowSelector.workflows[workflowSelector.activeIndex] ||
                          `Workflow ${workflowSelector.activeIndex + 1}`}
                    </span>
                    <CaretDownIcon size={13} className="text-maestro-muted shrink-0" />
                  </button>

                  {menuOpen && (
                    <div className="absolute left-0 top-9 z-50 w-full bg-maestro border border-maestro rounded-lg shadow-lg py-1">
                      <div className="max-h-72 overflow-y-auto">
                        {workflowSelector.workflows.length === 0 && (
                          <div className="px-3 py-1.5 text-[12px] text-maestro-muted">No workflows yet</div>
                        )}
                        {workflowSelector.workflows.map((name, i) => (
                          <div
                            key={i}
                            onClick={() => {
                              workflowSelector.onSelect(i);
                              setMenuOpen(false);
                            }}
                            className={`group flex items-center justify-between gap-2 pl-3 pr-1.5 py-1.5 cursor-pointer hover:bg-maestro-elevated ${
                              i === workflowSelector.activeIndex ? "text-maestro" : "text-maestro-muted"
                            }`}
                          >
                            <span className="flex items-center gap-1.5 truncate text-[13px]">
                              {i === workflowSelector.activeIndex && (
                                <CheckIcon size={12} className="text-maestro-primary shrink-0" />
                              )}
                              <span className="truncate">{name || `Workflow ${i + 1}`}</span>
                            </span>
                            <button
                              type="button"
                              title="Delete workflow"
                              onClick={(e) => {
                                e.stopPropagation();
                                setMenuOpen(false);
                                setPendingDelete(i);
                              }}
                              className="w-6 h-6 rounded flex items-center justify-center text-maestro-muted hover:text-red-500 opacity-0 group-hover:opacity-100 cursor-pointer focus:outline-none shrink-0"
                            >
                              <TrashIcon size={12} />
                            </button>
                          </div>
                        ))}
                      </div>
                      <div className="border-t border-maestro mt-1 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            workflowSelector.onAdd();
                            setMenuOpen(false);
                          }}
                          className="w-full flex items-center gap-1.5 px-3 py-1.5 text-[13px] text-maestro-muted hover:bg-maestro-elevated hover:text-maestro cursor-pointer focus:outline-none"
                        >
                          <PlusIcon size={13} /> Add workflow
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                {workflowSelector.workflows.length > 0 && (
                  <button
                    type="button"
                    onClick={startEdit}
                    title="Rename workflow"
                    className="w-7 h-7 rounded-md flex items-center justify-center bg-maestro-elevated border border-maestro text-maestro-muted hover:text-maestro cursor-pointer focus:outline-none"
                  >
                    <PencilSimpleIcon size={12} />
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <ThemeToggle />

      {/*
        Where the web app's Stop button lived. That existed to tell the /ai-tools dispatcher to
        stop listening and tear the container down; a desktop app has neither, so the slot now
        shows which project is open and switches it.
      */}
      {/*
        The session toggle. The pane itself is rendered by `__root.tsx`, NOT here: it is a column
        beside the whole app rather than an overlay on one route, and this bar remounts on every
        navigation while the conversation must not. The dot marks a turn still running behind a
        closed pane, which is otherwise invisible.
      */}
      <button
        type="button"
        data-session-toggle
        onClick={() => session.setOpen(!session.open)}
        title={
          session.waiting > 0
            ? "Session — something is waiting on your answer"
            : session.busy
              ? "Session — a turn is in progress"
              : "Session"
        }
        className="relative flex items-center justify-center w-7 h-7 rounded-md border bg-maestro-elevated border-maestro text-maestro-muted hover:text-maestro cursor-pointer focus:outline-none"
      >
        <ChatsCircleIcon size={13} />
        {/*
          A parked ask outranks a running turn on this badge, and is a different colour, because they
          mean opposite things: one is Claude working and the other is Claude waiting on the user.
          EITHER KIND of ask counts — a permission request and a structured question are answered in
          different cards and are the same thing from here. The pane opens itself when one arrives,
          so this is the backstop for a pane the user then closed: the tool call is still parked, and
          nothing below it times out.
        */}
        {session.waiting > 0 ? (
          <span
            data-testid="session-toggle-pending"
            className="absolute -top-0.5 -right-0.5 text-[7px] leading-none text-amber-500"
          >
            ●
          </span>
        ) : (
          session.busy && (
            <span className="absolute -top-0.5 -right-0.5 text-[7px] leading-none text-maestro-success">●</span>
          )
        )}
      </button>

      <button
        type="button"
        onClick={() => void pick()}
        title={current ? `Open project: ${current.root}` : "Choose a project folder"}
        className="flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] border bg-maestro-elevated border-maestro text-maestro-muted hover:text-maestro cursor-pointer focus:outline-none max-w-[220px]"
      >
        <FolderOpenIcon size={13} className="shrink-0" />
        <span className="truncate">{current?.name ?? "Open project…"}</span>
      </button>

      {/* Delete-confirmation modal */}
      {pendingDelete !== null && workflowSelector && (
        <div
          className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="bg-maestro border border-maestro rounded-xl p-5 shadow-xl w-80 flex flex-col gap-3"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-[13px] font-semibold text-maestro">Delete workflow</div>
            <p className="text-[12px] text-maestro-muted m-0">
              Delete{" "}
              <span className="font-mono text-maestro">
                {workflowSelector.workflows[pendingDelete] || `Workflow ${pendingDelete + 1}`}
              </span>
              ? This can&apos;t be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setPendingDelete(null)}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-maestro-elevated border border-maestro text-maestro-muted hover:text-maestro cursor-pointer focus:outline-none"
              >
                Cancel
              </button>
              <button
                type="button"
                autoFocus
                onClick={confirmDelete}
                className="px-3 py-1.5 text-[12px] rounded-lg bg-red-500 text-white cursor-pointer focus:outline-none hover:bg-red-600"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
