// Bundle entry for plugins/maestro/scripts/lib/maestro-agent-project-tags.cjs.
//
// The agent-side half of the project ↔ agent mapping, mirroring maestro-project-tags.cjs (the
// catalog side) so a terminal-path reader of `~/.claude/maestro-agent-project-tags.sqlite` shares
// the exact schema the app writes, rather than growing a second `node:sqlite` reader that could
// drift from `agent-project-tags.ts`. Same degrade-on-old-`node` discipline as every other
// generated lib here — see that module's own header.

export {
  readAllAgentProjectTags,
  agentsForProjectTags,
  DEFAULT_AGENT_PROJECT_TAGS_DB_PATH,
} from "../agent-project-tags.js";
