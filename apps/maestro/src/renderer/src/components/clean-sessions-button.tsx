import { useState } from "react";
import { Brush } from "lucide-react";
import { toast } from "@repo/ui/toast";
import { callMain } from "../utils/call-main";

/**
 * Runs the same stale-session sweep the app runs at startup. `0` removed is the normal result
 * (nothing was stale), so it reads as success; only a rejected IPC call is an error. Used by the
 * Session Log screen.
 */
export default function CleanSessionsButton() {
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
      title="Remove session directories of Claude sessions that ended without cleaning up (idle over 24h)"
      className="inline-flex items-center gap-1.5 rounded-lg border border-(--line-2) px-3 py-1 text-[11px] font-medium text-(--ink-2) transition-colors hover:border-primary hover:text-(--ink) disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
    >
      <Brush size={12} /> {cleaning ? "Cleaning..." : "Clean up sessions"}
    </button>
  );
}
