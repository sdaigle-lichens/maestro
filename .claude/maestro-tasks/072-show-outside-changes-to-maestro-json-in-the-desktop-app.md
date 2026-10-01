# Show outside changes to maestro.json in the desktop app

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The Maestro desktop app (apps/maestro) does not display changes made to .claude/maestro.json outside the app — for example after /maestro-update or a hand edit. The workflow canvas is seeded once per project (seedWorkflowStore returns early when the projectRoot matches) and nothing watches the file, so the open canvas stays stale.

Design (approved):
- A new core module `src/core/config-watch.ts` exports `watchConfigFile(projectRoot, onChange, intervalMs = 1000): () => void`. It polls and fingerprints the raw file text (same reasoning as tasks.ts/session-log.ts: fs.watch is unreliable with several writers and deletes). It is silent on the first read, fires when the text differs from the last poll, treats a missing or unreadable file as empty (so create/delete also fire), never throws, and returns an unsubscribe.
- Main owns exactly one watcher for the current project, started on project open and restarted in announce() next to retargetTails. It broadcasts a new `configChanged` event to every window (like projectChanged) — no per-window subscribe/unsubscribe. The preload exposes `config.onChanged(cb): unsubscribe`, and the channel is added to the typed contract in src/shared/ipc.ts.
- A ConfigWatchProvider mounted once in __root.tsx beside ProjectProvider calls router.invalidate() on the event, so every loader-based route re-reads data:workflows. Confirm routes/agents.tsx, which fetches data:workflows in a component effect rather than a loader, also refreshes; if not, make it depend on router state.
- workflow-store gains `baseline` (the workflow slice as last known to be on disk) and `externalChange: boolean`, plus a pure `reconcileWorkflowSlice(state, diskSlice)`: disk slice equals baseline → no-op; differs and canvas clean → replace config and baseline; differs and canvas dirty → keep the canvas and set externalChange; disk slice equals the canvas (our own save echoing back) → set baseline and clear the flag. Compare the workflow slice only (agents_available, skills_available, workflow_instances, workflows) so rules or runtimeVersion changes never disturb the canvas. seedWorkflowStore keeps its project-switch reset but calls reconcile for the same project. A successful Save sets baseline to the slice it wrote.
- A dismissible banner when externalChange is set offers Reload from disk (discards edits) or Keep mine (clears the flag until the next disk change; Save then overwrites only the workflow slice).

After the change, update the workflow-view concept skill (Data flow and Things that bite). This touches apps/maestro only — no plugins/ files, so no plugin.json bump and no build:plugin-libs run is needed.

## Acceptance criteria

- [ ] With the app open on a project, editing .claude/maestro.json's workflows outside the app (hand edit or /maestro-update) updates the /workflows canvas within a couple of seconds when the canvas has no unsaved edits
- [ ] When the canvas has unsaved edits, an outside change keeps those edits and shows a banner offering Reload from disk and Keep mine; each does what it says
- [ ] Saving from the app does not trigger the banner or lose edits (own-save echo is recognised), and a change to rules or runtimeVersion alone leaves the canvas untouched
- [ ] Switching projects still resets the canvas to the incoming project's config and the watcher follows the new project
- [ ] /agents and /rules also show the updated config after an outside change
- [ ] test/core/config-watch.test.ts covers edit, create, delete, no-change poll, silent initial read and unsubscribe; a store test covers every reconcileWorkflowSlice case plus the project-switch reset
- [ ] pnpm --filter maestro typecheck and pnpm --filter maestro test pass
- [ ] The workflow-view concept skill describes the new external-change flow

## Blocked by

None — can start immediately
