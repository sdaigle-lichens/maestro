# Let worktree agents write their channel files without a classifier denial

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

When a task runs in its own worktree, its subagents write their handoff payloads into the main checkout's .claude/channels/, and Claude Code's auto-mode classifier intermittently denies that write as modifying a shared resource (seen in tasks 101, 102 and 137). Today the orchestrator works around it by writing the channel file itself (task 104), which costs a denied call and an extra step per handoff, leaves the file unstamped so the receiver only gets its path, and makes handoff-issues report a stale NO PAYLOAD for a resumed agent whose earlier file still exists. First establish whether an explicit project permission allow rule for writes under .claude/channels/ stops the classifier from judging those writes in auto mode; record what was observed. If it does: have maestro-install and maestro-update add that allow rule to the project's settings (merged idempotently, like the hook registrations), and tell subagents to create a channel file with the Write tool (which creates the folder) rather than mkdir in Bash, in the guidance the SubagentStart hook injects and the orchestrator template. Keep the orchestrator-writes-it fallback for a denial that still happens, and stop handoff-issues from reporting NO PAYLOAD for a resumed agent whose channel file from this run already exists. If the allow rule does not stop the denial, stop after recording the evidence and report it, so a different approach (channels inside the worktree) can be ticketed. Includes the installer change, the injected guidance and template text, the handoff-issues change, regenerated plugin libs if a plugin-entries source changes, tests, this repo's developer skill on channels, and a plugin version bump (patch).

## Acceptance criteria

- [ ] The task records whether an allow rule for .claude/channels/ writes stops the auto-mode classifier denial in a worktree run
- [ ] maestro-install and maestro-update add the allow rule idempotently; running either twice leaves settings unchanged the second time
- [ ] Subagent guidance and the orchestrator template say to write channel files with Write, not mkdir
- [ ] handoff-issues no longer reports NO PAYLOAD for a resumed agent whose channel file from this run exists
- [ ] The orchestrator-writes-it fallback still works when a write is denied
- [ ] If the allow rule does not help, the evidence is reported and nothing else is changed
- [ ] Tests cover the settings merge and the handoff-issues change; the plugin version is bumped (patch) and pnpm verify passes

## Blocked by

None — can start immediately

## Findings: does an allow rule stop the classifier denial? (recorded by @backend)

Result: NOT ESTABLISHED. The denial cannot be observed from this run (main checkout, no worktree), so
nothing was implemented; per acceptance criterion 6 this stops here.

Evidence in hand:
- Tasks 101, 102 and 137 (all worktree runs) show intermittent denials of writes into the main
  checkout's .claude/channels/, on different files with different stated reasons. In 137 both
  `mkdir` (Bash) and the Write tool were denied. This repo's .claude/settings.json has no
  permission allow rule for channels, so none of these runs tested the proposed fix. No run, past
  or present, has ever observed an allow rule in effect.
- Claude Code's documented auto-mode order is allow/deny rules first, classifier only for what is
  left, which suggests an allow rule would bypass the classifier. That is documentation, not an
  observation of this denial.
- Two reasons it may not help here, neither testable from the main checkout:
  1. A project-relative rule such as `Write(.claude/channels/**)` resolves against the session's
     own root, which in a worktree is the worktree, not the main checkout where the denied writes
     land. Matching the main checkout needs an absolute path, which the shared, tracked settings
     file cannot portably carry.
  2. The `mkdir` denial in 137 is a Bash call; a Write rule does not cover it (the Write-first
     guidance would avoid it, but that part only matters if the rule works).

Second run (worktree /home/superadmin/gits/maestro-task-139, branch task-139): STILL NOT ESTABLISHED.
CORRECTION (manager review round 1): the earlier text of this paragraph wrongly said no rule was in
place. The user had added `Write(//home/superadmin/gits/maestro/.claude/channels/**)` to the main
checkout's `.claude/settings.local.json` (line 69) before this run; the worktree's tracked
`.claude/settings.json` has none.
Observed: from the worktree run, a Write of a probe file into the main checkout's
.claude/channels/test/ was ALLOWED on the first try, with that rule in effect (probe removed
afterwards). Consistent with the rule working (allow rules are applied before the classifier), but
the denial is intermittent (tasks 101, 102, 137), so one clean run is not proof; no before/after was
observed. Decision: proceed with the implementation, keep the orchestrator-writes-it fallback.
The portable project-relative form `Write(/.claude/channels/**)` (one leading slash = project root of
the settings file, i.e. the main checkout) is what the installers add; that exact form was not itself
exercised in a run.

Next step: someone must run a worktree task with the allow rule added by hand (absolute path form)
and see whether a subagent's channel write is still denied. If it is, ticket the alternative
(channels inside the worktree).

## Post-Mortem

- **Problem:** @backend's first pass concluded "no rule in place" and stopped as evidence-only, because it did not read `.claude/settings.local.json`, where the user had already added the allow rule. The manager had to redirect (round 1).
  **Fix:** none
- **Problem:** @backend left `maestro-install.js` unformatted (prettier), so `pnpm verify` failed at @test and forced a loop-back and a third manager-review round for a format-only change.
  **Fix:** none
- **Problem:** Claiming 139 was refused for a long time: a claim held under a session name/id that the ended session still held, and `release` correctly refused another session's claim. The worktree only appeared after ticket 140's holder session claimed 140.
  **Fix:** none
- **Problem:** @scribe could not run `extract`/`apply installing-maestro` (code-graph CLI has no `--root` and its shell starts in the main checkout); the stamp for `installing-maestro` is still to do from the worktree.
  **Fix:** none
