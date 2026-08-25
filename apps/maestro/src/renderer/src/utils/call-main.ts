// Turning a rejected IPC call into something the UI can show.
//
// `ipcMain.handle` handlers throw — `config:save` throws "No project is open." when no project is
// open, and every route is reachable in that state. A bare `await window.maestro.…` on a rejected
// channel produces an unhandled promise rejection in the console: the toast never fires, and any
// `setPhase("idle")` after the await never runs, so the save button spins forever. Routing every
// fallible call through `callMain` makes the failure a value the caller has to look at.
//
// This lives in the renderer, not the preload, on purpose: the preload's `ipcRenderer.invoke`
// calls are enumerated one channel per line, and test/isolation.test.ts asserts exactly that. A
// generic wrapper there would read like the escape hatch that test exists to forbid.

/** Electron's wrapper around a handler rejection. The message we want is everything after it. */
const REMOTE_PREFIX = /^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/;

/**
 * The message the main process actually threw, with Electron's IPC framing stripped.
 *
 * Raw, it reads `Error invoking remote method 'config:save': Error: No project is open.` — the
 * channel name is noise to a user, and the doubled "Error:" is noise to everyone.
 */
export function mainErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  const stripped = raw.replace(REMOTE_PREFIX, "").trim();
  return stripped || "The operation failed.";
}

export type CallResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Await a main-process call without letting it reject. Returns a discriminated result so the
 * caller cannot forget the failure branch the way a bare `await` lets it.
 */
export async function callMain<T>(op: () => Promise<T>): Promise<CallResult<T>> {
  try {
    return { ok: true, value: await op() };
  } catch (err) {
    return { ok: false, error: mainErrorMessage(err) };
  }
}
