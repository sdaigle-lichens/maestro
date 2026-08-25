# Fold in help-server's read-only surface

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Steps 1–3 of `docs/plans/m6-help-server-merge.md`. Read that plan first.

Bring help-server's node logic and its non-spawning screens into the desktop app: the tabbed
dashboard and the documentation reader, reachable from the app's own navigation alongside the
existing sections. The two utilities that shell out to external processes are deliberately **not**
in this slice — they carry a decision of their own and come next.

Land the node logic in the app's core directly rather than in a package. That is the whole reason
this milestone sits after the core absorption: writing it into `packages/` and moving it a week
later is exactly the churn that sequencing avoids.

**Route placement is a real decision, not a mechanical port.** help-server's landing page is a
tabbed dashboard; the desktop app's landing page is the project picker, and it stays that way. The
dashboard lands beside the existing sections rather than replacing the entry point, and the
navigation has to still make sense with several more tabs in it than it was designed for.

The chat sidebar becomes a slide-out panel rather than a route — the app already has that
primitive. Its *contents* stay inert in this slice; wiring it to actually run anything belongs with
the spawning work.

The documentation reader's rendering stack is already the one the tasks view uses, so there is
nothing to reconcile there.

New IPC channels follow the app's existing conventions — enumerated one per channel, with types
crossing the boundary from the contracts module rather than the barrel, and every fallible call
surfacing its error rather than rejecting into nothing.

## Acceptance criteria

- [ ] help-server's dashboard and documentation reader are reachable from the app's navigation and
      render correctly in a **packaged** build, not only in dev
- [ ] The project picker is still the app's landing page
- [ ] The navigation remains usable with the added sections, rather than merely having entries
      appended to it
- [ ] The node logic lands in the app's core directly, with no new workspace package introduced
- [ ] New IPC channels follow the existing conventions, and the process-boundary guards still pass
      unchanged
- [ ] Every new fallible main-process call surfaces its failure in the UI instead of rejecting
      silently
- [ ] The chat surface exists as a slide-out panel and does not spawn anything yet
- [ ] Anything that read Docker-era precompute files is reading the host directly instead
- [ ] `apps/help-server/` still exists and still works — deletion is a later slice, so this one is
      reversible

## Blocked by

- `010-fold-maestro-core-into-the-app.md`
