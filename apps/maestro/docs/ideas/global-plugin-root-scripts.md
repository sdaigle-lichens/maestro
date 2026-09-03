# Idea: point hooks at `${CLAUDE_PLUGIN_ROOT}` instead of project-local copies

Today, installing Maestro into a project copies the runtime (hook scripts, handoff templates) into
`<project>/.claude/scripts/` and registers hooks in the project's own `.claude/settings.json`
pointing at those copies — never at `${CLAUDE_PLUGIN_ROOT}`. This idea was raised as: now that
Maestro is Electron with direct filesystem access (the old Docker-container version of the app,
removed in `cac62bd`/`1d6594f`, is what actually needed the repo mounted in to reach it at all — not
this), could hooks just reference the plugin's own scripts in the marketplace cache directly, so
nothing needs installing per-project? Not pursued; recorded here.

## Why project-local exists (from `install.ts`'s header)

Two reasons, neither about filesystem access:

1. **Versioning/staleness.** `${CLAUDE_PLUGIN_ROOT}` resolves into the marketplace cache, keyed by
   `plugin.json`'s version. Hooks registered against it would all share exactly one live copy of the
   runtime logic across every installed project — the one currently cached. Ship an edit without
   bumping the version and it never reaches anyone; bump it and every project changes at once, with
   no per-project review.
2. **Blast radius / consent.** "An installer that registered hooks globally would silently change
   every other repo on the machine." Project-local copies make "update this project's runtime" an
   explicit, visible, per-project file change the app can show a diff for — not a global flip nobody
   asked for on this specific repo.

## Pros of moving to global

- One copy of hook logic to maintain; a fix ships the moment the plugin version bumps, no separate
  per-project update step.
- Less to install per project — no `.claude/scripts/` copy, smaller `settings.json` diff.
- Simpler mental model: the plugin *is* the runtime, rather than the plugin being a template the
  project's copy drifts from until refreshed.

## Cons of moving to global

- **Loses per-project pinning.** Every installed project is always running whatever the currently
  cached plugin version has, with no way for one project to stay on an older, known-good runtime
  while another moves forward.
- **Loses visibility/consent on update.** A hook-behavior change becomes invisible and instantaneous
  across every project on the machine the moment the plugin version bumps or the marketplace cache
  refreshes — there's no longer a file diff for the app to show, because nothing changed on disk in
  any individual project.
- **Re-centralizes a single point of failure.** A bad script shipped in one plugin version breaks
  every installed project's hooks simultaneously, instead of only the ones that happen to update
  next.
- **Doesn't actually need the Docker-era justification to be retired.** `$CLAUDE_PROJECT_DIR` is
  already passed by Claude Code to every hook invocation regardless of where the command file lives,
  and `maestro-install.js` already takes an explicit `projectDir` argument — so "give the script the
  repo path" is not what project-local copies solve, and isn't gained by going global either. The
  actual trade is entirely about the two reasons above.

## A smaller alternative that gets most of the benefit without the downsides

See `027-auto-update-the-runtime-bundle.md` (`.claude/maestro-tasks/`): stamp a `runtimeVersion`
into `.claude/maestro.json` at install/update time, and check it — refreshing the project-local copy
automatically — at the two points a project is already "touched" (app project-selection, and the
orchestrator skill's Step 0 for the terminal path). This removes the practical pain (forgetting to
run `/maestro-update`) while keeping per-project pinning and a reportable diff at the point of
refresh, rather than an invisible global change the instant a version bumps.

## Recommendation

Don't move to `${CLAUDE_PLUGIN_ROOT}`. The auto-update task above targets the actual pain point
(staleness from a manual step being forgotten) without giving up the pinning and visibility
properties project-local copies were built for.
