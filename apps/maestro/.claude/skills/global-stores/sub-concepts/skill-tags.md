# Skill tags

A user's manual, two-dimensional annotation on a skill, stored once per skill id in
`~/.claude/maestro-skill-tags.sqlite` and shared across every project.

The two dimensions:

- **`projectTags`** — which Project Tags catalog entries the skill applies to, plus `GLOBAL_TAG` for
  "regardless of project tag".
- **`agentTypes`** — which of `agent-types.ts`'s closed vocabulary the skill applies to, plus
  `GLOBAL_TAG` for "regardless of agent type".

Both are edited together in one Skills-tab row and always read together — `skillMapFromTags` is
where they combine to decide which skills a given seeded agent instance receives. Routing is by
_what kind of agent and what kind of project_, never by agent name.

Files: `src/core/skill-tags.ts`; edited from the `/skills` route; also
`plugins/maestro/skills/update-skill-tags`.
