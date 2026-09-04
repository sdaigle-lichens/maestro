# Start the log tail for a window that subscribed before a project

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`/session-log` is permanently empty for the whole life of a window when the app launched with no
project open. Found while verifying `037`, where it looked like a test-harness quirk; it is a
first-run bug.

### The mechanism

Three pieces in `src/main/ipc.ts`, each correct on its own:

```
startTail(id)          if (!root) { wc.send(logInit, []); return; }   ← returns BEFORE tails.set
tails                  Map<webContentsId, stop>  — "one tail per window"
retargetTails()        for (const id of [...tails.keys()]) { … }      ← only revisits registered ids
```

And in the renderer, `session-log-context.tsx` subscribes once with `[]` deps, on the strength of a
comment that is true only when a tail was registered:

> A project switch is handled in the main process — it retargets the tail and re-emits `init` — so
> there is nothing to re-subscribe to here.

So on a profile with no `current` project:

1. the window mounts, `SessionLogProvider` calls `log.subscribe`, `startTail` runs;
2. `currentRoot()` is null, so it sends an empty `logInit` and **returns before `tails.set`**;
3. the user opens a project — `announce()` → `retargetTails()` → iterates an empty map → nothing;
4. the renderer never re-subscribes.

`/session-log` is then dead until the window is recreated. On the next launch `current` is set, so
the tail starts normally — which is exactly why this has never been reported. It reproduces only on
a first run, or after the open project is forgotten.

### `tails` is being asked to answer two different questions

*"Which windows have a running watcher"* and *"which windows asked for one"* are the same set only
while a project happens to be open. `retargetTails` needs the second and reads the first.

**Separate them.** A `logSubscribers: Set<number>`, added by the `IPC.logSubscribe` handler
**before** it calls `startTail` and removed on unsubscribe/destroy, and `retargetTails` iterates
that instead of `tails.keys()`. `tails` keeps its current meaning — active watchers, one per window,
still stopped-before-started — and the single-owner property in its header comment is untouched.

Do **not** fix this by iterating `BrowserWindow.getAllWindows()` in `retargetTails`. That starts a
watcher for windows that never subscribed, which inverts the "only windows that asked" property the
`tails` comment describes. And do not fix it by registering a no-op stopper in `tails` when `root`
is null: it works, it is one line, and it re-conflates the two questions this slice exists to
separate — the next reader of `tails.keys()` inherits the same trap.

While in there, correct the renderer comment. It is load-bearing (it is the reason the `[]` deps are
safe) and it should say *the main process retargets the tail for every window that subscribed*, not
*for every window with a tail*.

### Files

| File | Change |
| --- | --- |
| `apps/maestro/src/main/ipc.ts` | `logSubscribers`; `retargetTails` reads it; the `logSubscribe` handler and the unsubscribe/destroy path maintain it. |
| `apps/maestro/src/renderer/src/utils/session-log-context.tsx` | The comment justifying `[]` deps. |
| `apps/maestro/test/isolation.test.ts` | Extend `describe("session log tail ownership")` — see below. |

No `plugins/` change, so **no plugin version bump**.

## Acceptance criteria

- [ ] A window that subscribed with **no project open** gets a live tail as soon as a project is
      opened, with no re-subscribe from the renderer.
- [ ] A window that subscribed **with** a project open still gets a tail, and still exactly one —
      the stop-before-start / single-owner behaviour is unchanged.
- [ ] A project **switch** still retargets every subscribed window, and a window no longer streams
      the outgoing project's log.
- [ ] Unsubscribing, and destroying a window, both remove it from `logSubscribers` — a later
      `retargetTails()` neither starts a tail for a dead window nor throws.
- [ ] Nothing starts a tail for a window that never subscribed.
- [ ] `test/isolation.test.ts`'s existing single-subscriber assertion still passes, plus a new
      source-level pin that `retargetTails` does **not** read `tails.keys()` and does **not**
      enumerate `BrowserWindow.getAllWindows()`. This is a source-level guard for the same reason the
      "saving refreshes loader data" block is one: the failure is silent and no render test sees it.
- [ ] `pnpm --filter maestro test`, `typecheck` and `check` green.
- [ ] Reproduced and fixed in a **packaged** window from a genuinely cold profile — an empty
      `projects.json` and no `current` — per `test-maestro`: open a project with
      `window.maestro.project.open()`, then confirm `/session-log` streams. `037` worked around this
      by pre-seeding `projects.json` before launch; **do not** pre-seed here, or the bug is invisible
      and the fix unverified.

## Notes for whoever picks this up

Read `apps/maestro/.claude/skills/log-view/` for the tail's ownership rules, then
`apps/maestro/.claude/skills/test-maestro/` for the CDP harness and its fixture rules.

- **Launch the packaged build, never `dev`.** `dev` serves the renderer over `http://` and skips
  the `file://` path that ships.
- The empty `logInit` on a null root is **correct and should stay** — it is what puts `/session-log`
  into its "No session log found" empty state rather than leaving it blank forever. The bug is the
  missing registration beside it, not the send.
- Check the destroy path specifically. `stopTail` is reachable from more than one place and a
  `logSubscribers` entry that outlives its window is a `retargetTails` that looks up a `webContents`
  that is gone — `startTail` already guards with `if (!wc) return`, so confirm rather than assume.

## Blocked by

(nothing)
