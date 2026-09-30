# Make alignMainSession unit-testable

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

alignMainSession (places the synthetic main-session node above the first step when saved positions exist) is a private function inside workflow-canvas.tsx, and the vitest suite runs in a node environment, so it has no test; it was only checked by eye in a running window. Move the pure placement logic into src/core and cover it with real tests: the no-saved-positions case, the saved-positions case (same x as the first step, one dagre rank above), and a workflow with no success entry edge (nodes returned unchanged). Keep the constant tied to the dagre rank spacing so a spacing change cannot silently desync it.

## Acceptance criteria

- [ ] The placement logic lives in src/core with no React or Electron imports, and workflow-canvas.tsx calls it
- [ ] Tests cover saved positions, no saved positions, and no entry edge
- [ ] A change to the dagre rank spacing fails a test or updates the offset from one shared constant
- [ ] Canvas behaviour in the running app is unchanged
- [ ] pnpm --filter maestro typecheck and pnpm --filter maestro test pass

## Blocked by

None — can start immediately
