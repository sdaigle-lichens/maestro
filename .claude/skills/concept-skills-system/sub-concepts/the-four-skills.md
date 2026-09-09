# The four skills

**`create-concept-skills`** derives the list from scratch. Its defining constraint is budget: it
delegates reading to cheap subagents, keeps their findings as *lists of candidates*, and stops at
skeletons. It refuses to run when a list already exists. It must settle the list with the user via
`AskUserQuestion` — and when running as a subagent, where that tool is stripped, it must emit the
proposal and stop rather than decide on the user's behalf.

**`update-concept-skills`** reconciles an existing list against what changed since `last-update`.
Given a code-change report it can skip re-exploring the code the session just wrote. It bumps minor.

**`update-single-concept-skill`** takes one skill from skeleton to something worth loading:
researches the concept, deepens `SKILL.md` and `sub-concepts/`, and writes the per-agent `agents/`
notes for the agents the project actually uses (`maestro-concept-skills.cjs agents`). It bumps major.

**`scribe`** is the placement rule rather than a lifecycle step: concept skills are for agents,
`docs/` is for humans, and shared knowledge becomes a `docs/` file a concept skill references.

Directory: `plugins/maestro/skills/`.
