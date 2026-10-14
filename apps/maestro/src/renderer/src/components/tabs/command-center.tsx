// The Command Center tab: what is installed on this machine, and the CLI's command table.
//
// PORTED FROM apps/help-server/src/components/tabs/CommandCenter.tsx. The one substantive change
// is that the filtering is a `useMemo` over the array rather than a `@tanstack/react-table`
// instance: the table has two columns, one global filter and no sorting, paging, or column
// visibility, so the library was carrying a row model for a `.filter()` call. See
// ../highlight-text.tsx for the same call on `react-highlight-words`.

import { useMemo, useState } from "react";
import { MagnifyingGlassIcon } from "@phosphor-icons/react";
import CopyableText from "@repo/ui/copyable-text";
import CreateLink from "./create-link";
import type { ClaudeCommand, InstalledPluginInfo } from "../../utils/tools";

const TH =
  "border-b border-maestro px-4 py-2.5 text-left text-[12px] font-semibold uppercase tracking-[0.08em] text-maestro-muted";
const ROW = "border-b border-maestro last:border-0 hover:bg-maestro-elevated transition-colors";

function ScopeChip({ scope }: { scope: string }) {
  const isUser = scope === "user";
  return (
    <span
      className={`inline-block rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
        isUser
          ? "border-maestro-focus-ring bg-maestro-primary-subtle text-maestro-primary"
          : "border-maestro bg-maestro-elevated text-maestro-muted"
      }`}
    >
      {scope}
    </span>
  );
}

export default function CommandCenter({
  installedPlugins,
  commands,
}: {
  installedPlugins: InstalledPluginInfo[];
  commands: ClaudeCommand[];
}) {
  const [filter, setFilter] = useState("");

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (c) => c.command.toLowerCase().includes(needle) || c.description.toLowerCase().includes(needle)
    );
  }, [commands, filter]);

  return (
    <div className="flex flex-col gap-10">
      <section>
        <div className="mb-4 flex items-center gap-3">
          <span className="section-label">Installed Plugins</span>
          <span className="text-[10px] text-maestro-muted">{installedPlugins.length}</span>
        </div>
        {installedPlugins.length === 0 ? (
          <p className="text-[13px] text-maestro-muted m-0">
            No plugins installed for this machine. <span className="font-mono">claude plugin install …</span> adds one.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-maestro">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-maestro-elevated">
                  <th className={TH}>Plugin</th>
                  <th className={TH}>Marketplace</th>
                  <th className={TH}>Version</th>
                  <th className={TH}>Scope</th>
                  <th className={TH}>Installed</th>
                </tr>
              </thead>
              <tbody>
                {installedPlugins.map((p) => (
                  <tr key={`${p.key}-${p.scope}`} className={ROW}>
                    <td className="px-4 py-2.5">
                      <span className="inline-block rounded-md border border-maestro-focus-ring bg-maestro-primary-subtle px-2 py-0.5 font-mono text-[12px] text-maestro-primary">
                        {p.pluginName}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-[13px] text-maestro-muted">{p.marketplace}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-maestro-muted">{p.version || "—"}</td>
                    <td className="px-4 py-2.5">
                      <ScopeChip scope={p.scope} />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-maestro-muted">
                      {p.installedAt ? p.installedAt.slice(0, 10) : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <span className="section-label">Commands</span>
            <span className="text-[10px] text-maestro-muted">
              {visible.length} of {commands.length}
            </span>
          </div>
          <div
            className={`flex w-full sm:w-80 shrink-0 items-center gap-2 rounded-md border bg-maestro-elevated px-3 py-1.5 transition-colors ${
              filter ? "border-maestro-primary-strong" : "border-maestro"
            }`}
          >
            <MagnifyingGlassIcon size={12} className="shrink-0 text-maestro-muted" />
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter commands…"
              className="w-full bg-transparent text-[13px] text-maestro placeholder-maestro-muted outline-none"
            />
          </div>
        </div>

        {commands.length === 0 ? (
          <p className="text-[13px] text-maestro-muted m-0">
            No command table found. This is read from <span className="font-mono">docs/claude-code.md</span> in the open
            project.
          </p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-maestro">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-maestro-elevated">
                  <th className={TH}>Command</th>
                  <th className={TH}>Description</th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="px-4 py-6 text-center text-[13px] text-maestro-muted">
                      No commands match.
                    </td>
                  </tr>
                ) : (
                  visible.map((cmd) => (
                    <tr key={cmd.command} className={ROW}>
                      <td className="px-4 py-2.5 align-top">
                        <CopyableText text={cmd.command} className="inline-block">
                          <span className="inline-block rounded-md border border-maestro-focus-ring bg-maestro-primary-subtle px-2 py-0.5 font-mono text-[12px] text-maestro-primary">
                            {cmd.command}
                          </span>
                        </CopyableText>
                      </td>
                      <td className="px-4 py-2.5 align-top text-[13px] text-maestro-muted">{cmd.description}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <CreateLink to="/create-plugin" label="Create a plugin" />
    </div>
  );
}
