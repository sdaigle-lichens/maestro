# Todo

Read the task, then from the `.claude` and `apps/maestro/.claude` select the skills that are related to the task feature to get the context and tool needed. In all case, you will at least need:

- apps/maestro/.claude/skills/test-maestro/SKILL.md

The task is to implement the design for the agent page from `docs/features/agents-page/design_handoff_agents_page/README.md`. It was created in claude design. The current character implementation comes from the plan at `docs/features/agents-page/create-characters-plan.md` that can be deleted once this task is done. The only thing that the design should be missing is the button to toggle between loaded and ref skills for the agent. The rest should be there. Also do not commit the `docs/features/agents-page/design_handoff_agents_page`, it is to be trashed once the task is complete and approved by me.

When you are done, call the scribe agent, send him a summary of your code changes and ask him to use the `/scribe` skill and the `/update-concept-skills` skill to update the concept skills of the project.

---
