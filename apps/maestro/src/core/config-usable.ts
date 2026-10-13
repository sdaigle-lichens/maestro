/**
 * The one definition of "this `.claude/maestro.json` can't be installed over" (`096`), shared by the
 * app's `installRuntime()` and the plugin's `maestro-install.js` (via the `maestro-seed` bundle) so
 * the two paths agree on what is unusable and on the wording of the refusal.
 *
 * Pure (text in, verdict out; no fs), so it is bundleable for a script that runs under bare `node`.
 * An install that meets an unusable file must refuse BEFORE writing anything: the file is the user's
 * workflows, instances and skill lists, and neither "treat it as absent" nor "crash" is acceptable.
 */

export type ConfigRefusalKind = "unparseable" | "unsupported-version";

/** Why an existing `maestro.json` was refused. Shown verbatim by the install result card. */
export interface ConfigRefusal {
  kind: ConfigRefusalKind;
  /** Project-relative path of the refused file. */
  file: string;
  /** The problem: the parser's message (it carries the position), or the version found. */
  problem: string;
  /** Complete user-facing sentence: file, problem, and what to do. */
  message: string;
}

export const MAESTRO_CONFIG_FILE = ".claude/maestro.json";

const WHAT_TO_DO =
  "Nothing was installed or changed. Fix the file by hand, or move it aside to start fresh, then install again.";

function describeVersion(v: unknown): string {
  if (v === undefined) return "no version";
  const s = JSON.stringify(v);
  return `version ${s === undefined ? String(v) : s}`;
}

/**
 * Judge the raw text of an EXISTING maestro.json. Returns `null` when it is a usable version-3
 * config object, otherwise the refusal. A missing file is not this function's business: callers
 * only call it when the file exists.
 */
export function maestroConfigRefusal(raw: string): ConfigRefusal | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const problem = err instanceof Error ? err.message : String(err);
    return {
      kind: "unparseable",
      file: MAESTRO_CONFIG_FILE,
      problem,
      message: `${MAESTRO_CONFIG_FILE} is not valid JSON (${problem}). ${WHAT_TO_DO}`,
    };
  }
  const version =
    typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as { version?: unknown }).version
      : undefined;
  if (version === 3) return null;
  const found = describeVersion(version);
  return {
    kind: "unsupported-version",
    file: MAESTRO_CONFIG_FILE,
    problem: `found ${found}, expected version 3`,
    message: `${MAESTRO_CONFIG_FILE} is not a version 3 Maestro config (found ${found}). ${WHAT_TO_DO}`,
  };
}
