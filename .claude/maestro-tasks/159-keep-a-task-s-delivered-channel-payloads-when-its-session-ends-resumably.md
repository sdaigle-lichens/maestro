# Keep a task's delivered channel payloads when its session ends resumably

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A worker session that is restarted and resumed under the same id loses the hand-off payloads already delivered for its task, so an agent stopped by the restart cannot be re-run from its payload and the sender has to rewrite it. Fix the runtime so a resumable session end keeps the session's own channel scope intact. This is a code change to the runtime's SessionEnd cleanup and the channel sweep, plus tests, the generated plugin libs, the plugin version bump and the runtime mirror refresh.

Observed in the code-graph repo on runtime 0.13.25, task 075, session e49dfef9: the backend to test payload was delivered at 03:14:30 (moved into the scope's consumed folder), the session was restarted while that test run was in progress, and when it resumed at 13:35 under the same session id the scope's consumed folder had lost that file. Backend was re-dispatched at 13:36 to rewrite it.

Cause, from reading the code (to be confirmed by a reproducing test first): SessionEnd keeps the session's state on a resumable end (task 077: `prompt_input_exit`, `other`, `resume`), but the channel sweep that follows still retires the ending session's own scope's consumed folder outright, whatever the end reason. The scope survives in session state while its delivered payloads do not, so nothing is left for the resume path to hand back.

Expected: on a resumable end, the session's own consumed folder is only aged out like every other scope, never retired outright. On a final end it is retired as today. Age-out across all scopes is unchanged, and so is the rule that a session never touches another session's scope. The plugin's bash SessionEnd twin, if it does its own channel cleanup, follows the same rule, so the two cannot disagree.

## Acceptance criteria

- [ ] A test that reproduces the loss fails before the fix: a delivered payload in a session's own scope is gone after a SessionEnd whose reason is resumable.
- [ ] After the fix, a resumable SessionEnd (prompt_input_exit, other, resume) leaves the ending session's own consumed folder in place, subject only to the normal age cap.
- [ ] A non-resumable SessionEnd still retires the ending session's own consumed folder outright, as before.
- [ ] Age-out of every scope, the legacy unscoped layout, and the never-touch-another-session's-scope rule are unchanged and still covered by tests.
- [ ] The project-local and plugin SessionEnd cleanups agree on the rule.
- [ ] A resumed session can re-deliver a payload delivered before the restart to an agent re-run after it, checked by a test or a live run.
- [ ] Generated plugin libs are rebuilt, the maestro plugin's version is bumped, the runtime mirrors are refreshed, the parity test passes, the affected concept-skill notes are current, and pnpm verify passes.

## Touched surfaces

- apps/maestro/src/core/handoff-channels.ts
- apps/maestro/src/core/plugin-entries/maestro-session.ts
- plugins/maestro/scripts/maestro-session-cleanup.cjs
- plugins/maestro/scripts/maestro-session-cleanup.sh
- plugins/maestro/scripts/lib/maestro-session.cjs (generated)
- .claude/scripts mirrors (generated)
- plugins/maestro/.claude-plugin/plugin.json (version)
- .claude/skills/maestro-architecture/sub-concepts/handoff-contract.md
- parallel OK with 158 and the interim-stop task, merge order 158, then this task, then the interim-stop task; each later one rebases, rebuilds the libs and re-bumps the version

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** The ticket assumed the resume path would hand back a kept `.consumed/` payload ("nothing is left for the resume path to hand back"). It does not: resume-target and the cold SubagentStart inject read live lanes only. Round 1 kept the file on disk and passed tests that only checked it existed; the reviewer failed criterion 6, and backend had to add `restoreInterruptedDeliveries` and a `session_end` log line, a larger change than the approved direction review described.
  **Fix:** `to-maestro-tasks` SKILL.md (plugin 0.13.28) now requires a task writer to check existing code a `whatToBuild` relies on, or mark the claim "assumed, unverified".
- **Problem:** The first @test round wrote a resume test that only asserted the file's existence, so it could not catch the missing re-delivery. The orchestrator's prompt asked for re-delivery but did not say a file-exists check was insufficient.
  **Fix:** the project's `.claude/handoffs/backend/test.md` and `frontend/test.md` payload templates now ask for each behaviour to be tested through the code that consumes it, not by a file or state merely existing.
- **Problem:** Each lib change needed the user to run `! pnpm refresh:runtime` (twice this session), because the sandbox can't write `.claude/scripts/`.
  **Fix:** none
