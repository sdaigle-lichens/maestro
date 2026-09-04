# Todo

## Queue status

**`033-customizable-handoff-templates.md` is `done`.** Handoff protocols now resolve across three
tiers — `.claude/handoffs/<sender>/<receiver>.md`, then
`~/.claude/maestro-handoff-defaults.sqlite`, then a `SEED_HANDOFFS` constant bundled into
`lib/maestro-session.cjs` so the floor survives a `node` without `node:sqlite`. The install-managed
`.claude/templates/handoffs/` is gone (an install writes 17 files, not ~37) and all 23 files under
`plugins/maestro/templates/handoffs/` were deleted. Plugin is at `0.4.2`. Its 14 acceptance criteria
are ticked on the task page, with 8 recorded divergences from what the page planned.

**Next up: `034-edit-handoff-templates-in-the-app.md`** — now **unblocked**. The UI half:
`/templates`' Handoffs tab (global rows, create/delete, Reset to default for a shipped pair) and
`/agents`' Interactions pane (one entry per outgoing route, with its resolved tier). Its plan was
reconciled against `033` as built and holds — see the **Checked against `033` as built** section on
that page for the three small adjustments, chiefly that `ResolvedHandoff.source` has four values,
not three. Note `handoffsSync` is computed by the install today and rendered by nothing; `034` is
where `maestro.tsx` picks it up.

**Also ready: `035-reach-the-global-report-tier-from-a-project-local-hook.md`** — filed while
closing `033`. `lib/maestro-report-defaults.cjs` is not in `STATIC_ASSETS`, so a project-local copy
of the SubagentStart hook silently cannot reach the global report tier. Small, unblocked, and
independent of `034`.

`.claude/maestro-tasks/status.json` is the authority — re-read it rather than trusting these lines.

---

## Standing instructions for the next run

Read the task from `.claude/maestro-tasks/<NNN>-<slug>.md` — pick the lowest-numbered file whose
`status` in `.claude/maestro-tasks/status.json` is `ready` and whose `blockedBy` entries are all
`done`. Then, from `.claude` and `apps/maestro/.claude`, select the skills related to the task's
feature to get the context and tools needed. In all cases you will at least need:

- apps/maestro/.claude/skills/test-maestro/SKILL.md

and then whichever of these the task actually touches:

- .claude/skills/maestro-architecture/SKILL.md
- .claude/skills/installing-maestro/SKILL.md
- .claude/skills/updating-maestro/SKILL.md
- .claude/skills/react-flow-canvas-geometry/SKILL.md
- .claude/skills/task-queue/SKILL.md
- apps/maestro/.claude/skills/agents-view/SKILL.md
- apps/maestro/.claude/skills/agent-fork-sync/SKILL.md
- apps/maestro/.claude/skills/claude-session-bridge/SKILL.md
- apps/maestro/.claude/skills/create-skills-architecture/SKILL.md
- apps/maestro/.claude/skills/global-stores/SKILL.md
- apps/maestro/.claude/skills/maestro-config-model/SKILL.md
- apps/maestro/.claude/skills/plugin-libs-parity/SKILL.md
- apps/maestro/.claude/skills/workflow-view/SKILL.md

Then do the task. When you are done, call the scribe agent, send it a summary of your code changes,
and ask it to use the `/scribe` skill and the `/update-concept-skills` skill to update the project's
concept skills. Also ask it to tick the acceptance criteria on the task page, record any divergences
from what the page planned, set the task to `done` in `status.json`, and update this `TODO.md` for
the next run.

**Any change under `plugins/<name>/` must bump that plugin's `plugin.json` `version`** — see
`.claude/skills/updating-maestro/` for which component.
