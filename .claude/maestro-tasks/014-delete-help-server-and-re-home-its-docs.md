# Delete help-server and re-home its docs

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Step 5 of `docs/plans/m6-help-server-merge.md`. Read that plan first.

With help-server's surface and its two spawning utilities living in the desktop app, remove the
original: the app, its container configuration, and the command that launched it. This is the last
milestone of the migration — after it there is one application.

**Move the documentation before deleting the app.** `apps/help-server/CLAUDE.md` carries knowledge
about how that code behaves, and it must be re-homed into the desktop app's own documentation
first. This is the same trap the Docker retirement had, and it is worth naming twice because the
failure mode is silent: the deletion looks clean, and the knowledge is simply gone from the working
tree, recoverable only by someone who thinks to look in history.

**Not everything under the old app's umbrella is app machinery.** The help skill the CLI invokes is
a skill, not part of the server, and it stays. Check what else in the delete list is reachable
independently of the app before removing it.

Finish by making the repository state honest: no workspace entry, dependency edge, script, or
document should still refer to an application that no longer exists.

## Acceptance criteria

- [ ] `apps/help-server/`, its container configuration, and the command that launched it are gone
- [ ] Its CLAUDE.md content is re-homed into the desktop app's documentation **before** the
      deletion, not reconstructed afterwards
- [ ] The skill the CLI invokes still exists and still works
- [ ] No workspace entry, dependency edge, script or lockfile entry still refers to the deleted app
- [ ] Every feature that lived in help-server is reachable in the desktop app — checked against the
      old app's navigation, not from memory
- [ ] A root install produces a clean lockfile, and the desktop app builds, typechecks and passes
      its suites
- [ ] The plans index reflects the migration being complete rather than describing the app as a
      thing that exists
- [ ] No documentation anywhere still tells the reader to start a help server

## Blocked by

- `013-put-chat-and-stats-behind-the-bridge.md`
