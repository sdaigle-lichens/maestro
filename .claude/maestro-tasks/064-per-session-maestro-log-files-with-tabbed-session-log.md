# Per-session Maestro log files with tabbed /session-log

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Each Claude Code session that runs Maestro hooks currently shares one fixed maestro_session.log.jsonl file per project, which two concurrent sessions overwrite/interleave into and either one's SessionEnd can delete out from under the other. Give each session its own log file instead, keyed by that session's own session_id under .claude/maestro_sessions/. SessionEnd must clean up only the ending session's own file, never a sibling session's. Every hook writer that already receives session_id on its payload (the ordinary tool-call log, subagent dispatch/handoff/transition log, and channel-delivery injection) should write to that session's file automatically; the two Step 1/Step 4 gate scripts, which run with no stdin at all and so have no session_id available (the same root cause that already keeps them from stamping ctx_pct), should keep today's accepted limitation and simply skip writing their phase marker when there is no session to attribute it to, rather than guessing.

The desktop app's /session-log view should discover every currently-live session log file for the open project and render one tab per session, live-tailing each independently. Existing per-tab rendering — instance segmentation, dispatch/handoff/channel_delivery correlation, and the ctx_pct/ctx_model/phase fields already written into entries — stays exactly as it behaves today, just scoped to one session's own entries rather than the whole project's undifferentiated stream. A session ending should remove just its own tab, not disturb any other open tab. A sensible default tab (e.g. the most recently active session) should be selected automatically; a tab's label can be as simple as a formatted start time, since no richer session label (workflow/agent name) is reliably known this early.

This touches the plugin's hook scripts and the generated plugin-entries bundle they require — keep the generated .cjs bundle in sync via the project's build:plugin-libs step, keep the plugin's marketplace-cache and project-local script copies consistent per the project's own update mechanism, and bump the plugin's own version to reflect the shipped behavior change.

Out of scope for this task, deliberately deferred: maestro_session.json (the workflow/run_id state file) has the identical single-file-per-project defect this task fixes for the log, but is not part of this change. No garbage-collection policy for orphaned per-session log files left behind by a session that crashes without SessionEnd firing is needed either — acceptable to ship without one.

## Acceptance criteria

- [ ] Two Maestro-orchestrated terminal sessions running concurrently against the same project produce two independent log files; neither session's SessionEnd deletes or truncates the other's file.
- [ ] The /session-log view shows one tab per currently-live session for the open project, each live-tailing only its own entries; a session ending removes just its own tab and leaves other open tabs and their contents untouched.
- [ ] All existing single-session log-view behavior — instance segmentation, dispatch/handoff/channel_delivery correlation, and the ctx_pct/ctx_model/phase fields already stamped on entries — renders unchanged within a tab.
- [ ] The two Step 1/Step 4 gate scripts continue to run under their existing one-line-stdout/no-stderr/exit-0 contract unmodified, and simply skip their phase-marker write when no session_id is available rather than writing to a wrong or shared file.
- [ ] Any plugin hook script or generated plugin-entries changes are rebuilt into the plugin's generated bundle, both the plugin marketplace copy and the project-local installed copy stay consistent, and the plugin's version is bumped to match the scope of the behavior change.
- [ ] Test coverage includes: a hook payload with no session_id producing no log write; an unsafe/path-breaking session_id being rejected rather than used as a filename; multi-file discovery correctly adding and removing tabs as session log files appear and disappear; and the existing single-tail-per-window ownership discipline still holding with multiple sessions in play.

## Blocked by

None — can start immediately
