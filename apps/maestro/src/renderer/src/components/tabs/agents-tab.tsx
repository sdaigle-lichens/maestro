// The Agents tab: every subagent this project, this machine, or an installed plugin makes
// available — including Maestro's own bundled ones (`source: "maestro"`).

import DiscoveredDefinitionsList from "./discovered-definitions";
import CreateLink from "./create-link";
import type { DiscoveredDefinition } from "../../utils/tools";

export default function AgentsTab({ agents }: { agents: DiscoveredDefinition[] }) {
  return (
    <div className="flex flex-col gap-6">
      <DiscoveredDefinitionsList items={agents} emptyLabel="agents" />
      <CreateLink to="/create-subagent" label="Create a subagent" />
    </div>
  );
}
