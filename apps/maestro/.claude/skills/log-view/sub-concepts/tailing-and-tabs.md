# Tailing and the tab state machine

How the main process discovers session logs across projects, and how the renderer folds the resulting
events into the tab bar.

## Which log file (`064`, resolution model since `065`)

Before `064` "the project's log" was one fixed path. `064` gave every Claude Code session its own
permanent `maestro_sessions/<session_id>/log.jsonl` (via `sessionPathsFor`). `065` changed which
function the *live* `/session-log` route uses to walk them.

**The live route no longer resolves "the" file — it walks all of them.** `tailSessionLogs`
(`src/core/session-log.ts`) is what `startTail` (`src/main/ipc.ts`) actually calls. It tracks a
`Map<projectRoot, Map<sessionId, lineCount>>`, keyed by each session's own permanent
`(projectRoot, sessionId)` identity — not by a resolved path that can point at a different session
between polls.

`sessionLogFileFor(projectRoot, sessionId?)` **still exists** in `src/core/session-log.ts`, together
with the single-session `tailSessionLog` built on it (mtime-based `newestSessionLog()` fallback when
called with no id). Both are exercised by `test/core/session-log.test.ts` for differential coverage, and
both are still exported from `src/core/index.ts` — but neither is in the call path of the live
`/session-log` route any more. Don't "fix" the live route by routing it back through
`sessionLogFileFor`; that reintroduces exactly the single-session assumption `065` removed.

**`lineCount` is a position in a file, not in a path — this is why the legacy single-session tail needed
a guard that `tailSessionLogs` does not.** `tailSessionLog`'s poll loop diffs a line count against the
previous read; when the mtime-resolved path flipped to a *longer* sibling session's log,
`entries.slice(lineCount)` of the new file was emitted as an append to the previous session's entries —
one session's head spliced onto another's tail, with nothing about it looking wrong. `tailSessionLog`
guards this by tracking `currentFile` alongside `lineCount` and treating a path change exactly like a
truncation (`reset` + `init`, `lineCount` back to 0). `tailSessionLogs` needs no such guard: each
`(projectRoot, sessionId)` key's file identity never changes underneath it, so a flip can't happen. Any
future reader that caches a position by path rather than by permanent session identity reintroduces this
bug.

## The tail itself

- **The tail polls, it does not `fs.watch`.** Main uses `setInterval` + a read + a line-count diff. Watch
  APIs are unreliable across editors that write via rename and across network/virtualised filesystems,
  and the hooks append constantly enough that a poll is cheap. The tail lives in main, so exactly one
  poll loop runs no matter how many routes are mounted.
- **The log path comes from the current-plus-recent project list, not `process.cwd()` — and since `065`
  it is not scoped to a single open project at all.** `allowedProjectRoots()` in `main/ipc.ts`
  (`state.current` plus `state.recent`) is what both `resolveProjectRoot` and the tail's own discovery
  call read; a session in ANY of those roots gets a tab, not only the currently-open one. The app's own
  cwd is irrelevant and always wrong here.
- **`window.maestro.log.subscribe` is single-owner — for the MAIN-checkout stream only.** Main keeps one
  tail per `webContents.id` in `tails` and stops the old one before starting a new one — so a second
  subscriber _steals_ the tail, and the first unsubscribe then stops it for both. The owner is
  `SessionLogProvider`; every other consumer reads from it with `useSessionLog()`. A test pins the call
  site to that one file. Worktree tabs (`075`) are a second, separate stream — see
  [Worktree tabs](#worktree-tabs-075) below; "one tail per window" is no longer true of the app as a whole.
- **The `tails` tail is retargeted on a project switch**, in `main/ipc.ts`. Without that, discovery would
  eventually catch up on its own next poll, but the retarget avoids up to one interval of staleness. The
  worktree-tab registry is **not** retargeted — that is its point.
- **`tails` and `logSubscribers` answer two different questions, and `retargetTails` needs the second
  one.** `tails` (`Map<webContentsId, stop>`) is "which windows have a running watcher"; `logSubscribers`
  (`Set<number>`, `038`) is "which windows asked for one". They're the same set only while a project is
  open — a window that subscribes with no project open gets an empty `logInit` and `startTail` returns
  before ever touching `tails`, so `retargetTails` iterating `tails.keys()` would never revisit it once a
  project opened, leaving `/session-log` dead for that window's whole life. `logSubscribe` adds to
  `logSubscribers` *before* calling `startTail`; both `logUnsubscribe` and the window's `destroyed`
  listener remove from it. `retargetTails` reads `logSubscribers`, never `tails.keys()` and never
  `BrowserWindow.getAllWindows()` (the latter would start a tail for a window that never subscribed at
  all).
- **This same shape — main-process poller, `subscribe`/`unsubscribe` push channel, single-owner-per-window
  tail, retargeted on project switch — was deliberately duplicated (not shared) for the
  `/maestro-tasks` route's live refresh.** `tailTasks` in `apps/maestro/src/core/tasks.ts` and the
  `tasks:subscribe`/`tasks:unsubscribe` channel are their own implementation, poll-based for the same
  `fs.watch`-is-unreliable reason. Unlike this route's app-wide `SessionLogProvider`, the tasks tail is
  subscribed route-locally from `maestro-tasks.tsx` — only that screen reads live task data. See
  `task-queue` (repo root `.claude/skills/`) for the task side.

## Worktree tabs (`075`)

A session Maestro runs in a git worktree (`074`) logs inside that worktree. The page now has a **top-level
tab bar** (`WorktreeTabBar`): "Main checkout" plus one tab per linked worktree of the open project that has
a session log. Each view renders its own `SessionLogPanes` (the session tab bar + three panes, extracted
from `session-log.tsx`), so selection and active step are per view.

**Viewing roots.** `allowedProjectRoots()` (current + recents) is unchanged. A worktree is a *separate*,
deliberately recognised class of root: `resolveWorktreeRoot(openProject, requested)`
(`src/core/worktree-list.ts`) accepts a path **only if `git worktree list` names it as a linked worktree of
the open project** (`samePath`, symlink-safe) and returns the path as git spells it. Anything else — relative,
non-string, the main checkout, a path git doesn't list, no open project — is `{ok:false}` and starts nothing.
**There is no fallback to the main log**: that would show another run under the wrong tab. Hand-made
`git worktree add` trees qualify exactly like Maestro's; nothing reads Maestro's pointer files for listing.

**One tail per (window, tab).** `createWorktreeTabs` (`src/core/worktree-tabs.ts`) is a registry; each tab is
its own `tailSessionLogs` over `[worktreeRoot]` plus a state timer. Main keeps `worktreeTabs: Map<webContentsId,
WorktreeTabs>` in `main/ipc.ts`, **apart from `tails`/`logSubscribers`**, so `retargetTails` (project switch)
and `log:reset` cannot reach it. `open(path)` is validated against the open project *at call time* and is
idempotent: a tab opened before a switch keeps streaming, but cannot be re-opened after it. Closed by
`worktree-log:close`, window `destroyed`, or `disposeIpc`.

**Don't double-show a session: `skipSession`.** `tailSessionLogs` takes an optional 4th arg
`skipSession(projectRoot, sessionId)`; a skipped session is simply not live there (no `init`, no `end`).
`startTail` passes one that skips a main-project session whose `worktree.json` pointer
(`readWorktreePointer`) points at a worktree this window has a tab open for, so it appears once, under the
tab. Because the answer changes when a tab opens/closes, `worktree-log:open`/`close` call `startTail` to
rebuild the main tail (`logReset` + `init` burst).

**Tab states** (`WorktreeTabState`, pushed on `worktree-log:state`, also once on open): `live` (≥1 session
tailed), `no-log` (worktree exists, no session log), `removed` (directory gone, or git no longer lists it as
linked — directory checked every tick, git every `gitCheckMs`=5s; an *empty* git answer is "failed", never
"removed"). A removed tab's root list becomes `[]`, so its tail ends every session it showed. The renderer
shows explicit notices (`worktree-removed`, `worktree-no-log`, "Opening…" while `pending`) — never another
tab's log — and offers close for removed ones.

**Renderer: `WorktreeLogProvider`** (`worktree-log-context.tsx`, mounted in `__root.tsx` inside
`SessionLogProvider`) is the worktree analogue of `SessionLogProvider`: it subscribes via
`window.maestro.worktreeLog.subscribe` **before** any `open` (init events fire synchronously during `open`),
polls `worktreeLog.list()` every 7s, and opens each listed worktree with `hasLog`. State is
`Map<root, WorktreeTab>` folded by pure `reduceWorktreeTabs`, whose sessions reuse `reduceSessionLog` with
`projectRoot = worktree root`. Traps:
- **`listed` only ever adds tabs, never removes** — after a project switch the list describes the *new*
  project, and an already-open tab must survive. Only `closed` / `open-failed` (pending tabs only) remove.
- **Do not have worktree events share `log:*` channels or `onReset`.** `log:reset` means "drop everything"
  for the main stream; routing worktree tabs through it would silently kill them on every project switch.
- A closed-but-still-listed worktree stays in the `opened` set so polling doesn't re-add it; roots git stops
  listing are forgotten so a worktree re-added at the same path reopens.

## `reset` vs `end` — the two ways tabs disappear

- **`reset` event on SessionEnd.** When the JSONL file disappears (its session's directory deleted by
  `maestro-session-cleanup.sh`), the server emits `reset: {}` and `lineCount` drops to 0. The provider
  clears `entries`, the page shows the empty state. A new session's `init` event re-fills it. This is the
  normal SessionEnd → new session cycle without a page reload.
- **A project being forgotten never fires a per-session `onEnd` — it forces a full `logReset` + fresh
  `onInit` burst, and a `log.subscribe` consumer must not try to tell the two apart.** `announce()`
  (called from the `project:pick`/`project:open`/`project:forget` handlers) runs
  `broadcast(projectChanged)` → `retargetTails()` → `retargetTaskTails()` → `clearInvocations()` →
  `endAllSessions()`, in that order. `retargetTails()` calls `startTail()` again for every subscribed
  window, and `startTail()` unconditionally sends `IPC_EVENTS.logReset` *before* rebuilding its
  `tailSessionLogs` watcher — so every tab this window was showing (including one whose project just got
  forgotten) disappears via the wholesale reset, and the `init` burst that follows repopulates only
  what's still in `allowedProjectRoots()`. Treat `onEnd` as always meaning "this one session ended, keep
  the tab and grey it out" and `onReset` as always meaning "wholesale rebuild, drop everything, an init
  burst is about to repopulate it" — a consumer never needs to cross-reference the current/recent project
  list to distinguish "session ended" from "project forgotten" itself. (This covers the main stream only;
  worktree tabs survive it by design — see Worktree tabs.)

## The renderer fold (`session-log-context.tsx`)

- **`reduceSessionLog` and `pickSelection` are the two pure functions worth knowing, and both are
  unit-testable without Electron.** `reduceSessionLog(sessions, event, now?)` is the whole state machine
  — `reset` clears the map, `init` creates a `status: "live"` record, `entry` appends (a no-op if the
  session isn't tracked — defensive), `end` marks it ended and enforces the retention cap below.
  `pickSelection(sessions, currentKey)` keeps the currently-selected tab selected if it still exists,
  otherwise falls back to the most recently active LIVE session, then the most recently active of any
  status, then `null` — this is what keeps the selected tab stable across unrelated `entry`/`init` events
  instead of jumping around on every push.
- **Ended sessions are retained, not dropped — but only up to `MAX_RETAINED_ENDED = 3`, globally.**
  `reduceSessionLog` marks a session `status: "ended"` with `endedAt: now()` on its `end` event rather
  than deleting it, so `SessionLogTabs` can render it dimmed with an "(ended)" label and a delete ✕ (the ✕ is not ended-only: it also shows for any session in `sessions:deletable`, since a crashed session never emits `end`; it deletes the directory via `sessions:delete`, and success arrives as the normal `reset`/`init` burst).
  Past 3 ended records *across all projects*, the oldest by `endedAt` is evicted on every `end` — not per
  project. A `logReset` (project forgotten, project switch) drops every record, ended or not, since it
  rebuilds the whole map from scratch.
- **`firstSeenAt` is a proxy for session-creation time, not the real thing.** Nothing in the IPC contract
  exposes the session directory's own creation time (see `SessionLogInitEvent`), so
  `SessionRecord.firstSeenAt` is stamped from `Date.now()` on the renderer when its `init` event arrives.
  Usually indistinguishable in practice — `tailSessionLogs` polls at most a second behind the file
  appearing — but it is a receipt time, not a filesystem mtime, and drifts further under a slow/blocked
  renderer.
- **`pickSessionTitle` / `sessionTitle` / `orderSessions`** (same file) are pure too: title = backend title (task name > `claude --resume`) else derived from the first dispatch; `orderSessions` dedupes by `sessionKey` and sorts by project rank then start time.
- **Live stream is app-wide.** `SessionLogProvider` mounts in `__root.tsx`, so the subscription is
  maintained on every page. Entries accumulate in context even while the user is on `/workflows` or
  `/rules`; `/session-log` sees the full current state when you navigate to it.
- **There is no loader; the first paint is empty.** The provider starts with `entries: []` until main's
  `init` push arrives, so navigating to the route shows a brief empty state — acceptable for a debugging
  tool, and the alternative is a loader that races the subscription.
