// Bundle entry for plugins/maestro/scripts/lib/maestro-agent-fork.cjs (`081`) — forking a global
// agent into a project from the terminal, with the same `forkAgent` the `/agents` view calls, so
// the provenance record (`agent-forks.json`) and the sync verdict that follows from it are the
// app's own. Required only by `plugins/maestro/scripts/maestro-agent-fork.cjs`; not copied into
// projects.
//
// UNLIKE `maestro-agent-sync`, THIS BUNDLE DOES REQUIRE `node:sqlite`: a renamed fork copies the
// template's avatar, type and project tag into three sqlite stores (`copyAgentAttributeRows`), which
// is why `agent-fork.ts` was split from `agent-fork-record.ts` in the first place. The CLI therefore
// loads it lazily and turns a failed require (a `node` older than 22.5) into a refusal.

export { forkAgent, type AgentForkRecord, type AgentForkResult } from "../agent-fork.js";
export { readAgentForks } from "../agent-fork-record.js";
