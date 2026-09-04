# Todo

## Queue status

**The queue is empty.** Every page in `.claude/maestro-tasks/` is `done` and no `ready` task remains
— `035` was the last file, so there is nothing downstream to reconcile either. The next run starts
by writing new tasks (`/to-maestro-tasks`), not by picking one up.

**The plugin is at `0.4.4`.**

**`035-reach-the-global-report-tier-from-a-project-local-hook.md` closed.** `STATIC_ASSETS` gained
`lib/maestro-report-defaults.cjs` and `lib/maestro-handoff-defaults.cjs` in both install
implementations, so a project's own copy of `maestro-inject-agent-context` can reach the two global
sqlite tiers at all. Two facts worth carrying forward:

- **`STATIC_ASSETS` now carries six libs, and a test enforces the require-audit.**
  `install.test.ts` scans every copied script for relative `require()` specifiers and asserts the
  manifest copies each target — the rule being that a forgotten lib fails **silently** (the require
  sits in a try/catch, so the tier it backs just stops existing, and only for projects whose own
  copy of the hook wins the arbitration). Adding a hook `require` now means adding its lib to both
  manifests or failing that test.
- **The handoff seed fall-through is simulated in tests, not guaranteed by the manifest.** Since the
  sqlite bundle is copied, `install.test.ts`'s seed test deletes it to reach `SEED_HANDOFFS`. What
  actually reaches the seed in the field is a `node` older than 22.5 or a project on a pre-`0.4.4`
  runtime.

Adding those two assets moved `shippedRuntimeId`, so **every already-installed project reports stale
exactly once** and re-copies — expected, not a regression.

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
