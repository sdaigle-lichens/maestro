import { useEffect } from "react";
import { useRouter } from "@tanstack/react-router";

/**
 * Re-reads every loader-based route when `.claude/maestro.json` changes on disk — a hand edit,
 * `/maestro-update`, or another window's save.
 *
 * Main owns the one watcher and broadcasts to every window, so there is nothing to subscribe per
 * project here; mounting once at the root is enough. The event also fires for this window's own
 * saves (the watcher cannot tell writers apart), which is harmless: the extra invalidation is a
 * re-read, and `/workflows` recognises its own save by comparing against its baseline.
 */
export function ConfigWatchProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  useEffect(() => {
    return window.maestro.config.onChanged(() => {
      void router.invalidate();
    });
  }, [router]);

  return <>{children}</>;
}
