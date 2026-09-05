# Todo

## Queue status

**`040`, `041` and `042` are `ready`.** 39 done, 3 ready, 0 blocked.

**The plugin is at `0.4.6`.** `040` takes it to `0.4.7` — patch.

- **`040-skip-re-injecting-static-context-into-a-resumed-subagent.md`** (`ready`, unblocked by `039`) —
  because `SubagentStart` fires again, a resumed run is re-injected with its skills, routing,
  per-route protocols and report verbatim (~600 tokens, and the `loaded_skills` block is an
  instruction to redo a tool call). Skip those five when the run is a resume; keep the channel
  delivery, which is the one block that is *not* static — a payload may have arrived between the two
  runs, and `retire()` already stops the first one being re-inlined. The resume signal is a
  `kind:"handoff"` entry for this `agent_id` in the run's log: right lifetime, and immune to the
  ordering race a `kind:"dispatch"` check would have against the sibling `SubagentStart` hook.
- **`041-guard-and-guide-duplicate-agent-types-in-a-workflow.md`** (`ready`) — two instances of one
  workflow on the same `agent` break four things silently, all from one root: `SubagentStart` gets
  `agent_type` and never the instance. The severe one is route loss — `handoff-routes.ts` dedups on
  `sender + label` with `sender` the bare agent, so one of two success edges leaving two same-agent
  instances is discarded with nothing reported. The canvas already prevents the collision
  (`placedAgentTypes`), so this adds the two things around that guard: a pure `config-validate.ts`
  for hand-edited configs (the app, `/maestro-update` and install all report; nothing auto-fixes),
  and a **fork affordance** in the picker's all-placed dead end — forking gives the second instance a
  distinct `agent`, which dissolves all four failures at the root, and `forkAgent(..., newName)`
  already does renamed forks with frontmatter rewrite and a provenance record.
- **`042-attribute-a-resumed-agents-log-entries-to-the-right-card.md`** (`ready`) — the follow-on
  `039` created and `log-view` v2.2 recorded rather than fixed. `buildInstances` correlates a card's
  `input`/`offeredSkills`/`delivered` to a `dispatch` entry by `agent_id` alone, which was unique per
  run only while every invocation was a cold `Task`. A resumed run keeps its `agent_id`, so
  `dispatchByAgentId` — a plain `Map` filled by one forward pass — is last-write-wins and *both*
  cards read back the second run's spawning message and offered skills; the name fallback is wrong in
  the mirror direction, and both cards render every delivery under that id. `offeredSkills` is the
  one that bites: `/session-log` diffs it against the reported `skillsTriage`, so a misattributed set
  can manufacture a phantom omission or hide a real one. Fix by bounding each lookup by position in
  the append-only log rather than adding a correlation key — the run boundary is already in the file
  order, and an `agent_id` that no longer matches the one `resumeTarget` hands `SendMessage` would be
  worse than the view sorting two runs out. Pure function, no `plugins/` change, so no version bump.

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
- **`038-start-the-log-tail-for-a-window-that-subscribed-before-a-project.md`** (`done`) — the
  quirk `037` recorded as harness-only, re-examined and **confirmed user-facing**. `startTail`
  returned before `tails.set` when no project was open, and `retargetTails` iterated `tails.keys()`,
  so a window that subscribed before a project existed never got a tail — and the renderer
  subscribes once with `[]` deps, so nothing recovered. `/session-log` was dead for the life of that
  window. It reproduced only on a first run (or after the open project is forgotten), which is why
  it had never been reported. The fix adds a `logSubscribers: Set<number>` in
  `apps/maestro/src/main/ipc.ts`, separating "asked for a tail" from "has a tail": `retargetTails`
  now reads `logSubscribers` instead of `tails.keys()`, `logSubscribe` adds to it before calling
  `startTail`, and both `logUnsubscribe` and the window's `destroyed` listener remove from it.
  `tails`, `startTail` and `stopTail` are unchanged. No divergences from the plan; reproduced and
  fixed in a real packaged window from a genuinely cold profile (confirmed against the pre-fix code
  too, via `git stash`, so the probe wasn't passing vacuously). No `plugins/` change, so no plugin
  version bump.
- **`039-resume-subagents-on-loop-back-edges.md`** (`done`) — a condition edge routing back to an
  agent that already ran this session now **resumes** it by `agent_id` via `SendMessage` instead of
  dispatching a cold `Task`, so it keeps its own memory of what it built. Adds no new hook write: a
  new pure `apps/maestro/src/core/agent-runs.ts` (`agentRunsFromLog`, `resumeTarget`) reads the
  `kind:"handoff"` entries `maestro-subagent-log.js` already appends on every `SubagentStop` — an
  existing per-run agent-type → agent-id index. A new `maestro-resume-target.cjs` CLI prints a
  resumable `agent_id` or nothing (no completed run yet, or the active workflow maps that agent type
  to more than one distinct instance — the same ambiguity `SubagentStart`'s injection would hit).
  `templates/maestro/SKILL.md` gained the `allowed-tools` grant for the CLI plus the routing/
  principles prose telling the orchestrator when to resume vs. spawn cold. Three divergences
  recorded on the page: the ambiguity check reuses `collectAgentSkills(...).matchedInstances` rather
  than a fresh instance-walk, so it can't disagree with what `SubagentStart` actually resolves; the
  `allowed-tools` grant needed a trailing ` *` wildcard (unlike the argument-less
  `maestro-step1-gates.cjs` grant), since this script takes an agent-type argument;
  `real-project.test.ts`'s single-`Bash(...)`-grant assumption had to be generalized to multi-grant
  parsing. Live `SendMessage`-resume behavior itself (conversation history retained, refusal
  fallback) is unverified end-to-end — no environment here can drive a live multi-agent orchestrator
  run. Plugin `0.4.5` → `0.4.6` (patch).

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
