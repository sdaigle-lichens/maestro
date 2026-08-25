// The Usage Stats tab — ported from apps/help-server/src/components/tabs/StatsTab.tsx, with the
// one thing about it that could not survive the move changed.
//
// help-server fetched on mount and on every view switch, running `npx --yes ccusage@latest` each
// time: a package downloaded from the network and executed on the user's machine, unannounced,
// floating on whatever was published that day. Here nothing runs until the user presses a button,
// and the button is next to a line saying exactly what it will do — the local binary if there is
// one, otherwise a PINNED version fetched from npm, with the argv on screen either way.
//
// So this tab opens showing what it would run rather than the answer. That is one extra click, and
// it is the whole point: "npx will download and execute a package" is not a thing to discover from
// a network graph afterwards.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Cloud, HardDrive, Loader2, Play, RotateCw } from "lucide-react";
import { callMain } from "../../utils/call-main";
import { previewUsageStats, runUsageStats } from "../../utils/stats";
import type { UsageStats, UsageStatsPreview, UsageStatsView, UsageTotals } from "../../utils/stats";

const VIEWS: { id: UsageStatsView; label: string }[] = [
  { id: "session", label: "Session" },
  { id: "blocks", label: "Blocks" },
  { id: "daily", label: "Daily" },
  { id: "monthly", label: "Monthly" },
];

const VIEW_NOUN: Record<UsageStatsView, string> = {
  session: "sessions",
  blocks: "blocks",
  daily: "days",
  monthly: "months",
};

const tokens = (n: number) => n.toLocaleString("en-US");
const usd = (n: number) => `$${n.toFixed(2)}`;

/**
 * The last run result per view, held at module scope rather than in `UsageStatsTab`'s own state.
 *
 * The component unmounts entirely on every tab switch within `/tools` (it's a conditional render,
 * not a hidden one) and again on any navigation away from `/tools` and back — so state that lived
 * only in `useState` was gone the moment either happened, and the fix for "come back and it's
 * gone" has to live somewhere that outlives the component. `ccusage` reads machine-wide
 * `~/.claude` data, not anything scoped to the open project, so a cache with no project key is
 * correct rather than a shortcut. It does NOT survive a reload/restart — there is no channel this
 * needs one; "since I last ran it in this window" is the right lifetime, not "forever on disk".
 */
const statsCache = new Map<UsageStatsView, UsageStats>();

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-(--line) bg-(--bg-elev) px-5 py-4">
      <div className="mb-1.5 font-mono text-2xl font-light text-primary">{value}</div>
      <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-subtle">{label}</div>
    </div>
  );
}

function TotalsGrid({ label, totals }: { label: string; totals: UsageTotals }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="section-label">{label}</span>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Input tokens" value={tokens(totals.inputTokens)} />
        <StatCard label="Output tokens" value={tokens(totals.outputTokens)} />
        <StatCard label="Total tokens" value={tokens(totals.totalTokens)} />
        <StatCard label="Cost" value={usd(totals.costUsd)} />
      </div>
    </div>
  );
}

export default function UsageStatsTab() {
  const [view, setView] = useState<UsageStatsView>("session");
  const [preview, setPreview] = useState<UsageStatsPreview | null>(null);
  // Seeded from the cache rather than `null`, so a view that was already run once this window —
  // including in a previous mount of this whole tab — shows its last result immediately instead
  // of the "nothing has been run yet" prompt.
  const [stats, setStats] = useState<UsageStats | null>(() => statsCache.get(view) ?? null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  /**
   * Ask what would run. This is safe to do on mount and on every view switch precisely because it
   * spawns nothing — it resolves `ccusage` with `fs` and hands back an argv and a token.
   */
  const refreshPreview = useCallback(async (next: UsageStatsView) => {
    setPreview(null);
    setError(null);
    const res = await callMain(() => previewUsageStats(next));
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setPreview(res.value);
  }, []);

  useEffect(() => {
    // Restore this view's cached result rather than clearing it — the switch above already ran
    // once and there is no reason to make the user run it again just to look back at it.
    setStats(statsCache.get(view) ?? null);
    void refreshPreview(view);
  }, [view, refreshPreview]);

  const run = async () => {
    if (!preview?.token || running) return;
    setRunning(true);
    setError(null);
    try {
      const res = await callMain(() => runUsageStats(preview.token!, preview.view));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      if (!res.value.ok) {
        setError(res.value.error);
        return;
      }
      setStats(res.value.stats);
      // `res.value.ok` is true here, so `stats` is populated — but the field itself is typed
      // nullable (the same interface backs the `!ok` failure shape), hence the guard.
      if (res.value.stats) statsCache.set(preview.view, res.value.stats);
    } finally {
      setRunning(false);
      // The token is spent either way — single use, like every other preview in this app — so the
      // next run needs a new one. Re-previewing also re-resolves ccusage, which is what makes
      // "install it, then press Refresh" work without reopening the tab.
      const again = await callMain(() => previewUsageStats(view));
      if (again.ok) setPreview(again.value);
    }
  };

  const label = VIEW_NOUN[view];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="section-label">Usage</span>
            {stats && (
              <span className="text-[10px] text-subtle">
                {stats.entryCount} {label}
                {stats.lastUpdated && ` · newest ${stats.lastUpdated}`}
              </span>
            )}
          </div>
          <p className="mt-1.5 text-[12px] text-subtle m-0">
            Token and cost totals, read out of <span className="font-mono">~/.claude</span> by{" "}
            <span className="font-mono">ccusage</span>.
          </p>
        </div>

        <div className="flex gap-1 rounded-md border border-(--line) bg-(--bg-elev) p-0.5">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              type="button"
              aria-selected={view === v.id}
              onClick={() => setView(v.id)}
              className={`rounded px-2.5 py-1 text-[11px] font-medium transition cursor-pointer border-0 focus:outline-none ${
                view === v.id ? "bg-primary text-white" : "bg-transparent text-subtle hover:text-(--ink-2)"
              }`}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      {/* What would run, before it runs. */}
      {preview && <RunBar preview={preview} running={running} hasStats={stats !== null} onRun={() => void run()} />}

      {error && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-500/10 text-[12px]">
          <AlertTriangle size={14} className="shrink-0 mt-px text-red-500" />
          <span className="text-(--ink-2)">{error}</span>
        </div>
      )}

      {stats && (
        <div className="flex flex-col gap-6" data-testid="usage-stats">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label={label} value={tokens(stats.entryCount)} />
            {view === "blocks" && <StatCard label="Active blocks" value={tokens(stats.activeBlocks)} />}
            <StatCard label="Total tokens" value={tokens(stats.total.totalTokens)} />
            <StatCard label="Total cost" value={usd(stats.total.costUsd)} />
            {stats.recent && <StatCard label="Cost (7 days)" value={usd(stats.recent.costUsd)} />}
          </div>

          <TotalsGrid label={stats.latestLabel ? `Latest — ${stats.latestLabel}` : "Latest"} totals={stats.latest} />
          {stats.recent && <TotalsGrid label="Last 7 days" totals={stats.recent} />}
          <TotalsGrid label={`All ${label}`} totals={stats.total} />
        </div>
      )}

      {!stats && !error && preview?.source !== "none" && (
        <p className="text-[12px] text-subtle m-0">
          Nothing has been run yet. Press <span className="text-(--ink-2)">Run</span> above to read your usage.
        </p>
      )}
    </div>
  );
}

/**
 * The line the whole tab is arranged around: what will run, where it comes from, and Run.
 *
 * Three states, and the middle one is the reason this exists. A local install is stated plainly. A
 * network fetch is stated *as a network fetch*, with the pinned version, because that is a
 * different thing to consent to. Neither available is a message naming the tool and how to get it
 * — the tab degrades here rather than at spawn time.
 */
function RunBar({
  preview,
  running,
  hasStats,
  onRun,
}: {
  preview: UsageStatsPreview;
  running: boolean;
  hasStats: boolean;
  onRun(): void;
}) {
  if (preview.source === "none") {
    return (
      <div
        data-testid="stats-unavailable"
        className="flex items-start gap-2 px-3 py-2.5 rounded-lg bg-amber-500/10 text-[12px]"
      >
        <AlertTriangle size={14} className="shrink-0 mt-px text-amber-500" />
        <div className="text-(--ink-2)">
          <div>{preview.unavailable}</div>
          <details className="mt-1">
            <summary className="cursor-pointer text-(--ink-3)">Where it looked</summary>
            <ul className="list-none p-0 m-0 mt-1 max-h-24 overflow-y-auto font-mono text-[10px] text-(--ink-3)">
              {preview.searched.map((dir) => (
                <li key={dir} className="truncate" title={dir}>
                  {dir}
                </li>
              ))}
            </ul>
          </details>
        </div>
      </div>
    );
  }

  const network = preview.network;

  return (
    <div
      data-testid="stats-run-bar"
      data-source={preview.source}
      className={`flex flex-col gap-2 rounded-lg border px-3.5 py-3 ${
        network ? "border-amber-500/40 bg-amber-500/5" : "border-(--line) bg-(--bg-elev)"
      }`}
    >
      <div className="flex items-start gap-2">
        {network ? (
          <Cloud size={14} className="shrink-0 mt-px text-amber-500" />
        ) : (
          <HardDrive size={14} className="shrink-0 mt-px text-(--ink-3)" />
        )}
        <div className="flex-1 text-[12px] text-(--ink-2)">
          {network ? (
            <>
              No <span className="font-mono">ccusage</span> is installed here, so running this{" "}
              <strong className="text-(--ink)">
                downloads ccusage {preview.pinnedVersion} from npm and executes it
              </strong>{" "}
              on this machine. The version is pinned by this app — it does not float on the latest release.
            </>
          ) : (
            <>
              Using the <span className="font-mono">ccusage</span> already installed here. Nothing is downloaded.
            </>
          )}
        </div>
        <button
          type="button"
          data-testid="stats-run"
          onClick={onRun}
          disabled={running}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-semibold text-white cursor-pointer focus:outline-none hover:brightness-110 disabled:opacity-60 disabled:cursor-not-allowed border-0"
        >
          {running ? (
            <>
              <Loader2 size={12} className="animate-spin" /> Running…
            </>
          ) : hasStats ? (
            <>
              <RotateCw size={12} /> Refresh
            </>
          ) : (
            <>
              <Play size={12} /> Run
            </>
          )}
        </button>
      </div>

      <div className="flex gap-2 text-[10px]">
        <span className="shrink-0 w-[64px] text-(--ink-3)">Command</span>
        <span data-testid="stats-argv" className="font-mono text-(--ink-2) break-all select-text">
          {preview.argv.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ")}
        </span>
      </div>
    </div>
  );
}
