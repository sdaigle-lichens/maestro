# Finishing a maestro task: the scribe handoff

When the work being probed is a slice from `.claude/maestro-tasks/`, the run is not done when the
window is green. **Hand off to the `scribe` agent** (`plugins/maestro/agents/scribe.md`) before
reporting back.

Why it is a step rather than a nicety: those task pages are written *before* the slice is built, and
a slice that diverges silently leaves the next one planned against an app that no longer exists.
`025` was written expecting to filter the session store for terminal-started conversations; the
option that does that was measured to return zero rows for the app's own sessions, so the rule
shipped inverted. A later task reading the unamended page would have planned around a filter that is
not there. The scribe's job is to close that gap while you still remember the measurement.

Tell it, in one handoff message:

- **What was built** — files added, changed, renamed; new channels, modules, exported names.
- **What diverged from the task page, and why** — one entry per divergence, each with the
  measurement or constraint that forced it. This is the part the page cannot reconstruct later.
- **To amend the task page itself** — tick the acceptance criteria with the evidence beside each,
  and record the divergences on the page, so it describes what exists rather than what was planned.
- **To check the *following* task pages for staleness** — anything downstream that assumed the
  planned shape needs correcting now, so the task structure has no gaps.
- **To update `TODO.md`** with the next task to pick up, and **`.claude/maestro-tasks/status.json`**
  with the finished task's state.

Three things learned running this:

- **The scribe cannot run commands** (`disallowedTools: [Bash, Task]`) and its own workflow forbids
  re-discovering changes by scanning code. Your handoff is the only source it has — if a file or a
  divergence is not in the message, it will not be in the docs. Do not send it to "go look".
- **It can fail after writing.** A 529 mid-run reported the whole agent as failed while every edit
  was already on disk. Check `git status` and read the diffs before re-running anything, or you will
  duplicate its work on top of itself.
- **Verify its claims like any other report.** Grep for the exported names and files it says it
  documented; a doc that names something that does not exist is worse than no doc.

Then relay what it changed to the user — its report goes to you, not to them.
