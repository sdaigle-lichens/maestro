# Agent types and project tags

The per-agent half of the two-dimensional match that `skill-tags.ts` performs.

- **`agent-types.ts`** (`~/.claude/maestro-agent-types.sqlite`) — a closed vocabulary of agent types
  (`AGENT_TYPES`), one per agent name.
- **`agent-project-tags.ts`** (`~/.claude/maestro-agent-project-tags.sqlite`) — which project tags an
  agent belongs to, one entry per agent name.
- **`project-tags.ts`** (`~/.claude/maestro-project-tags.sqlite`) — the catalog both sides key
  against.

Keying on the agent's frontmatter _name_ rather than a fixed roster is what lets any agent on the
user's machine participate in a workflow.

Files: `src/core/agent-types.ts`, `src/core/agent-project-tags.ts`, `src/core/project-tags.ts`.
