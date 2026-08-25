import { createContext, useContext, useEffect, useState } from "react";
import type { SessionLogEntry } from "./maestro-session-log";

interface SessionLogContextValue {
  entries: SessionLogEntry[];
  connected: boolean;
}

const SessionLogContext = createContext<SessionLogContextValue>({
  entries: [],
  connected: false,
});

/**
 * One app-wide subscription to the open project's maestro_session.log.jsonl.
 *
 * The web app opened an EventSource against an SSE route that polled the file server-side. Here
 * the main process owns the tail and pushes over IPC — same three events (init / entry / reset),
 * same read-only contract against a file the Claude Code hooks append to. `connected` means the
 * main process is tailing, which it is for as long as this component is mounted.
 */
export function SessionLogProvider({ children }: { children: React.ReactNode }) {
  const [entries, setEntries] = useState<SessionLogEntry[]>([]);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const unsubscribe = window.maestro.log.subscribe({
      onInit: (next) => {
        setEntries(next);
        setConnected(true);
      },
      onEntry: (entry) => setEntries((prev) => [...prev, entry]),
      onReset: () => setEntries([]),
    });

    // A project switch is handled in the main process — it retargets the tail and re-emits
    // `init` — so there is nothing to re-subscribe to here.
    return () => {
      unsubscribe();
      setConnected(false);
    };
  }, []);

  return <SessionLogContext.Provider value={{ entries, connected }}>{children}</SessionLogContext.Provider>;
}

export function useSessionLog(): SessionLogContextValue {
  return useContext(SessionLogContext);
}
