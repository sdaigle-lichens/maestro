# Todo

## Queue status

**`038` is ready.** The agent-channels pair (`036`/`037`) is done; `038` is a small fix written from
the bug the `037` verification turned up.

**The plugin is at `0.4.5`.**

- **`036-move-handoff-payloads-onto-agent-channels.md`** (`done`) — the runtime half. Moved
  `handoff_details`, `filesChanged` and `conceptSkillGaps` out of an agent's final message and into
  `.claude/channels/<receiver>/<sender>.1.md`, delivered by the `SubagentStart` hook, stamped with a
  `run_id` at `SubagentStop`, swept (not flushed) at `SessionEnd`. `skillsTriage` and the `HANDOFF:`
  line deliberately stayed in the message. Two divergences from the page, recorded on it: a
  pre-existing `writeSession` bug in `collect()` (dropping `active_task`/`run_id` on dispatch) was
  found and fixed as part of this slice; "delivered ... in a later run" for a scribe gap with no
  route landed as reached-and-mentioned rather than literally inlined for a foreign run.
- **`037-surface-agent-channels-in-the-app.md`** (`done`) — the app half. `/session-log` renders
  delivered payloads (`kind: "channel_delivery"` log entries — `sender`/`receiver`/`agent_id`/
  `content`) on the *receiving* instance's Input panel, correlated by `agent_id`, with a delivery
  count on the card and list row. `/maestro` shows undrained lanes via a new read-only
  `pendingLanes()` beside `036`'s `handoff-channels.ts` functions, wording an all-foreign-run lane as
  queued backlog rather than an error. The Interactions pane now names each route's lane path
  (`.claude/channels/<receiver>/<sender>.1.md`). No divergences from the plan; no `plugins/` change,
  so no plugin version bump.
- **`038-start-the-log-tail-for-a-window-that-subscribed-before-a-project.md`** (`ready`) — the
  quirk `037` recorded as harness-only, re-examined and **confirmed user-facing**. `startTail`
  returns before `tails.set` when no project is open, and `retargetTails` iterates `tails.keys()`,
  so a window that subscribed before a project existed never gets a tail — and the renderer
  subscribes once with `[]` deps, so nothing recovers. `/session-log` is dead for the life of that
  window. It reproduces only on a first run (or after the open project is forgotten), which is why
  it has never been reported. The fix separates "asked for a tail" from "has a tail"; the page says
  why the two one-line alternatives are each worse.

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
