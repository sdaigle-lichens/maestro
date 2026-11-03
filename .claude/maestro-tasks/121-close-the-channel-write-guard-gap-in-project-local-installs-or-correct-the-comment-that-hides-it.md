# Close the channel write guard gap in project-local installs, or correct the comment that hides it

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 120's report (r014, .claude/epics/code-graph-cutover/inbox/) found that `apps/maestro/src/core/install.ts:319-326` says HOOK_REGISTRATIONS 'mirrors the plugin's hooks.json one-for-one'. That isn't true. `plugins/maestro/hooks/hooks.json` registers `maestro-channel-write-guard.js` (PreToolUse, Write|Edit|MultiEdit|NotebookEdit, added in ec72705 / task 078), but the guard is in neither HOOK_SCRIPTS (install.ts:139) nor HOOK_REGISTRATIONS (install.ts:337), so it is never copied into or registered in a project.

This may be a real gap, not just a stale comment. Per `.claude/skills/maestro-architecture/sub-concepts/hooks.md`, the reviewer and refactor agents no longer carry `disallowedTools`, and this guard is the only thing confining their writes to `.claude/channels/`. It also confines team-meeting participants, and blocks worktree-run writes into the main checkout (task 082). So a project whose Maestro hooks come only from the project-local install (the desktop app's /maestro route or /maestro-install), without the maestro plugin enabled, may run reviewer/refactor unconfined.

Step 1, decide with evidence. Can reviewer/refactor (and meetings and worktree runs) run in a project with the project-local install and the plugin disabled? Check where those agent definitions come from in that setup (plugin agents vs project/user copies), and whether anything else blocks them. Write the answer in the report with file:line references.

Step 2a, if they can run unconfined: register the guard in the project install.
- Add `maestro-channel-write-guard.js` to HOOK_SCRIPTS (copied as .cjs; its `require('./lib/maestro-session.cjs')` is already in STATIC_ASSETS).
- Add its PreToolUse registration with the same matcher to HOOK_REGISTRATIONS.
- Check the plugin-vs-project arbitration (the updating-maestro skill) so both copies firing at once is handled like every other dual-registered hook.
- Add an install test proving the guard is copied and registered, and that a real reviewer Write outside `.claude/channels/` is denied in a project-local install.
- Fix the comment, then rebuild the libs and mirrors, run the parity test, and bump the maestro plugin's patch version (plugin-publishing rule).
- Note that changing HOOK_REGISTRATIONS changes the runtime identity hash (install.ts:603), so existing projects will be told to re-install. Say so in the report.

Step 2b, if they can't run without the plugin: only correct the comment to name the plugin-only exception and why it's safe, and add a test pinning that hooks.json minus the documented plugin-only set equals HOOK_REGISTRATIONS, so a future divergence fails loudly.

In both cases, update the installing-maestro and maestro-architecture concept skills if what they say changes. Stamp with an explicit --bump, and on exit 9 apply the printed lines verbatim.

## Acceptance criteria

- [ ] The report answers, with file:line evidence, whether reviewer/refactor can run unconfined under a project-local install without the plugin.
- [ ] If yes: the guard is copied and registered by installRuntime; a test shows a reviewer Write outside .claude/channels/ is denied in a project-local install; dual registration with the plugin is arbitrated; libs and mirrors are rebuilt, parity passes, and the plugin's patch version is bumped.
- [ ] If no: the install.ts comment names the plugin-only exception, and a test fails if hooks.json and HOOK_REGISTRATIONS diverge beyond the documented plugin-only set.
- [ ] The comment at install.ts:319-326 is accurate either way.
- [ ] `pnpm verify` passes.

## Blocked by

None — can start immediately
