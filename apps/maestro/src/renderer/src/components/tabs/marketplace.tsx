// The Marketplace tab: every marketplace known to THIS MACHINE (`listMarketplaces()`, via
// `ToolsData.marketplaces`) as the primary content, with the OPEN PROJECT's own
// `.claude-plugin/marketplace.json` kept as a secondary section beneath it — nothing that was
// visible before this tab existed as "Project Marketplace" has disappeared, it just moved down.

import CopyableText from "@repo/ui/copyable-text";
import ProjectMarketplace from "./project-marketplace";
import CreateLink from "./create-link";
import type { MarketplaceEntry, MarketplacePluginInfo, RuleLibraryEntry } from "../../utils/tools";

function MarketplaceCard({ marketplace }: { marketplace: MarketplaceEntry }) {
  return (
    <div className="overflow-hidden rounded-lg border border-maestro">
      <div className="flex flex-col gap-2 border-b border-maestro bg-maestro-elevated px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[14px] font-medium text-maestro">{marketplace.name}</span>
            {marketplace.owner && (
              <span className="text-[12px] text-maestro-muted">
                {marketplace.owner.name}
                {marketplace.owner.email ? ` <${marketplace.owner.email}>` : ""}
              </span>
            )}
          </div>
          <CopyableText text={marketplace.path}>
            <span className="mt-1 block font-mono text-[11px] text-maestro-muted truncate">{marketplace.path}</span>
          </CopyableText>
        </div>
      </div>
      {marketplace.plugins.length === 0 ? (
        <p className="px-5 py-3 text-[12px] text-maestro-muted m-0">No plugins registered.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 px-5 py-3">
          {marketplace.plugins.map((plugin) => (
            <span
              key={plugin}
              className="inline-block rounded-md border border-maestro-focus-ring bg-maestro-primary-subtle px-2 py-0.5 font-mono text-[12px] text-maestro-primary"
            >
              {plugin}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function MarketplaceTab({
  marketplaces,
  projectMarketplace,
  ruleLibrary,
}: {
  marketplaces: MarketplaceEntry[];
  projectMarketplace: MarketplacePluginInfo[];
  ruleLibrary: RuleLibraryEntry[];
}) {
  return (
    <div className="flex flex-col gap-10">
      <section>
        <div className="mb-4 flex items-center gap-3">
          <span className="section-label">Marketplaces</span>
          <span className="rounded-full bg-maestro-elevated px-2.5 py-0.5 text-[12px] font-medium text-maestro-muted">
            {marketplaces.length}
          </span>
        </div>
        {marketplaces.length === 0 ? (
          <p className="text-[13px] text-maestro-muted m-0">
            No marketplaces are registered on this machine yet.{" "}
            <span className="font-mono">claude plugin marketplace add …</span> adds one.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {marketplaces.map((m) => (
              <MarketplaceCard key={m.path} marketplace={m} />
            ))}
          </div>
        )}
        <CreateLink to="/create-marketplace" label="Create a marketplace" />
      </section>

      <section className="pt-8 border-t border-maestro">
        <div className="mb-4 text-[12px] text-maestro-muted">
          This project&rsquo;s own marketplace — what it publishes from its own repository, separate from the
          machine-wide list above.
        </div>
        <ProjectMarketplace plugins={projectMarketplace} ruleLibrary={ruleLibrary} />
      </section>
    </div>
  );
}
