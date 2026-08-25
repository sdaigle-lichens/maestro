// Client-side data access for the /tools dashboard.
//
// One call, four tabs. This is what help-server's six `createServerFn` handlers became: the node
// side reads the machine once and hands back a payload the whole view renders from.

import type { ToolsData, SkillTag } from "../../../shared/ipc";
export { SKILL_TAGS } from "../../../shared/ipc";

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
  SkillTag,
} from "../../../shared/ipc";

export function getToolsData(projectRoot?: string): Promise<ToolsData> {
  return window.maestro.data.tools(projectRoot);
}

export function setSkillTags(skillId: string, tags: SkillTag[]): Promise<SkillTag[]> {
  return window.maestro.skillTags.set(skillId, tags);
}
