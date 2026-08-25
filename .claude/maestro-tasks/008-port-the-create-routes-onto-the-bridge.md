# Port the four create-* routes onto the bridge

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Steps 1, 2 and 5 of `docs/plans/m4-claude-bridge.md`. Read that plan first.

The four `create-*` routes are the last part of the web app with no desktop equivalent. They are
the most self-contained work in the migration — forms, a split-pane layout with a live preview, and
per-route preview components, none of it SSR-dependent. Port them, moving the deterministic
scaffold to the node side and the submit path onto the app's own IPC.

Take one route end to end first, including its scaffold and its preview, and only then bring the
remaining three across. They share all their machinery, so the first one is where every decision
gets made and the rest are repetition — doing them in parallel means making the same mistake four
times.

**Keep the target toggle, drop only what was Docker-specific about it.** Writing into a marketplace
versus the open project is a real user choice and stays; the path ambiguity that existed only
because of the container does not.

**Marketplace data must come off the precompute file.** It currently reads a `/tmp` file that
Docker produced. On the host, read the user's Claude directory directly — the helpers for this
already exist. This is not incidental cleanup: it deletes the last consumer of that file, which is
what allows the Docker path to be retired in the next milestone. Leaving it behind blocks that
work.

**Anything that invokes the CLI goes through the bridge.** These routes must not grow their own
spawn path; the preview-then-confirm-then-run contract exists so that no prompt executes without
the user having seen it, and a route that shells out directly silently opts out of it.

## Acceptance criteria

- [ ] All four create-\* routes work in the desktop app, each producing the same artifacts the web
      app produced for the same input
- [ ] The deterministic scaffold runs on the node side with no model involved, and is covered by
      tests
- [ ] The live preview updates as the form changes, as it did in the web app
- [ ] The target toggle still offers marketplace versus the open project, and writes to the right
      place in each case
- [ ] Marketplace data is read from the user's Claude directory at runtime, with **no** remaining
      read of the Docker precompute file anywhere in the codebase
- [ ] Every CLI invocation from these routes goes through the bridge's preview → confirm → run
      path; none spawns a process directly
- [ ] Form validation rejects bad input before anything is written, and a failed write surfaces the
      reason rather than leaving a partial artifact
- [ ] The routes are reachable from the app's navigation and work in a packaged build, not only in
      dev

## Blocked by

- `007-the-claude-bridge-preview-and-run.md`
