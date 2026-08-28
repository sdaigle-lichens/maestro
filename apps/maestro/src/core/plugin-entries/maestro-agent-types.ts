// Bundle entry for plugins/maestro/scripts/lib/maestro-agent-types.cjs.
//
// `/maestro-install` (terminal path, no desktop app) needs an agent instance's own TYPE (not just
// its project tag, already read via maestro-agent-project-tags.cjs) to build the same `AgentAttrs`
// a skill's tags are matched against — see skill-tags.ts's `skillMapFromTags`. Reading the SAME
// `~/.claude/maestro-agent-types.sqlite` schema the app writes, rather than growing a second
// `node:sqlite` reader that could drift from `agent-types.ts`. Same degrade-on-old-`node`
// discipline as every other generated lib here — see that module's own header.

export { readAllAgentTypes, DEFAULT_AGENT_TYPES_DB_PATH } from "../agent-types.js";
