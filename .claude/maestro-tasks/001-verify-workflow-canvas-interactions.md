# Verify workflow canvas interactions and resolve the mounted flag

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Close the last open item from the M1/M2 review (`docs/plans/review-m1-m2-outcome.md`, item 9).
The desktop app now launches, every route renders in a packaged build, and the bundled subagents
resolve — but the workflow canvas was moved over from the web app verbatim and its *interactions*
have never been exercised in a running window. Rendering without going blank does not prove
React Flow measures correctly, and it does not prove dagre produces a sane layout.

Exercise the canvas in the running app and fix whatever is broken, then settle the `mounted` flag
it still carries.

The flag is an SSR guard from the web app. Electron has no SSR, so the stated reason is dead, but
it has a live side effect: it defers React Flow's first render by one commit, so the container has
real dimensions before React Flow measures it and before dagre lays out a workflow that has no
saved node positions. Whether React Flow still needs that is an empirical question about a
rendered window, which is why it was left in place rather than deleted on sight. Decide it with
evidence: remove it and confirm first paint and layout are still correct, or keep it and replace
the comment with the specific behaviour that breaks without it.

Use a project with no `.claude/maestro.json` for part of this — that path also shows the "starter
configuration, not saved" banner, which has not been seen in a running window either.

## Acceptance criteria

- [x] A workflow whose nodes have no saved positions lays out sensibly on first open — nodes are
      not stacked at the origin and not overlapping
- [x] Switching between workflows re-fits the view without visible thrash, and the debounce does
      not fire against the outgoing workflow
- [x] Dragging a node persists its position: the node is where it was left after save, close, and
      reopen
- [x] The condition-edge label editor opens, accepts a label, and the label survives a save/reopen
      round trip
- [x] Opening a project with no `.claude/maestro.json` shows the seeded banner on `/workflows`,
      and it disappears after a save
- [x] The `mounted` flag is either removed (with first paint and layout confirmed unaffected) or
      kept with a comment naming the concrete behaviour that regresses without it — not the dead
      SSR rationale
- [x] Anything found broken is fixed, or recorded in the review outcome doc with a decision
- [x] `pnpm --filter maestro typecheck`, `pnpm --filter maestro test`, and
      `pnpm --filter @repo/maestro-core test` all pass

## Blocked by

None — can start immediately
