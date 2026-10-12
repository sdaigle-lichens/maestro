import { useState } from "react";
import { BroomIcon } from "@phosphor-icons/react";
import { toast } from "@repo/ui/toast";
import { callMain } from "../utils/call-main";

/**
 * Runs the same stale-session sweep the app runs at startup. `0` removed is the normal result
 * (nothing was stale), so it reads as success; only a rejected IPC call is an error. Used by the
 * Session Log screen: `iconOnly` at the end of the tab strip, stretched to a tab's height, and
 * with its label in the empty state, where there is no strip.
 */
export default function CleanSessionsButton({ iconOnly = false }: { iconOnly?: boolean }) {
  const [cleaning, setCleaning] = useState(false);

  const run = async () => {
    setCleaning(true);
    try {
      const res = await callMain(() => window.maestro.sessions.clean());
      if (!res.ok) {
        toast(<>Could not clean up sessions: {res.error}</>, { variant: "error" });
        return;
      }
      const n = res.value;
      toast(n === 0 ? "Nothing to clean up" : `Removed ${n} stale session ${n === 1 ? "directory" : "directories"}`);
    } finally {
      setCleaning(false);
    }
  };

  return (
    <button
      type="button"
      data-testid="clean-sessions"
      onClick={() => void run()}
      disabled={cleaning}
      aria-label={iconOnly ? (cleaning ? "Cleaning..." : "Clean up sessions") : undefined}
      title="Remove session directories of Claude sessions that ended without cleaning up (idle over 24h)"
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-maestro-strong px-3 text-[11px] font-medium text-maestro-muted transition-colors hover:border-maestro-primary-strong hover:text-maestro disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${iconOnly ? "" : "py-1"}`}
    >
      <BroomIcon size={12} />
      {!iconOnly && (cleaning ? "Cleaning..." : "Clean up sessions")}
    </button>
  );
}
