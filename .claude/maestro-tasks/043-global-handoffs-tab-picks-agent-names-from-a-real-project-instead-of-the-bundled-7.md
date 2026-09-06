# Global Handoffs tab picks agent names from a real project instead of the bundled 7

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The /templates Handoffs tab's "New route" sender/receiver dropdowns currently only offer Maestro's 7 bundled agent names (backend, frontend, mobile, refactor, reviewer, scribe, test), because the page has never had any project open to read a real agent list from. Give the tab a way to pick a project (reusing the exact pattern /tools already uses for its own project picker: purely local view-state, never the app's globally-open project — selecting a project here must not end the live session, retarget the log tail, or otherwise touch what /agents, /workflows etc. consider the open project) and, once one is picked, source the dropdown options from that project's real configured agent list instead of the bundled names. Until a project is picked, disable the "New route" create control rather than falling back to the bundled list or a free-text input — there is a real, already-existing function elsewhere in the codebase that reads a project's configured agent list given its root; reuse it via a new thin read-only round trip rather than reimplementing the read. This only changes how NEW global-default routes get authored going forward — existing shipped and user-created global handoff rows, their listing, editing, saving, resetting to default, and deleting must all keep working exactly as before.

## Acceptance criteria

- [ ] With no project picked in the Handoffs tab, the "New route" Create control is disabled and the bundled 7-name list is not offered as the dropdown source.
- [ ] Picking a project populates the sender/receiver dropdowns with that project's real configured agent names, and creating a route with them works end-to-end (the new route is saved to the existing global handoff-defaults store exactly as creating one with a bundled name did before).
- [ ] Picking a project in this tab does not end the live session, does not retarget the session log tail, and does not change which project any other route (e.g. /agents, /workflows) considers open.
- [ ] Existing shipped and user-created global handoff rows — the left-hand list, selecting one, editing its body, Save, Reset to default (for shipped rows), and Delete (for user-created rows) — are unaffected by this change.
- [ ] No change is needed to any apps/maestro/src/core/plugin-entries/*.ts module or its generated plugins/maestro/scripts/lib/*.cjs twin for this task; confirm this while implementing rather than assuming it, and run the plugin-libs build only if it turns out something under plugin-entries was actually touched.
- [ ] Existing tests for the Handoffs tab and its IPC channels continue to pass, and a new test covers: the dropdown is disabled/empty with no project picked, and populated with that project's real agents once one is picked.

## Blocked by

None — can start immediately
