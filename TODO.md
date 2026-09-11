# Todo

## Orchestrator: main session reached for a generic Explore agent instead of concept skills

**Status:** not implemented — flagged for evaluation in a future session. Core change to the
`maestro` orchestrator template; small diff, but everything downstream depends on that skill, so it
needs deliberate review rather than a same-session fix.

**Correction (same session, caught before this was acted on):** an earlier draft of this entry also
claimed `@backend`/`@frontend` were never dispatched for task `063` and that the main session
implemented the module directly instead. That claim was based on
`.claude/maestro_session.log.jsonl`, and the log turned out to be unreliable evidence — see the
separate entry below on the log-clobbering bug this surfaced. The user's own recollection (having
watched `@backend`/`@frontend` run) is very likely the correct account; the log simply doesn't go
back far enough to confirm it either way. That part of the original analysis is retracted. What
remains solid, because it doesn't depend on the log at all — the user caught it live, in
conversation — is the part below.

### What happened

While running `/maestro` on task `063` (the `create-workflow`/`update-workflow` skills over a
`WorkflowSpec` module) in this repo's own dogfooded workflow, the main session — at some point where
it needed to reason about the module's design itself — spawned a generic `Explore` subagent to
survey the codebase, instead of loading this repo's own concept skills (`maestro-config-model`,
`workflow-view`, `plugin-libs-parity`, etc.), which document exactly the invariants the module
needed to get right (e.g. the `sourceHandle`-preservation quirk in `seed.ts`/`workflow-spec.ts`).
The user caught this live: "Why did you kick off the Explore agent instead of using the concept
skills?"

### Root cause

`@backend`'s own instance already carries the relevant concept skills as `referenced_skills`
(verified in this repo's `.claude/maestro.json`), and `backend.md` already mandates triaging every
injected skill before touching code, with source-diving only as a fallback. That mechanism works —
it's presumably why `@scribe` correctly reached for the concept-skill CLI (`stamp`) on its own this
same session. The **main session has no equivalent mechanism**: nothing injects a skills list or a
"check concept skills first" reminder into it, because `SubagentStart` only fires for
`Task`-dispatched subagents, never for the orchestrator itself.

So whenever the main session needs to reason about this project's own architecture directly —
whether to write a well-grounded dispatch brief, or because a step doesn't cleanly delegate — it has
no equivalent of the "skills before source" discipline a dispatched agent gets for free. It's free to
reach for a generic `Explore`/`general-purpose` agent instead of the concept-skill system that exists
specifically to prevent that.

Confidence-check (`gates.confidence_check`, currently `false` in this repo) would not have caught
this cleanly either: it fires once, in Step 1, before a workflow is even selected. It *does* already
carry a "skills before source" line in its own rubric, so turning it on is a plausible, independent
partial mitigation — but it's a one-time gate at the start of a run, not a rule that would stop the
main session from reaching for `Explore` mid-run the way it did here.

### Suggested fix (not yet implemented)

Add an explicit rule — likely in `plugins/maestro/templates/maestro/SKILL.md`'s Principles section
(the `<!-- Maestro:PRINCIPLES:START -->` managed region, so edit the **source template**, not a
project's rendered copy — applies throughout a run, not just one step) — that before the main
session dispatches a generic `Explore`/`general-purpose` agent to research this project's own code
or architecture, it must first check whether a project concept skill already covers it: invoke
`explore-concept-skills` (or load a known-relevant concept skill directly) first. Concretely:

- State the rule as a hard check, not a principle to remember: "before reaching for `Explore` on
  this project's own code, check the concept-skill list."
- Say why inline: concept skills capture invariants (like the `sourceHandle` quirk above) that a
  generic code search will not surface, and re-deriving them from source risks getting them wrong.
- Publishing note for whenever this lands: a prose/behavior change to an existing template is a
  **patch** bump to `plugins/maestro/.claude-plugin/plugin.json` (no new skill/agent/command/hook
  event), per `updating-maestro`'s table.

### Explicitly out of scope for this fix

- The agent-file fix considered and dropped earlier in this discussion (adding concept-skill
  grounding instructions to `backend.md`/`frontend.md`): unnecessary — subagents already get this
  via `SubagentStart` injection + their own file's triage instructions.
- Making `confidence_check` mandatory: a plausible, independent hardening of Step 1, deliberately
  deferred (see "Root cause" above for why it doesn't fully address this failure).
- Whether `@backend`/`@frontend` were actually dispatched for task `063`, and if not, why: unresolved
  — the log doesn't go back far enough to say. Re-open only if independent evidence (not this
  session's log) turns up.

## Ephemeral session state is per-project, not per-session — a concurrent Maestro run clobbers it

**Status:** not implemented — flagged for evaluation in a future session. Confirmed root cause of a
data-loss bug (see below); fix approach not yet decided.

### What happened

Mid-session (task `063`), the repo unexpectedly ended up on branch `feat/create-workflow` with an
unrelated commit (`66ee389`, "docs: create task for tabbed log sessions") underneath this session's
own commits — created by neither this session nor any of its subagents. Flagged to the user at the
time; concluded as "very likely a concurrent session on the same machine" and left as-is per the
user's choice.

Investigating a separate question later (whether `@backend`/`@frontend` had actually run — see the
entry above) turned up direct proof: `.claude/maestro_session.log.jsonl`'s filesystem birth time is
**2026-09-11 14:37:33 -0400**, i.e. it did not exist before that moment — even though this session
had already been running for a long time before then (dozens of tool calls, several subagent
dispatches, per this session's own conversation history). The commit `66ee389` above landed at
**14:37:16 -0400**, 17 seconds earlier. `maestro_session.json`'s birth time (14:49:48) shows the same
pattern for a second file.

### Root cause

`maestro_session.json`, `maestro_session.log.jsonl`, and `maestro_session_tasks.json` are scoped to
the **project** (`<project>/.claude/`), not to a session — see `maestro-architecture`'s file table.
`SessionEnd` unconditionally deletes all three (`maestro-session-cleanup.sh`/`.cjs`). When two
Maestro sessions run concurrently against the same project directory (as happened here — a second
session was apparently working in this same repo checkout at the same time, on a branch of its own),
the *other* session's `SessionEnd` deletes files *this* session was still appending to. The next
write from this session recreates the log from empty, silently discarding everything logged before
that point — no error, no warning, and (confirmed above) the loss is invisible unless someone thinks
to check the file's birth time against known event timestamps.

This directly undermines `/maestro-post-mortem`, which is built entirely on reading this log: a
post-mortem run any time after a concurrent session's `SessionEnd` will silently analyze only the
tail of the actual session, with no indication that earlier history is missing. It also means an
`agent_id` for an agent dispatched before the wipe can no longer be found by
`maestro-resume-target.cjs`'s log scan, which would silently fall back to a cold `Task` instead of
resuming — a real behavioral consequence, not just a diagnostics gap.

### Suggested fix (not yet decided — needs its own design pass)

Options to weigh, not a decision:

- Scope these three files per session (e.g. a session/run id in the filename or a subdirectory)
  instead of per project — biggest change, but the one that actually removes the race rather than
  narrowing it.
- Have `SessionEnd`'s cleanup detect "is another Maestro session still active in this project" before
  deleting — needs a liveness signal that doesn't exist today.
- At minimum, make the loss detectable: stamp each log line's originating `run_id` (already exists —
  see `maestro_session.json`'s `run_id`, added for the channel mechanism) and have
  `maestro-post-mortem.js` warn when the log's earliest entry's `run_id` doesn't match the current
  session's, or when the file's birth time is implausibly late relative to session start.

This is a bigger, riskier change than the Explore-vs-concept-skills fix above (touches multi-session
concurrency, not just orchestrator prose) — worth its own dedicated review rather than folding into
that one.
