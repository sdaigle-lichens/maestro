# The epic manager cleans up after a finished worker: it asks the user to stop the session, then removes the worker's leftovers

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

After task 177 merged, its worker session stayed open, the epic still listed its herdr pane, and three per-project worker images (about 3 GB) were left on disk, two of them superseded. The user had to notice and ask. The manager should do this housekeeping itself.

After a worker's merge is verified on the merged result (and again at the epic's end), the manager asks the user once to stop that worker's session, naming its herdr tab. It never closes or types into the session itself. Once the user confirms, the epic records the worker as finished, so its stale pane id is no longer shown as active, and the manager runs a new prune command of the worker launcher. That command removes this project's worker images except the current tag, plus stopped worker containers. It never removes an image a running container uses, another project's worker images, or any image that is not a Maestro worker image. It prints what it removed and the space freed, and has a dry-run mode that only lists. With no Docker available, or for an epic whose workers ran on the host, it reports that nothing needed removing.

This needs code in the worker-runtime TypeScript source and its plugin script (the prune command), the epic CLI if recording a finished worker needs a command, the maestro-manager skill (when to ask and when to prune, in the loop after a verified merge and at the end boundary), tests, a plugin patch version bump, regenerating the libs and refreshing the mirrors.

## Acceptance criteria

- [ ] After a verified merge, the manager asks the user once to stop that worker's session, naming its herdr tab, and never closes or types into the session itself
- [ ] Once the user confirms, the epic no longer shows the worker or its pane as active
- [ ] The prune command removes this project's worker images except the current tag and stopped worker containers, and never removes an image in use by a running container, another project's worker images, or a non-worker image
- [ ] Prune prints what it removed and the space freed; its dry-run mode only lists
- [ ] With no Docker, or with host workers only, prune reports that nothing needed removing and exits 0
- [ ] The manager runs prune after the user confirms the stop and again at the epic's end boundary, as the maestro-manager skill describes
- [ ] Tests cover prune's selection (current tag kept, superseded removed, in-use kept, other projects and non-worker images untouched), the dry run, the no-Docker path, and the finished-worker record; the full suite is green
- [ ] plugins/maestro/.claude-plugin/plugin.json gets a patch bump, the generated libs are rebuilt and the .claude/scripts mirrors refreshed

## Manager direction

- (from r006, approved by the user) Every containerized worker the launcher starts runs with `--init`, so an init process reaps orphaned processes and they don't linger as zombies (two of 179's tests hung on them in the container). This goes in the launcher's own `docker run` arguments, so it is the default for every worker the manager starts, with nothing for the manager to add. Update the test that asserts the argument positions, and add one that asserts `--init` is present. Host workers are unchanged.
- (from r006, approved by the user) The plugin marketplace copy baked into the worker image leaves out the repository's epic data (`.claude/epics/`, including every `inbox/`). It holds reports and decisions, not plugin files, and a worker reads the live epic through the bind-mounted repo anyway. A test asserts the copy excludes it, and the image tag changes so existing images rebuild.

## Touched surfaces

- apps/maestro/src/core/worker-runtime.ts and plugin-entries/maestro-worker-runtime.ts, plus plugins/maestro/scripts/maestro-worker-runtime.cjs and its .claude/scripts mirror (shared with 179, which merges first)
- apps/maestro/src/core/epics.ts and plugin-entries/maestro-epic.ts, plus generated maestro-epic.cjs (if a finished-worker command is added)
- plugins/maestro/skills/maestro-manager/SKILL.md (the loop and the end boundary)
- plugins/maestro/.claude-plugin/plugin.json (version, patch; shared with 179 and standalone 178, whichever lands later rebases)
- generated libs and .claude/scripts mirrors (user runs `pnpm refresh:runtime`)

## Blocked by

- `179-containerized-workers-can-verify-their-own-work-project-toolchain-python3-git-identity-and-the-claude-cli-in-the-worker-image.md`
