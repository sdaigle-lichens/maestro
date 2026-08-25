// Usage stats — the one place in this app where the tool that answers a question may be
// DOWNLOADED FROM THE NETWORK, and the decision about that.
//
// THE DECISION, UPDATED. help-server ran `npx --yes ccusage@latest <view> --json` on every view
// of its Stats tab; several properties of that survived the move to this app, one of them since
// reversed:
//
//  1. THE APP NOW VENDORS `ccusage`. It is a real `dependencies` entry (pinned to the same
//     version `PINNED_CCUSAGE_VERSION` names below), so a user who never opens this tab installs
//     it anyway — the opposite trade from the one this file used to document. That earlier
//     reasoning was "a dependency of the app is one the app ships, and a user who never opens
//     this tab should not carry it"; it is reversed here because the "unavailable"/npx-download
//     banner this tab kept showing on a machine with no local `ccusage` was worse than the bytes
//     saved. `resolveVendoredCcusage()` below finds it via `require.resolve`, the same "ask
//     Node's own resolver, never assume a layout" move `agent-sdk.ts` makes for the CLI binary.
//  2. THE VENDORED COPY IS CHECKED FIRST. `resolveCcusage()` tries it ahead of the project's own
//     `node_modules/.bin`, PATH, and the rest of the fallback directories — which is what makes
//     point 3 true in practice: on a build where vendoring resolved, nothing after it ever runs.
//     A project or a user who wants their OWN version still can: install it anywhere already
//     searched below and it exists there too, this just means "no ccusage anywhere" no longer
//     happens on a build that ships one.
//  3. A REMOTE FETCH IS STILL PINNED, and still a real code path — not deleted by this change.
//     `@latest` would mean the app's behaviour changes without the app changing, so the version
//     is a constant here regardless. With vendoring in place this branch should be unreachable in
//     a normal packaged build; it stays as the safety net for a layout this file hasn't met yet,
//     and removing it is explicitly a follow-up for once that is verified, not a step taken now.
//  4. IT IS SHOWN FIRST, either way. `previewUsageStats` spawns nothing and returns the exact
//     argv plus `network: true/false`; `runUsageStats` accepts only a token that preview issued.
//     So "the user was told a package would be fetched and executed" is a property of the
//     wiring, not of the UI remembering to mention it.
//
// What was NOT done, and why: the fetch was not removed outright. ccusage reads `~/.claude`'s
// own JSONL, and reimplementing that here would be a second parser of someone else's file
// format, drifting silently.
//
// The preview/run split mirrors the `claude -p` bridge and shares its token store, with one
// difference worth knowing: `claude-preview.ts` is provably unable to spawn (its import graph is
// walked by a test), while preview and run live together here. The guarantee that matters is the
// same either way — run takes a token and nothing else — and the token carries a `purpose`, so a
// stats token cannot be handed to `claude:run` and a Claude token cannot be spent here.

import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { claudeChildPath, claudeSearchDirs, type ResolveOptions } from "./claude-cli.js";

const nodeRequire = createRequire(import.meta.url);
import { claimInvocation, issueInvocation } from "./claude-tokens.js";
import type {
  CcusageSource,
  UsageStats,
  UsageStatsPreview,
  UsageStatsResult,
  UsageStatsView,
  UsageTotals,
} from "./contracts.js";

export type { CcusageSource, UsageStats, UsageStatsPreview, UsageStatsResult, UsageStatsView };

/**
 * `ResolveOptions`, widened the way `claude-preview.ts`'s `PreviewOptions` widens it for its own
 * module — plus `skipVendored`, which exists for exactly one caller: `test/core/ccusage.test.ts`'s
 * fallback-chain coverage. The app itself never sets it. Vendoring resolves via `require.resolve`
 * against THIS MODULE's real location on disk, not against a fixture's fake PATH/home, so a test
 * built to exercise "not found" or "npx fallback" behavior would otherwise always observe the real
 * vendored copy regardless of the environment it constructed.
 */
export interface CcusageResolveOptions extends ResolveOptions {
  skipVendored?: boolean;
}

/**
 * The version fetched when no local copy exists. **Pinned deliberately — never `@latest`.**
 *
 * Bumping it is a code change, which is the point: the output shape `reduce()` below reads is an
 * assumption about a specific release, and a floating tag would let that assumption break between
 * two launches of the same build. When you raise this, re-read `reduce()` against the new
 * `--json` output.
 */
export const PINNED_CCUSAGE_VERSION = "20.0.19";

/** How long a run may take before it is abandoned. An npx fetch on a slow link is the long case. */
const RUN_TIMEOUT_MS = 90_000;

/** Plenty for `--json` over a year of usage, and a bound on what a runaway tool can hand back. */
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;

const ZERO: UsageTotals = { inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 };

/** An empty answer — what every view shows before it has been asked, and when ccusage has no rows. */
export function emptyUsageStats(view: UsageStatsView): UsageStats {
  return {
    view,
    entryCount: 0,
    latestLabel: "",
    latest: { ...ZERO },
    total: { ...ZERO },
    activeBlocks: 0,
    recent: null,
    lastUpdated: "",
  };
}

/** Where `ccusage` (and `npx`) were found, and everywhere that was looked. */
export interface CcusageCli {
  source: CcusageSource;
  /** Absolute path of the local `ccusage`, or of `npx` when that is the fallback. */
  bin: string | null;
  searched: string[];
}

function isExecutable(file: string, platform: NodeJS.Platform): boolean {
  try {
    if (!fs.statSync(file).isFile()) return false;
    // The permission bit matters for the same reason it does in claude-cli.ts: a non-executable
    // file reported as available becomes an EACCES at spawn time, which is precisely what
    // resolving up front exists to avoid.
    if (platform !== "win32") fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function names(base: string, platform: NodeJS.Platform): string[] {
  return platform === "win32" ? [`${base}.cmd`, `${base}.exe`, `${base}.bat`, base] : [base];
}

function findIn(dirs: string[], base: string, platform: NodeJS.Platform): string | null {
  for (const dir of dirs) {
    for (const name of names(base, platform)) {
      const candidate = path.join(dir, name);
      if (isExecutable(candidate, platform)) return candidate;
    }
  }
  return null;
}

/**
 * The app's OWN copy of `ccusage` — `"ccusage"` in this package's `dependencies` — resolved with
 * `require.resolve` rather than assumed to sit at some fixed relative path.
 *
 * `require.resolve` is the right tool for the same reason `agent-sdk.ts` hands the Agent SDK a
 * resolved CLI path instead of letting it guess: this module is bundled by electron-vite into
 * `out/main/`, so a path written relative to this FILE's own location would point at the build
 * output rather than any real `node_modules` tree, in exactly the way `bundled-assets.ts`'s
 * top-of-file comment describes for `import.meta.dirname`. `require.resolve` instead asks Node's
 * own module resolution to do the walk, which finds the right `node_modules/ccusage` in dev,
 * `build`, and packaged alike — and `ccusage` is a `dependencies` entry precisely so
 * `electron.vite.config.ts`'s `EXTERNAL` (derived from that manifest) keeps it a real,
 * `require`-able package on disk rather than inlining it into the bundle.
 *
 * Reads `ccusage`'s own `package.json` for its `bin` entry rather than guessing
 * `node_modules/.bin/ccusage`, because the latter is a package-manager-created symlink whose
 * existence and permissions vary by installer; the `bin` field is the one place the package
 * itself says what to run.
 */
function resolveVendoredCcusage(platform: NodeJS.Platform): string | null {
  try {
    const pkgJsonPath = nodeRequire.resolve("ccusage/package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8")) as { bin?: string | Record<string, string> };
    const binField = typeof pkg.bin === "string" ? pkg.bin : pkg.bin?.ccusage;
    if (!binField) return null;
    const bin = path.join(path.dirname(pkgJsonPath), binField);
    return isExecutable(bin, platform) ? bin : null;
  } catch {
    return null;
  }
}

/**
 * Where a usable `ccusage` is, in preference order, or the list of places it isn't.
 *
 * The app's own vendored copy is tried FIRST (see `resolveVendoredCcusage`) — this app ships
 * `ccusage` as a real dependency now, so "not found" and the npx download it used to trigger
 * should not happen on a normal build at all. The rest of the chain is kept, unpruned, as the
 * fallback for whatever that resolution doesn't cover: the project's own `node_modules/.bin`
 * (a repo that pinned its own `ccusage` should still get that one), then the same expanded
 * directory list the `claude` CLI is resolved against — a GUI-launched app's PATH is not the
 * user's PATH, and `~/.local/bin` and the version managers are invisible to it (see
 * `claude-cli.ts`, which explains the failure in full) — and finally `npx`, pinned.
 *
 * NOTHING HERE SPAWNS. Availability is `fs`, so the "not installed" message can be written while
 * the Run button is still un-pressed rather than recovered from an ENOENT.
 */
export function resolveCcusage(projectRoot: string, opts: CcusageResolveOptions = {}): CcusageCli {
  const platform = opts.platform ?? process.platform;
  const searched = [
    ...(projectRoot ? [path.join(projectRoot, "node_modules", ".bin")] : []),
    ...claudeSearchDirs(opts),
  ];

  const vendored = opts.skipVendored ? null : resolveVendoredCcusage(platform);
  if (vendored) return { source: "local", bin: vendored, searched: [vendored, ...searched] };

  const local = findIn(searched, "ccusage", platform);
  if (local) return { source: "local", bin: local, searched };

  const npx = findIn(searched, "npx", platform);
  if (npx) return { source: "npx", bin: npx, searched };

  return { source: "none", bin: null, searched };
}

/** Exactly what would be spawned for a resolution and a view. Pure. */
export function ccusageArgv(cli: CcusageCli, view: UsageStatsView): string[] {
  if (cli.source === "local") return [cli.bin!, view, "--json"];
  if (cli.source === "npx") {
    // `--yes` so the fetch does not stop on npx's interactive "install?" prompt, which a headless
    // child has nobody to answer. `--silent` because npm's own chatter goes to stdout and would
    // land inside the JSON we are about to parse.
    return [cli.bin!, "--silent", "--yes", `ccusage@${PINNED_CCUSAGE_VERSION}`, view, "--json"];
  }
  return [];
}

/** What the UI says when nothing can run — names the tool and how to get it, never "ENOENT". */
export function ccusageNotFoundMessage(cli: CcusageCli): string {
  return (
    "Usage stats need the `ccusage` tool, and neither it nor `npx` was found. Looked in " +
    `${cli.searched.length} directories, including ${cli.searched.slice(0, 3).join(", ")}. ` +
    "Install it with `npm i -g ccusage`, or add it to this project."
  );
}

/**
 * Build the invocation the Stats tab shows, and authorise it. Spawns nothing.
 *
 * `network` is the field this whole channel exists for: true means pressing Run downloads
 * `ccusage@<pinned>` from npm and executes it, and the UI has to say so in those words.
 */
export function previewUsageStats(
  projectRoot: string,
  view: UsageStatsView,
  opts: CcusageResolveOptions = {}
): UsageStatsPreview {
  const cli = resolveCcusage(projectRoot, opts);
  const argv = ccusageArgv(cli, view);
  // ccusage reads `~/.claude`, not the repo, so the cwd only decides where a local install is
  // resolved from. The open project when there is one; the app's own directory otherwise.
  const cwd = projectRoot || process.cwd();

  if (cli.source === "none") {
    return {
      token: null,
      view,
      source: "none",
      argv: [],
      cwd,
      network: false,
      pinnedVersion: PINNED_CCUSAGE_VERSION,
      bin: null,
      searched: cli.searched,
      unavailable: ccusageNotFoundMessage(cli),
      expiresAt: 0,
    };
  }

  const invocation = issueInvocation({
    purpose: "usage-stats",
    bin: argv[0],
    args: argv.slice(1),
    cwd,
    prompt: "",
    // A reader, not an author. The field is on every invocation so no run path can forget to say.
    writable: [],
    // Nor is there a conversation to continue this in: `session:handoff` refuses a token whose
    // invocation names no artifact, so a stats preview cannot open a directory in the pane.
    handoff: null,
  });

  return {
    token: invocation.token,
    view,
    source: cli.source,
    argv,
    cwd,
    network: cli.source === "npx",
    pinnedVersion: PINNED_CCUSAGE_VERSION,
    bin: cli.source === "local" ? cli.bin : null,
    searched: cli.searched,
    unavailable: null,
    expiresAt: invocation.expiresAt,
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

const sum = (rows: UsageTotals[]): UsageTotals =>
  rows.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.inputTokens,
      outputTokens: acc.outputTokens + r.outputTokens,
      totalTokens: acc.totalTokens + r.totalTokens,
      costUsd: acc.costUsd + r.costUsd,
    }),
    { ...ZERO }
  );

interface Row {
  label: string;
  /** ISO date, for `lastUpdated` and for sorting newest-first. */
  sortKey: string;
  active: boolean;
  totals: UsageTotals;
}

/** The array a view's `--json` puts its rows in, and how to read one. */
function rowsFor(view: UsageStatsView, data: Record<string, unknown>): Row[] | null {
  const arrayAt = (key: string): Record<string, unknown>[] | null => {
    const value = data?.[key];
    return Array.isArray(value) ? (value as Record<string, unknown>[]) : null;
  };

  switch (view) {
    // ccusage 20.0.19/20.0.20's actual `--json` shape diverges from what an earlier version of
    // this file assumed, confirmed by running the vendored binary directly against real data:
    // every row's date/id/month lives under a single `period` field (plus, for `session`,
    // `metadata.lastActivity`), not the `date`/`sessionId`/`lastActivity`/`month` fields this
    // reduction used to read. Re-check this switch against `reduceUsage()`'s own doc comment
    // whenever `PINNED_CCUSAGE_VERSION` is bumped.
    case "daily": {
      const raw = arrayAt("daily");
      return (
        raw?.map((d) => ({
          label: String(d.period ?? ""),
          sortKey: String(d.period ?? ""),
          active: false,
          totals: {
            inputTokens: num(d.inputTokens),
            outputTokens: num(d.outputTokens),
            totalTokens: num(d.totalTokens),
            costUsd: num(d.totalCost),
          },
        })) ?? null
      );
    }
    case "session": {
      const raw = arrayAt("session");
      return (
        raw?.map((s) => {
          const metadata = (s.metadata ?? {}) as Record<string, unknown>;
          return {
            label: String(s.period ?? ""),
            sortKey: String(metadata.lastActivity ?? ""),
            active: false,
            totals: {
              inputTokens: num(s.inputTokens),
              outputTokens: num(s.outputTokens),
              totalTokens: num(s.totalTokens),
              costUsd: num(s.totalCost),
            },
          };
        }) ?? null
      );
    }
    case "blocks": {
      const raw = arrayAt("blocks");
      return (
        raw?.map((b) => {
          const counts = (b.tokenCounts ?? {}) as Record<string, unknown>;
          return {
            label: String(b.startTime ?? ""),
            sortKey: String(b.startTime ?? ""),
            active: b.isActive === true,
            totals: {
              inputTokens: num(counts.inputTokens),
              outputTokens: num(counts.outputTokens),
              totalTokens: num(b.totalTokens),
              costUsd: num(b.costUSD),
            },
          };
        }) ?? null
      );
    }
    case "monthly": {
      const raw = arrayAt("monthly");
      return (
        raw?.map((m) => ({
          label: String(m.period ?? ""),
          // A month is `YYYY-MM`; `-01` makes it sort and read as a date like every other view.
          sortKey: m.period ? `${String(m.period)}-01` : "",
          active: false,
          totals: {
            inputTokens: num(m.inputTokens),
            outputTokens: num(m.outputTokens),
            totalTokens: num(m.totalTokens),
            costUsd: num(m.totalCost),
          },
        })) ?? null
      );
    }
  }
}

/**
 * Reduce one view's `--json` payload to the four numbers the tab renders. Pure.
 *
 * Returns null when the payload does not contain the array this view is supposed to have — which
 * is what a ccusage release that changed its output looks like from here. Null becomes a message
 * naming the version that was run, rather than a grid of zeroes the user would read as "I have
 * spent nothing".
 */
export function reduceUsage(view: UsageStatsView, payload: unknown): UsageStats | null {
  if (!payload || typeof payload !== "object") return null;
  const rows = rowsFor(view, payload as Record<string, unknown>);
  if (rows === null) return null;

  const sorted = [...rows].sort((a, b) => b.sortKey.localeCompare(a.sortKey));
  const latest = sorted[0];

  return {
    view,
    entryCount: sorted.length,
    latestLabel: latest?.label ?? "",
    latest: latest ? latest.totals : { ...ZERO },
    total: sum(sorted.map((r) => r.totals)),
    activeBlocks: sorted.filter((r) => r.active).length,
    // Seven days including the newest, which is what "this week" means to someone looking at a
    // usage tab — not the last seven calendar days, which would silently drop days with no usage.
    recent: view === "daily" ? sum(sorted.slice(0, 7).map((r) => r.totals)) : null,
    lastUpdated: latest?.sortKey.slice(0, 10) ?? "",
  };
}

/**
 * `JSON.parse`, tolerating a wrapper line.
 *
 * npx is told to be silent, but a node deprecation warning or a corepack notice still reaches
 * stdout on some setups, and losing a whole view to one stray line would be a bad trade.
 */
function parseJson(stdout: string): unknown {
  try {
    return JSON.parse(stdout);
  } catch {
    const start = stdout.indexOf("{");
    const end = stdout.lastIndexOf("}");
    if (start === -1 || end <= start) return null;
    try {
      return JSON.parse(stdout.slice(start, end + 1));
    } catch {
      return null;
    }
  }
}

/**
 * Run the invocation a token authorises and reduce its output.
 *
 * Takes a token and nothing else — there is no argument by which a caller could make this run
 * something other than what `previewUsageStats` returned and the user was shown. Rejects (with
 * `TokenRefused`) for a forged, replayed, expired or wrong-purpose token; every other failure is a
 * resolved result carrying a message, because "ccusage exited 1" is something the tab reports, not
 * something that should reach the UI as an unhandled rejection.
 */
export async function runUsageStats(token: unknown, view: UsageStatsView): Promise<UsageStatsResult> {
  const inv = claimInvocation(token, "usage-stats");
  const startedAt = Date.now();
  const argv = [inv.bin, ...inv.args];

  const fail = (error: string): UsageStatsResult => ({
    view,
    ok: false,
    stats: null,
    error,
    argv,
    durationMs: Date.now() - startedAt,
  });

  const output = await new Promise<{ stdout: string; error: string | null }>((resolve) => {
    execFile(
      inv.bin,
      inv.args,
      {
        cwd: inv.cwd,
        // npx shells out to node, and a GUI-launched app's PATH may not contain it — the same
        // reason `claude-run.ts` hands its child the expanded list.
        env: { ...process.env, PATH: claudeChildPath() },
        timeout: RUN_TIMEOUT_MS,
        maxBuffer: MAX_OUTPUT_BYTES,
      },
      (err, stdout, stderr) => {
        if (!err) return resolve({ stdout, error: null });
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return resolve({ stdout, error: `Could not run ${inv.bin} — it was there when this was previewed.` });
        }
        const detail = (stderr || err.message).trim().split("\n").slice(-3).join(" ").slice(0, 400);
        resolve({ stdout, error: detail || "ccusage exited without saying why." });
      }
    );
  });

  if (output.error) return fail(output.error);

  const stats = reduceUsage(view, parseJson(output.stdout));
  if (!stats) {
    return fail(
      `ccusage ran, but its \`${view} --json\` output was not in the shape this app reads. ` +
        `Expected the ${view} array from ccusage ${PINNED_CCUSAGE_VERSION}.`
    );
  }

  return { view, ok: true, stats, error: null, argv, durationMs: Date.now() - startedAt };
}
