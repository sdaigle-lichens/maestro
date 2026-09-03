# Agent types and project tags

The per-agent half of the two-dimensional match that `skill-tags.ts` performs.

- **`agent-types.ts`** (`~/.claude/maestro-agent-types.sqlite`) — a closed vocabulary of agent types
  (`AGENT_TYPES`), one per agent name.
- **`agent-project-tags.ts`** (`~/.claude/maestro-agent-project-tags.sqlite`) — which project tags an
  agent belongs to, one entry per agent name.
- **`project-tags.ts`** (`~/.claude/maestro-project-tags.sqlite`) — the catalog both sides key
  against.

Keying on the agent's frontmatter _name_ rather than a fixed roster is what lets any agent on the
user's machine participate in a workflow. Since `030`, the first two tables key on `(project_root,
agent_name)` rather than name alone — `project_root = ''` for a `user`/`maestro`/plugin-tier agent
(the same agent everywhere), a project's own root for a `project`-tier one, so two projects'
same-named project agents no longer collide. See the parent `SKILL.md`'s "Keyed by project, not
just agent name" section for the read/write discipline; `project-tags.ts`'s catalog is untouched by
this — it has no per-agent row to key.

Files: `src/core/agent-types.ts`, `src/core/agent-project-tags.ts`, `src/core/project-tags.ts`.
