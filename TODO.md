# Todo

## Queue status

**Next up: `035-reach-the-global-report-tier-from-a-project-local-hook.md`** — ready, unblocked and
independent of everything before it. `lib/maestro-report-defaults.cjs` is not in `STATIC_ASSETS`, so
a project-local copy of the SubagentStart hook silently cannot reach the global report tier. Its plan
was reconciled against `034` as built and is **unaffected** — see the **Checked against `034` as
built** section on that page; the only thing that moved is the base version, so its bump is
`0.4.3 → 0.4.4` (still a patch).

**`034-edit-handoff-templates-in-the-app.md` closed.** Both handoff tiers now have an editing
surface: `/templates`' Handoffs tab writes the global row (create, delete, Reset to default for a
shipped pair), `/agents`' Interactions pane writes the project override, one entry per outgoing
route. Three things to carry forward:

- **The plugin is at `0.4.3`.** `034` changed one branch in `plugins/maestro/scripts/maestro-install.js`
  (the `no-template` verdict now clears a `syncedFrom` left tracking a deleted global row, mirroring
  `handoff-sync.ts`), so it shipped as a patch even though the commit is a `feat:`.
- **`handoffsSync` is now rendered on `/maestro`** — materialised / refreshed / stale-customised,
  worded as the `reportsSync` lines. It was computed by `033`'s install and displayed by nothing.
- **The planned `handoff:get` was replaced by `handoff:routes`.** The page planned five channels
  (three `template:handoffs:*`, `handoff:get`, `handoff:save`); five shipped (`handoff:routes`
  instead of `handoff:get`). `handoff:routes` returns every outgoing route already resolved in one
  round trip because `handoff-routes.ts` is not renderer-safe — a per-route `get` would reopen the
  global store once per row. All channels take a `handoffId` string rather than `(sender, receiver)`.

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
