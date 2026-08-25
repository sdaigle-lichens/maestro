// Client-side access to the usage-stats channels.
//
// Two calls, deliberately, mirroring `window.maestro.claude`: `previewUsageStats` reads the
// machine and says what WOULD run — including whether answering means fetching a package from npm
// — and spawns nothing; `runUsageStats` takes the token that came back and nothing else. The tab
// renders the preview first, every time. See src/core/ccusage.ts for the decision behind that.

import type { UsageStatsPreview, UsageStatsResult, UsageStatsView } from "../../../shared/ipc";

export type {
  CcusageSource,
  UsageStats,
  UsageStatsPreview,
  UsageStatsResult,
  UsageStatsView,
  UsageTotals,
} from "../../../shared/ipc";

export function previewUsageStats(view: UsageStatsView): Promise<UsageStatsPreview> {
  return window.maestro.stats.preview(view);
}

export function runUsageStats(token: string, view: UsageStatsView): Promise<UsageStatsResult> {
  return window.maestro.stats.run(token, view);
}
