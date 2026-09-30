# Make the session-sweep IPC wiring unit-testable

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The session sweep, explicit delete, and title lookup were added with their core functions tested, but the Electron glue in src/main/ipc.ts is untested because the vitest suite runs in a node environment and cannot import electron. Three pieces of that glue hold real decisions: (1) the sessions:titles handler filters requested refs by the allowed project roots and back-fills null for every asked-for key; (2) sweepAndRefresh and the sessions:delete handler re-target the session-log tails only when something was actually removed, never on a no-op; (3) allowedProjectRoots composes the open project plus recent ones, deduped by real path. Move each decision into src/core as a pure or dependency-injected function (the retarget side effect passed in as a callback) so main/ipc.ts stays a thin adapter, and cover them with real tests against temp project directories with HOME and CLAUDE_CODE_SESSION_ID pinned. Behaviour in the running app must not change.

## Acceptance criteria

- [ ] The titles allow-list filtering and null back-fill, the retarget-only-when-removed decision for sweep and delete, and the allowed-roots composition live in src/core with no React or Electron imports, and src/main/ipc.ts calls them
- [ ] Tests cover: a ref outside the allow-list resolves to null while every asked-for key is present; a sweep or delete that removes nothing does not trigger a retarget; a sweep or delete that removes something triggers exactly one; duplicate or symlinked roots produce one allowed root
- [ ] Tests use real temp project directories, with HOME and CLAUDE_CODE_SESSION_ID pinned
- [ ] Session sweep, delete, titles and the clean-up button behave the same in the running app
- [ ] pnpm --filter maestro typecheck and pnpm --filter maestro test pass

## Blocked by

None — can start immediately
