# Todo

Read the task from `.claude/maestro-tasks/031-keep-forked-agents-in-step-with-their-template.md`, then from the `.claude` and `apps/maestro/.claude` select the skills that are related to the task feature to get the context and tool needed. In all case, you will at least need:

- apps/maestro/.claude/skills/test-maestro/SKILL.md
- apps/maestro/.claude/skills/global-stores/SKILL.md
- apps/maestro/.claude/skills/agents-view/SKILL.md
- .claude/skills/updating-maestro/SKILL.md
- .claude/skills/maestro-architecture/SKILL.md

Then do the task. When you are done, call the scribe agent, send him a summary of your code changes and ask him to use the `/scribe` skill and the `/update-concept-skills` skill to update the concept skills of the project. It can also update the TODO.md task for the next maestro-task.

---
