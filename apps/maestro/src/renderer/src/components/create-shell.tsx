import { useEffect, type ReactNode } from "react";
import ThemeToggle from "@repo/ui/theme-toggle";
import ShortcutsDialog from "@repo/ui/shortcuts-dialog";
import Button from "@repo/ui/button";
import { Keyboard, Sparkles } from "lucide-react";
import TopNav from "./top-nav";
import { useSession } from "../utils/session-context";

/**
 * The chrome the four create-* routes share: navigation, a header with the mode pills, the
 * form/preview split, the shortcut map, and the submit row.
 *
 * It exists because the four routes came across from the web app as four near-identical files —
 * the same 60 lines of layout and the same keyboard handler, copied. That was survivable when
 * each was a page in a container that got thrown away; here they are permanent, and the shared
 * half is exactly the half that has to keep behaving identically (⌘↵ submits on all four, or it
 * submits on none of them predictably). What is genuinely per-route — the schema, the fields, the
 * preview — is what the routes still own.
 */
export interface ShortcutSection {
  title: string;
  items: [string, string][];
}

/**
 * Focus field `n` and flash its row.
 *
 * Exported because the routes call it from react-hook-form's `onError` to jump to the first bad
 * field — validation lives with the schema, and the schema lives in the route.
 */
export function jumpToField(fieldIds: string[], rowIds: string[], n: number): void {
  document.getElementById(fieldIds[n - 1])?.focus();
  const row = document.getElementById(rowIds[n - 1]);
  if (!row) return;
  row.style.boxShadow = "0 0 0 4px var(--primary-glow)";
  setTimeout(() => {
    row.style.boxShadow = "none";
  }, 600);
}

export default function CreateShell({
  title,
  subtitle,
  pills,
  fieldIds,
  rowIds,
  shortcuts,
  helpOpen,
  onHelpOpenChange,
  onSubmit,
  onToggleMode,
  submitLabel,
  busy,
  banner,
  preview,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  /** Mode / target toggles, rendered beside the heading. */
  pills?: ReactNode;
  fieldIds: string[];
  rowIds: string[];
  shortcuts: ShortcutSection[];
  helpOpen: boolean;
  onHelpOpenChange: (open: boolean) => void;
  onSubmit: () => void;
  /** ⌘M. Absent on the routes with no auto/manual choice, where the key does nothing. */
  onToggleMode?: () => void;
  submitLabel: string;
  busy: boolean;
  /** What the last submit produced, above the form. */
  banner?: ReactNode;
  preview: ReactNode;
  children: ReactNode;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inField = ["INPUT", "TEXTAREA"].includes((document.activeElement as HTMLElement)?.tagName ?? "");
      const n = Number(e.key);
      if ((e.metaKey || e.ctrlKey) && n >= 1 && n <= fieldIds.length) {
        e.preventDefault();
        jumpToField(fieldIds, rowIds, n);
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "m" && onToggleMode) {
        e.preventDefault();
        onToggleMode();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        onSubmit();
      } else if (e.key === "?" && !inField) {
        e.preventDefault();
        onHelpOpenChange(true);
      } else if (e.key === "Escape") {
        onHelpOpenChange(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fieldIds, rowIds, onSubmit, onToggleMode, onHelpOpenChange]);

  // THE PANE TAKES THIS COLUMN. The preview exists to show the file that WILL be generated; once a
  // conversation is open the artifact is already on disk and the conversation is the more useful
  // thing to have beside the form. Two 460px columns would also leave the form unusably narrow on
  // this app's 960px minimum, so the choice is not decoration.
  const { open: sessionOpen } = useSession();

  return (
    <div className="w-full h-screen bg-(--bg) font-sans text-(--ink) overflow-hidden flex flex-col">
      <TopNav />
      <div
        className="flex-1 grid overflow-hidden"
        style={{ gridTemplateColumns: sessionOpen ? "minmax(0, 1fr)" : "minmax(0, 1fr) 460px" }}
      >
        {/* Left — the form */}
        <div className="overflow-y-auto px-10 py-8">
          <div className="max-w-155 mx-auto">
            <div className="flex items-center gap-3 mb-1.5 flex-wrap">
              <h1 className="m-0 text-2xl font-bold text-(--ink) tracking-[-0.5px]">{title}</h1>
              {pills}
              <div className="flex-1" />
              <ThemeToggle />
              <button
                type="button"
                onClick={() => onHelpOpenChange(true)}
                title="Keyboard shortcuts (?)"
                className="w-7.5 h-7.5 rounded-lg bg-(--bg-elev) border border-(--line) flex items-center justify-center text-subtle text-[13px] font-bold cursor-pointer focus:outline-none focus:shadow-none"
              >
                ?
              </button>
            </div>
            <p className="m-0 mb-4.5 text-[13px] text-subtle">{subtitle}</p>

            {banner}

            {children}

            <div className="mt-6 pt-4 border-t border-(--line) flex items-center gap-3">
              <div className="flex-1" />
              <Button
                variant="primary"
                icon={busy ? undefined : <Sparkles size={14} />}
                loading={busy}
                onClick={onSubmit}
              >
                {busy ? "Creating…" : submitLabel}
              </Button>
            </div>
          </div>
        </div>

        {/* Right — the file that will be written, as it will be written. Yielded to the session
            pane while one is open; see the note above the grid. */}
        {!sessionOpen && <div className="border-l border-(--line) overflow-y-auto flex flex-col">{preview}</div>}
      </div>

      <ShortcutsDialog
        open={helpOpen}
        onOpenChange={onHelpOpenChange}
        titleIcon={<Keyboard size={15} />}
        sections={shortcuts}
      />
    </div>
  );
}
