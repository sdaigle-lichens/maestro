# M1/M2 review outcome

Item 9 (task 001): workflow canvas interactions verified in the packaged build (`out/`, launched
over CDP, fixtures under `~/gits/maestro-001-*`).

## Verified

| Check | Result |
| --- | --- |
| No saved positions, first open | dagre lays out one column at x=0, y=0/140/280/420. No overlap, 0 stacked frames, 0 zero-size container or node frames. |
| Workflow switch | New nodes mount on the first frame, then exactly one re-fit (~50 ms later). No viewport change happens while the outgoing workflow's nodes are mounted. |
| Node drag | Persisted to disk and restored on reopen (backend probe). |
| Condition-edge label | Click the label: side panel opens, typing updates the label live, Save writes it to `maestro.json`, reopen shows it. The old `edit label` modal no longer exists. |
| No `.claude/maestro.json` | Starter banner shown on `/workflows`, gone after Save, file created. |

## Decisions

- **`mounted` flag: already gone.** No such flag exists in `workflow-canvas.tsx` or `workflows.tsx`.
  First paint measured without it: 0 zero-size container frames, 0 zero-size node frames. Nothing to
  keep or comment.
- **`main-session` x mismatch: fixed.** It is synthetic and never persisted, so with saved positions
  it stayed at (0,0) while dagre had put it above the first step. `alignMainSession` now places it at
  the first step's x, 140px above. Checked: saved backend at x=65 gives main-session at (65,0).
- **Debounce: hardened.** `FitViewEffect` now clears its pending timer on a newer switch or unmount,
  so a stale fit cannot run against a replaced workflow. Behaviour in the measured single-switch case
  is unchanged.
- **Criterion 8, third command:** `pnpm --filter @repo/maestro-core test` matches no project. That
  package was folded into `apps/maestro` (task 010). Not a failure; the `maestro` suite covers it.

## Not fixed

- Nothing outstanding. The stale edit-label modal description in `canvas-interactions.md` was rewritten to the condition side panel.
