// Is a project's stamped runtime older, the same as, or newer than a plugin version? (`087`)
//
// The ONE answer to that question, shared by the two places that ask it: the Step 0 readiness
// check (`plugins/maestro/scripts/maestro-check-runtime.cjs`, through the maestro-session bundle)
// against the marketplace's installed plugin, and the desktop app's `refreshStaleRuntime()`
// against the plugin it ships. Both used plain inequality, which reads a project NEWER than the
// plugin as "behind" and tells the user to run the refresh that would copy the older runtime over
// the newer one. That happens in this repository whenever the project is ahead of the installed
// plugin cache. Pure: no fs, no path.

export type RuntimeVersionVerdict =
  /** The project's runtime is older than the plugin: refresh it. */
  | "older"
  /** Same version. */
  | "equal"
  /** The project's runtime is newer than the plugin: the PLUGIN is behind; never refresh down. */
  | "newer"
  /** Unstamped or unparseable on either side: callers keep the pre-`087` inequality behaviour. */
  | "unknown";

interface Parsed {
  core: [number, number, number];
  pre: string | null;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parse(v: unknown): Parsed | null {
  if (typeof v !== "string") return null;
  const m = VERSION_RE.exec(v.trim());
  if (!m) return null;
  return { core: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] ?? null };
}

function comparePre(a: string | null, b: string | null): number {
  // A release outranks its own pre-releases (1.0.0-rc.1 < 1.0.0).
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  const as = a.split(".");
  const bs = b.split(".");
  for (let i = 0; i < Math.max(as.length, bs.length); i++) {
    if (as[i] === undefined) return -1;
    if (bs[i] === undefined) return 1;
    const an = /^\d+$/.test(as[i]) ? Number(as[i]) : null;
    const bn = /^\d+$/.test(bs[i]) ? Number(bs[i]) : null;
    if (an !== null && bn !== null) {
      if (an !== bn) return an < bn ? -1 : 1;
    } else if (an !== null) return -1;
    else if (bn !== null) return 1;
    else if (as[i] !== bs[i]) return as[i] < bs[i] ? -1 : 1;
  }
  return 0;
}

/**
 * Where the project's stamped `runtimeVersion` stands against `pluginVersion`, semantically
 * (`0.10.6` is newer than `0.10.5`, `0.10.10` newer than `0.10.9`). `unknown` when either side is
 * missing or not a `MAJOR.MINOR.PATCH[-pre][+build]` version.
 */
export function compareRuntimeVersions(projectVersion: unknown, pluginVersion: unknown): RuntimeVersionVerdict {
  const p = parse(projectVersion);
  const q = parse(pluginVersion);
  if (!p || !q) return "unknown";
  for (let i = 0; i < 3; i++) {
    if (p.core[i] !== q.core[i]) return p.core[i] < q.core[i] ? "older" : "newer";
  }
  const pre = comparePre(p.pre, q.pre);
  return pre === 0 ? "equal" : pre < 0 ? "older" : "newer";
}

/**
 * Should a refresh to `pluginVersion` run for a project stamped `projectVersion`? Yes when it is
 * older; never when it is equal or newer; and for `unknown` the pre-`087` rule (any difference),
 * so an unstamped project is still refreshed exactly as before.
 */
export function runtimeNeedsRefresh(projectVersion: unknown, pluginVersion: unknown): boolean {
  const verdict = compareRuntimeVersions(projectVersion, pluginVersion);
  if (verdict === "unknown") return projectVersion !== pluginVersion;
  return verdict === "older";
}
