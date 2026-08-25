# Self-host the UI fonts so the renderer CSP can stay strict

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The shared style sheet pulls its three typefaces from Google's CDN with a remote `@import` at the
top of `packages/styles/shared-styles.css`. In the desktop renderer that request is blocked on
every single load — the CSP there is `default-src 'self'` with `style-src 'self' 'unsafe-inline'`
and `font-src 'self' data:`, and the remote stylesheet satisfies none of it. The app has been
rendering in fallback fonts and logging a CSP violation since the Electron port. It is the only
console error left in an otherwise clean run.

Vendor the fonts into the repo and serve them same-origin so the typography is correct and the
policy stays strict.

Do **not** widen the CSP to allow `fonts.googleapis.com` / `fonts.gstatic.com`. That contradicts
the policy's own stated intent — "Electron's default allows inline script and remote loads; this
app needs neither at runtime" — and it makes a desktop app's typography depend on the network at
launch, which is the wrong trade for a tool that opens local project folders. Dropping the import
and falling back to system fonts is also rejected: it silently changes the look of every app in
the monorepo.

Two things make this wider than one file. The style sheet is shared — `apps/maestro`,
`apps/help-server`, and (until M5 removes it) `apps/ai-tools-manager` all consume it, so whatever
replaces the `@import` has to work in a browser-served app as well as under `file://`. And the
weights actually in use are specific: Inter at 300/400/500/600/700, Bodoni Moda italic at 600/700,
IBM Plex Mono at 300/400/500/600. Vendoring every weight of three families would be a large,
mostly dead payload — ship what is referenced.

Check the licences permit redistribution before committing font binaries, and record where the
files came from and how to refresh them, so the next person updating a weight is not reverse-
engineering a binary blob.

## Acceptance criteria

- [ ] No remote font request is made at runtime by any consumer of the shared style sheet
- [ ] Launching the packaged desktop build produces **zero** CSP violations in the renderer
      console, and the renderer CSP is no less strict than it is today
- [ ] Text renders in the intended typefaces, not fallbacks — verified by inspecting the resolved
      font family of rendered text in a running window, not by the absence of an error
- [ ] Only the weights and styles the codebase actually references are shipped
- [ ] The other apps consuming the shared style sheet still render correctly when served over
      HTTP, so the fix is not `file://`-only
- [ ] Font licences permit redistribution, and the licence files are committed alongside
- [ ] The provenance of the vendored files and the procedure for refreshing or adding a weight are
      written down where the next person will look
- [ ] The known-issue entry for this in `docs/plans/review-m1-m2-outcome.md` is closed out with
      what was decided

## Blocked by

None — can start immediately
