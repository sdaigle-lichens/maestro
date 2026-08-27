// Client-side data access for the /tools dashboard.
//
// One call, four tabs. This is what help-server's six `createServerFn` handlers became: the node
// side reads the machine once and hands back a payload the whole view renders from.

import type { ToolsData } from "../../../shared/ipc";
export { GLOBAL_TAG, AGENT_TYPES } from "../../../shared/ipc";

export type {
  ToolsData,
  InstalledPluginInfo,
  MarketplacePluginInfo,
  DefinitionSummary,
  CuratedPlugin,
  RuleLibraryEntry,
  ClaudeCommand,
  MarketplaceEntry,
  ProjectRule,
  DiscoveredDefinition,
  AgentType,
} from "../../../shared/ipc";

export function getToolsData(projectRoot?: string): Promise<ToolsData> {
  return window.maestro.data.tools(projectRoot);
}

export function setSkillProjectTags(skillId: string, tags: string[]): Promise<string[]> {
  return window.maestro.skillTags.setProjectTags(skillId, tags);
}

export function setSkillAgentTypes(skillId: string, tags: string[]): Promise<string[]> {
  return window.maestro.skillTags.setAgentTypes(skillId, tags);
}
