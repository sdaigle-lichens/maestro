# Todo

## Queue status

**`036` is ready.** Two new pages, written together from a design discussion rather than from a
post-mortem, so they carry more reasoning than usual and no implementation has started.

**The plugin is at `0.4.4`.**

- **`036-move-handoff-payloads-onto-agent-channels.md`** (`ready`) — the runtime half. Moves
  `handoff_details`, `filesChanged` and `conceptSkillGaps` out of an agent's final message and into
  `.claude/channels/<receiver>/`, delivered by the `SubagentStart` hook. `skillsTriage` and the
  `HANDOFF:` line deliberately stay in the message.
- **`037-surface-agent-channels-in-the-app.md`** (`blocked` by `036`) — the app half. `/session-log`
  renders delivered payloads on the *receiving* instance, `/maestro` shows undrained lanes.

Four things on `036` that are easy to get wrong and fail quietly:

- **Rewriting a seed body without moving its previous text into `PRIOR_SEEDS` is a no-op** on any
  machine whose store has already been opened — `seedIfEmpty` only fires on a virgin store, and
  `refreshSupersededSeeds` can only move a row it has the prior text for. Both `handoff-defaults.ts`
  and `report-defaults.ts` are affected.
- **The channel code re-exports from `maestro-session.cjs` rather than adding a 12th bundle**, which
  is what keeps it out of both `STATIC_ASSETS` manifests. The price is that
  `grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-session.cjs` must stay `0`.
- **A skill step between two agents has no lane.** `handoffRoutes` resolves a success edge *through*
  a skill node, so the payload goes to the agent downstream of it and the skill — which runs inline
  in the orchestrator's context, with no `SubagentStart` — gets nothing. `036` handles it with a read
  that does not retire; miss it and skill steps lose their input silently.
- **Dropping the `SessionEnd` flush costs freshness**, which is why channel files carry a `run_id`
  stamp minted into `maestro_session.json`. Without it, an abandoned run's payload gets inlined into
  an unrelated run a week later, silently.

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
