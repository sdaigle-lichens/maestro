// Noticing edits to <project>/.claude/maestro.json made outside the app (a hand edit,
// /maestro-update, another tool).
//
// Polls and fingerprints the RAW file text rather than using fs.watch, same reasoning as
// `tailTasks`/`tailSessionLog`: the file is created, rewritten and deleted by several writers, and
// fs.watch's create/replace/delete lifecycle is unreliable across them. Comparing text (not parsed
// JSON) means a whitespace-only edit also fires; deciding whether it matters is the consumer's job.

import fs from "node:fs";
import { maestroJsonPath } from "./config.js";

/**
 * Call `onChange` whenever the project's maestro.json text differs from the previous poll.
 *
 * Silent on the first read. A missing or unreadable file reads as the empty string, so creating
 * and deleting the file both fire. Never throws — a failing `onChange` is swallowed so one bad
 * listener cannot kill the poller. Returns an unsubscribe.
 */
export function watchConfigFile(projectRoot: string, onChange: () => void, intervalMs = 1000): () => void {
  const file = maestroJsonPath(projectRoot);
  const read = (): string => {
    try {
      return fs.readFileSync(file, "utf8");
    } catch {
      return "";
    }
  };

  let last = read();
  let stopped = false;
  const timer = setInterval(() => {
    if (stopped) return;
    const next = read();
    if (next === last) return;
    last = next;
    try {
      onChange();
    } catch {
      // see above
    }
  }, intervalMs);
  // Never keep the process alive just for this poller.
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
