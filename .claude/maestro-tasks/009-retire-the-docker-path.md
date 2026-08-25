# Retire the Docker path

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`docs/plans/m5-retire-docker.md` in full. Read that plan first — it carries the exact delete list
and the must-survive table, and this slice is defined by them.

With install, uninstall, repo detection and the create-\* routes on the desktop side, the app does
everything the containerised web app did. What is left is the delivery mechanism: a Docker image, a
per-project container with an allocated port, a state file, a session-marker refcount directory, a
teardown hook, two `/tmp` channel files, and several hundred lines of bash whose only job was to
show a window.

That machinery is not merely redundant, it is **actively misleading**. Several skills, two
architecture documents and a CLAUDE.md describe a lifecycle that no longer exists — an agent
reading them today is told to launch a container and wait on a result file. The documentation
rewrite is not cleanup to do afterwards if there is time; it is the point.

**This milestone is mostly deletion and all of the risk is in deleting the wrong thing.** The
*runtime* hooks live in the same plugin directory as the *launcher* scripts, and they must survive
— they fire inside a Claude session and have no desktop equivalent. The plugin keeps existing.

**One file is a partial edit, not a deletion, and it is the most dangerous change here.** The
session cleanup script's container-teardown half goes; the half that deletes the ephemeral session
state files stays. Deleting the whole script silently leaves that state behind forever, and nothing
fails loudly when it does — the bug surfaces much later as stale session data nobody can account
for.

Work from the plan's must-survive table explicitly rather than by inspection, and confirm each
surviving hook still fires after the deletions.

## Acceptance criteria

- [ ] The container image, compose configuration, port allocation, state file, session-marker
      refcount directory and launcher scripts are gone
- [ ] Both `/tmp` channel files are gone, along with every reader and writer of them
- [ ] Every script in the plan's must-survive table still exists and still fires on its event,
      verified in a real Claude session rather than by reading the hook configuration
- [ ] The session cleanup script still deletes the ephemeral session state files, and no longer
      attempts any container teardown
- [ ] No skill, architecture document or CLAUDE.md still describes launching a container or waiting
      on a result file
- [ ] Documentation that described the old lifecycle is rewritten to describe the current one, not
      merely stripped of the parts that are wrong
- [ ] The desktop app builds, typechecks and passes its suites with no reference to the removed
      machinery
- [ ] A fresh project can be configured end to end with no Docker installed on the machine

## Blocked by

- `005-uninstall-the-runtime-from-a-project.md`
- `006-detect-the-repo-instead-of-seeding-backend.md`
- `008-port-the-create-routes-onto-the-bridge.md`
