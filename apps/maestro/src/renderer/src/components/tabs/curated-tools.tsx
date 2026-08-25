// The Curated Tools tab: plugins from the marketplaces the dashboard vouches for.
//
// PORTED FROM apps/help-server/src/components/tabs/CuratedTab.tsx, with its three
// `@tanstack/react-table` column filters replaced by one `useMemo` — see ./command-center.tsx for
// why the library did not come across.

import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import CopyableText from "@repo/ui/copyable-text";
import type { CuratedPlugin } from "../../utils/tools";

const TH =
  "border-b border-(--line) px-4 py-2.5 text-left text-[12px] font-semibold uppercase tracking-[0.08em] text-(--ink-2)";
const SELECT =
  "rounded-md border border-(--line) bg-(--bg-elev) px-3 py-1.5 text-[13px] text-(--ink) outline-none hover:border-border-strong cursor-pointer";

type StatusFilter = "all" | "installed" | "not-installed";

export default function CuratedTools({ plugins }: { plugins: CuratedPlugin[] }) {
  const [search, setSearch] = useState("");
  const [source, setSource] = useState("all");
  const [status, setStatus] = useState<StatusFilter>("all");

  const sources = useMemo(() => ["all", ...new Set(plugins.map((p) => p.marketplaceLabel))], [plugins]);

  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return plugins.filter((p) => {
      if (needle && !p.name.toLowerCase().includes(needle) && !p.description.toLowerCase().includes(needle))
        return false;
      if (source !== "all" && p.marketplaceLabel !== source) return false;
      if (status === "installed" && !p.isInstalled) return false;
      if (status === "not-installed" && p.isInstalled) return false;
      return true;
    });
  }, [plugins, search, source, status]);

  const installedCount = plugins.filter((p) => p.isInstalled).length;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <span className="section-label">Curated Plugins</span>
            <span className="text-[10px] text-subtle">
              {visible.length} shown · {installedCount} installed
            </span>
          </div>
          <p className="mt-1.5 text-[12px] text-subtle m-0">
            Plugins from marketplaces Claude Code has cached on this machine.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div
            className={`flex w-full sm:w-56 shrink-0 items-center gap-2 rounded-md border bg-(--bg-elev) px-3 py-1.5 transition-colors ${
              search ? "border-primary" : "border-(--line)"
            }`}
          >
            <Search size={11} className="shrink-0 text-subtle" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search…"
              className="w-full bg-transparent text-[13px] text-(--ink) placeholder-subtle outline-none"
            />
          </div>

          <select value={source} onChange={(e) => setSource(e.target.value)} className={SELECT}>
            {sources.map((s) => (
              <option key={s} value={s}>
                {s === "all" ? "All sources" : s}
              </option>
            ))}
          </select>

          <select value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)} className={SELECT}>
            <option value="all">All status</option>
            <option value="installed">Installed</option>
            <option value="not-installed">Not installed</option>
          </select>
        </div>
      </div>

      {plugins.length === 0 ? (
        <p className="text-[13px] text-subtle m-0">
          No curated marketplace is cached on this machine yet. Adding one with{" "}
          <span className="font-mono">claude plugin marketplace add …</span> populates this list.
        </p>
      ) : visible.length === 0 ? (
        <p className="text-[13px] text-subtle m-0">No plugins match the current filters.</p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-(--line)">
          <table className="w-full border-collapse">
            <thead>
              <tr className="bg-(--bg-elev)">
                <th className={TH}>Plugin</th>
                <th className={TH}>Source</th>
                <th className={TH}>Description</th>
                <th className={TH} style={{ minWidth: "20em" }}>
                  Install
                </th>
              </tr>
            </thead>
            <tbody>
              {visible.map((plugin) => (
                <tr
                  key={`${plugin.marketplace}/${plugin.name}`}
                  className="border-b border-(--line) last:border-0 hover:bg-(--bg-elev) transition-colors"
                >
                  <td className="px-4 py-2.5 align-top">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-block rounded-md border border-ring bg-(--primary-dim) px-2 py-0.5 font-mono text-[12px] text-primary">
                        {plugin.name}
                      </span>
                      {plugin.isInstalled && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-(--green-dim) bg-(--green-dim) px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success">
                          <span className="h-1.5 w-1.5 rounded-full bg-success" />
                          Installed
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <span
                      className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                        plugin.marketplaceLabel.toLowerCase().includes("anthropic")
                          ? "border-ring bg-(--primary-dim) text-primary"
                          : "border-(--line) bg-(--bg-elev) text-subtle"
                      }`}
                    >
                      {plugin.marketplaceLabel}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 align-top text-[13px] text-(--ink-2)">{plugin.description}</td>
                  <td className="px-4 py-2.5 align-top" style={{ minWidth: "20em" }}>
                    {plugin.isInstalled ? (
                      <span className="text-[13px] text-subtle">—</span>
                    ) : (
                      <CopyableText
                        text={plugin.installCommand}
                        className="inline-block"
                        previewText="Click to copy install command"
                      >
                        <code className="inline-block rounded-md border border-(--line) bg-(--bg) px-2.5 py-1.5 font-mono text-[12px] text-(--ink-2)">
                          {plugin.installCommand}
                        </code>
                      </CopyableText>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
