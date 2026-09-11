# App-level multi-session log view

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`064` gives every Claude Code session its own state directory under
`<project>/.claude/maestro_sessions/<session_id>/`. The desktop app's `/session-log` still assumes
exactly one log per project and exactly one project at a time: `tailSessionLog(projectRoot, …)`
reads a single fixed path, `SessionLogProvider` holds a flat `entries[]`, and a project switch
retargets the tail so the previously-open repo's session simply disappears.

Widen it in both dimensions at once. The view should show **one tab per live session across every
project the app knows about**, not just the open one — a user running Maestro in two checkouts
should see both without switching projects. Discovery walks the current project plus the
recent-projects list (`getState()`, capped at 10) and reads each one's `maestro_sessions/`
directory; a project whose directory is absent contributes nothing and costs one failed `readdir`.

Tabs are grouped by project, labelled by the session's start time, with the project's name shown on
the group rather than repeated per tab. A session's start time is the earliest entry's `ts` (or the
directory's own creation time when the log is still empty). No richer label is reliably available
this early — `session.json`'s `workflow` is written at Step 2, so treat a workflow name as an
enrichment that appears when it appears, never as the label's basis.

**Keep one poll loop per window.** The existing tail is a single `setInterval` per subscribing
`webContents`, and `log-view`'s "exactly one poll loop no matter how many routes are mounted" is a
deliberate property — do not spawn a watcher per session or per project. One timer owns a
`Map<projectRoot, Map<sessionId, lineCount>>`, re-reads what it is tracking each tick, and emits:

- a session's log file appearing → `init` for that session
- new lines → `entry` for that session
- the file or directory disappearing → `end` for that session
- a shrink → `end` then `init`, the existing resync

The IPC contract widens rather than being replaced: `logInit` and `logEntry` gain a `sessionId` (and
a `projectRoot`), `logEnd { projectRoot, sessionId }` is added, and `logReset` narrows to mean "drop
everything, the target changed wholesale". `SessionLogProvider`'s `entries: SessionLogEntry[]`
becomes a keyed map; `buildInstances` is called **per tab** and is otherwise untouched, so instance
segmentation, dispatch/handoff/`channel_delivery` correlation and the `ctx_pct`/`ctx_model`/`phase`
fields all render exactly as they do today — just scoped to one session's own entries instead of a
project's undifferentiated stream.

**An ended session keeps its tab, greyed and labelled `ended`.** Removing the tab the moment
`SessionEnd` deletes the directory yanks the log away exactly when someone has opened the app to
read why a run failed — and with sibling tabs still present it reads as a crash rather than as a
session ending. The entries are already in the renderer; retention costs nothing. Drop an ended tab
on: the user closing it, a project being forgotten, or app restart. Cap retained ended tabs (3 is
enough) and drop the oldest, so a long-running app window does not accumulate them.

Pick a sensible default tab — the most recently active live session — and keep the user's selection
stable as other tabs come and go. A tab appearing or ending must never move the selection.

Since discovery is no longer scoped to the open project, `resolveProjectRoot`'s existing discipline
applies: a project root arriving from the renderer is honoured only when it names the current
project or one from the recent list, and degrades silently to the open project otherwise. Discovery
itself reads only roots already in that same allow-list — never an arbitrary path.

**Out of scope:** the tail still re-reads each tracked file whole on every tick, as it does today;
with several sessions in play that is more I/O than before, but the read is cheap and incremental
tailing by byte offset is a separate change. No new empty state is needed beyond "no live sessions
in any known project".

## Acceptance criteria

- [ ] `/session-log` shows one tab per live session across the current project **and** the recent
      projects list, grouped by project, without the user switching projects.
- [ ] Each tab live-tails only its own session's entries; entries from one session never appear in
      another's tab.
- [ ] Instance segmentation, dispatch/handoff/`channel_delivery` correlation, and the
      `ctx_pct`/`ctx_model`/`phase` fields render unchanged within a tab.
- [ ] A session ending greys its own tab and labels it `ended`, retaining its entries; every other
      tab and its contents are untouched, and the selected tab does not change.
- [ ] Retained ended tabs are capped, oldest dropped first, and are cleared on app restart.
- [ ] Exactly one poll loop runs per subscribing window regardless of how many projects and sessions
      are being tracked, and the single-owner subscription discipline still holds — the
      `test/isolation.test.ts` pin on the one `log.subscribe` call site still passes.
- [ ] Discovery reads only project roots in the current-plus-recent allow-list; an unrecognised root
      from the renderer degrades to the open project rather than being read.
- [ ] Test coverage includes: a second session's directory appearing adds a tab and emits nothing
      for the first; one session's directory disappearing emits `end` for it alone; interleaved
      appends across two sessions in two different projects each reach their own tab; and a project
      absent from disk contributes no tabs and no throw.

## Blocked by

- 064-per-session-maestro-session-state.md
