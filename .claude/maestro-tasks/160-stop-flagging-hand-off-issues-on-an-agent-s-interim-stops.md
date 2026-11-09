# Stop flagging hand-off issues on an agent's interim stops

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The SubagentStop hand-off check records a hand-off issue every time a workflow agent stops interim, for example to wait on background work, before it is resumed and finishes. Each flag is false, but the orchestrator reads them back and someone has to check timestamps to dismiss them. Fix the check so it flags only a real missing or malformed hand-off. This is a code change to the SubagentStop hook's hand-off and payload checks, plus tests, the generated plugin libs, the plugin version bump and the runtime mirror refresh.

Observed in the code-graph repo on runtime 0.13.25, task 075, session e49dfef9, two false modes, both on resumed runs of the same agent:
- `missing`: an interim stop with no HANDOFF line is flagged as having none (backend agent a7d80d9d at 02:33, 02:39 and 03:06; reviewer agent a66e4858 at 13:51, which then finished with `success` at 13:55).
- `missing_payload`: the final stop says `success`, but the payload was written during an earlier stretch of the same run, before the latest resume, so the check measured from the latest dispatch misses it (backend a7d80d9d at 02:36, 02:42 and 03:14). Task 153 only exempts a resumed run that changed no file.

First decide how to tell an interim stop from a final one: from the SubagentStop hook input, if Claude Code provides a usable signal, or by deferring the judgement until the run's final stop. Then measure the payload check from the start of the whole agent run, across resumes, not from the latest dispatch. A real missing HANDOFF line on a final stop, a malformed line, a route the workflow has no edge for, and a payload truly never written must still be flagged.

## Acceptance criteria

- [ ] Tests reproduce both false modes before the fix, using the observed sequences: interim stops with no HANDOFF line, and a final success whose payload was written before the latest resume.
- [ ] An interim stop records no hand-off issue in session state and shows none in the session log.
- [ ] A final stop with no HANDOFF line, a malformed or mismatched verdict, an unknown route, or a payload never written during the whole run is still flagged.
- [ ] The payload check counts a payload written at any point in the agent's run, across resumes, while a file left from an earlier run of the same agent still does not count.
- [ ] The chosen interim-stop signal and its limits are written in the hand-off concept notes.
- [ ] Generated plugin libs are rebuilt, the maestro plugin's version is bumped, the runtime mirrors are refreshed, the parity test passes, and pnpm verify passes.

## Touched surfaces

- apps/maestro/src/core/handoff-check.ts
- apps/maestro/src/core/handoff-payload.ts
- apps/maestro/src/core/plugin-entries/maestro-session.ts
- plugins/maestro/scripts/maestro-subagent-log.js
- plugins/maestro/scripts/lib/maestro-session.cjs (generated)
- .claude/scripts mirrors (generated)
- plugins/maestro/.claude-plugin/plugin.json (version)
- .claude/skills/maestro-architecture/sub-concepts/handoff-contract.md
- base: current main (0.13.32 or later; 158 and 159 are merged)
- parallel OK with 163, 164 and 166; merge before 165, whose post-mortem digest must respect this task's interim-stop signal; whichever lands later rebases, takes the next patch version and rebuilds generated files instead of hand-merging

## Direction (manager, after escalation m004; user decision 2026-11-08)

The user chose option 2: a final stop with no HANDOFF line must still be flagged, including one
that ends in plain text without a hand-back call and an agent that stops once and is never
resumed. Interim stops must still not be flagged. How to tell them apart (for example deferring
the judgement until the run's final stop) is the design step's call. The `interim: true` log
marker and its documentation stay, for task 165.

## Blocked by

None — can start immediately
