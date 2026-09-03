# Todo

## Queue status

**The queue is empty.** Every file in `.claude/maestro-tasks/` is `done` as of `031`, and there is
no `032`.

`.claude/maestro-tasks/status.json` is the authority — re-read it rather than trusting this line.
The next run either queues new work with `/to-maestro-tasks`, or the user has something else in mind.

---

## Standing instructions for the next run

Read the task from `.claude/maestro-tasks/<NNN>-<slug>.md` — pick the lowest-numbered file whose
`status` in `.claude/maestro-tasks/status.json` is `ready` and whose `blockedBy` entries are all
`done`. Then, from `.claude` and `apps/maestro/.claude`, select the skills related to the task's
feature to get the context and tools needed. In all cases you will at least need:

- apps/maestro/.claude/skills/test-maestro/SKILL.md

and then whichever of these the task actually touches:

- apps/maestro/.claude/skills/agents-view/SKILL.md
- apps/maestro/.claude/skills/global-stores/SKILL.md
- apps/maestro/.claude/skills/plugin-libs-parity/SKILL.md
- apps/maestro/.claude/skills/claude-session-bridge/SKILL.md
- apps/maestro/.claude/skills/maestro-config-model/SKILL.md
- .claude/skills/installing-maestro/SKILL.md
- .claude/skills/updating-maestro/SKILL.md
- .claude/skills/maestro-architecture/SKILL.md
- .claude/skills/task-queue/SKILL.md

Then do the task. When you are done, call the scribe agent, send it a summary of your code changes,
and ask it to use the `/scribe` skill and the `/update-concept-skills` skill to update the project's
concept skills. Also ask it to tick the acceptance criteria on the task page, record any divergences
from what the page planned, set the task to `done` in `status.json`, and update this `TODO.md` for
the next run.

**Any change under `plugins/<name>/` must bump that plugin's `plugin.json` `version`** — see
`.claude/skills/updating-maestro/` for which component.
