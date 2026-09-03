# Todo

## Queue status

**`032-make-the-orchestrator-gates-optional.md` is `ready`** and blocked by nothing. Everything up to
`031` is `done`.

It makes Step 1 of the orchestrator skill — the `/confidence-check` and `/use-design-check` gates —
a per-project setting: two checkboxes on the app's `/maestro` page, persisted in `maestro.json`, read
at invocation time by a runtime script whose output is injected into the skill body via the
`` !`command` `` dynamic-context syntax. Both gates default to **off**.

`.claude/maestro-tasks/status.json` is the authority — re-read it rather than trusting this line.

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

For `032` specifically, that is: `maestro-config-model` (a new `maestro.json` field and a new
`ConfigSlice` arm), `installing-maestro` (a new runtime asset in both copies of the manifest),
`updating-maestro` (the orchestrator skill's frontmatter is outside the managed regions, so the
change needs a purge-and-reinstall) and `maestro-architecture` (Step 1 becomes config-driven and
injected).

Then do the task. When you are done, call the scribe agent, send it a summary of your code changes,
and ask it to use the `/scribe` skill and the `/update-concept-skills` skill to update the project's
concept skills. Also ask it to tick the acceptance criteria on the task page, record any divergences
from what the page planned, set the task to `done` in `status.json`, and update this `TODO.md` for
the next run.

**Any change under `plugins/<name>/` must bump that plugin's `plugin.json` `version`** — see
`.claude/skills/updating-maestro/` for which component.
