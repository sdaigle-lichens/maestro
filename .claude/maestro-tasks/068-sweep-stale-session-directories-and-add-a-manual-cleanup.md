# Sweep stale session directories and add a manual cleanup

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Session directories under .claude/maestro_sessions/<id>/ are only removed by the SessionEnd hook (removeSessionState). A session that ends without SessionEnd (crash, kill, terminal closed hard) leaves its directory forever; nothing sweeps orphans, and its greyed tab lingers in the Session Log view. In this repo a directory from Sep 12 is still present. Add a sweep that runs when the desktop app starts and removes directories for sessions that are no longer live, and a manual clean-up button on the Maestro Tasks screen that runs the same sweep and reports what it removed. It must never delete a live session's directory (including sessions belonging to other projects' running Claude processes) — decide and document how liveness is determined (e.g. recent writes to the session log, or claims), and treat 'cannot tell' as live. The sweep logic belongs in src/core, framework-free and tested against temp projects.

## Acceptance criteria

- [ ] On app start, directories of sessions with no live process/recent activity are removed; live sessions' directories are untouched
- [ ] A clean-up button on the Maestro Tasks screen runs the same sweep and shows how many directories were removed
- [ ] An ambiguous case is treated as live and never deleted
- [ ] Core sweep logic has real tests against temp project directories, with HOME and CLAUDE_CODE_SESSION_ID pinned
- [ ] The session-log view no longer shows a tab for a swept session after a reset
- [ ] pnpm --filter maestro typecheck and pnpm --filter maestro test pass

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** Task text put the clean-up button on the Maestro Tasks screen; the user wanted it on the Session Log page, so it was built, then removed and moved.
  **Fix:** none
- **Problem:** Tab bar listed the open project twice (current + recent roots), so sessions showed as duplicate tabs that selected together. The task's tab work shipped with the bug.
  **Fix:** none
- **Problem:** The task's scope missed that ended tabs need a delete (x) endpoint, and that a crashed session's tab stays "live" forever; required extra backend + frontend rounds, plus tab redesign, contrast, visible x and `claude --resume` titles.
  **Fix:** none
- **Problem:** Preload changes only apply after a full app restart; the stale preload showed as a missing title and "reading 'delete'" error.
  **Fix:** none
