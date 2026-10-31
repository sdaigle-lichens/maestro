# Stop the channel write guard from failing open when the project copy can't run

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The second merge review (/tmp/claude-1000/merge-review-delta.md, finding R10) found that task 121 opened a fail-open path. `plugins/maestro/scripts/maestro-channel-write-guard.js:44` stands the plugin copy down via `projectOwnsHook` whenever the project registers the guard in `.claude/settings.json`. It never checks that the project copy can run. If `.claude/scripts/maestro-channel-write-guard.cjs` or `.claude/scripts/lib/maestro-session.cjs` is missing, the project copy exits 1 with `Cannot find module`. Claude Code treats a PreToolUse exit other than 2 as non-blocking, so a reviewer Write to `src/` goes through. Before 121 the plugin copy denied it.

Fix: remove the `projectOwnsHook` stand-down from the plugin copy of this guard so both copies always run. The guard only ever denies, so running both is the stricter outcome. An older plugin copy denying what a newer project copy allows is acceptable for a confinement hook; say so in the header comment. Don't touch the stand-down for the other dual-registered hooks: for logging hooks, keying on the registration is still the right trade.

Then:
- Add a test that registers the guard project-locally, deletes the project script (one case) or `.claude/scripts/lib/` (another case), and expects the plugin copy to deny a reviewer Write outside `.claude/channels/`. Also add an intact-install case showing both copies running together still deny exactly once in effect, with no duplicate side effects.
- Update `.claude/skills/installing-maestro/sub-concepts/hook-arbitration.md`, and the updating-maestro skill if it describes arbitration, to say this guard is exempt from stand-down and why.
- While here, add the general parity test the reviewer suggested. For every script in `plugins/maestro/hooks/hooks.json`, there is a `HOOK_REGISTRATIONS` twin with the same event and matcher, in both `apps/maestro/src/core/install.ts` and `plugins/maestro/scripts/maestro-install.js`. A future divergence like 121's must fail a test, not just contradict a comment.
- Copy the changed plugin script over its `.claude/scripts/` mirror, run `pnpm --filter maestro exec vitest run test/core/parity.test.ts`, and bump the maestro plugin's patch version (0.12.4 -> 0.12.5).
- Document the Bash gap (review finding N1; the user decided to document it, not guard it, for now). The guard's matcher is `Write|Edit|MultiEdit|NotebookEdit`, and reviewer/refactor have no `tools:` line, so they keep Bash, and a Bash redirect or `tee` is not confined. Say this in one or two lines in the guard's header (both the plugin script and its mirror) and in `.claude/skills/maestro-architecture/sub-concepts/hooks.md`, wherever it says the guard is the only thing confining these agents. These agents don't normally write through Bash; if a post-mortem catches one doing it, that's the trigger for a stronger guard. Don't add a Bash check.
- Concept skills: stamp with an explicit `--bump`. On exit 9 apply the printed lines verbatim. Then run `code-graph extract <id>` and `code-graph apply <id>` for every concept whose SKILL.md you edited.

## Acceptance criteria

- [ ] The plugin copy of maestro-channel-write-guard no longer stands down; its header says why this hook is exempt.
- [ ] A test proves a reviewer Write outside .claude/channels/ is denied by the plugin copy when the project copy's script or its lib/ is missing.
- [ ] A test fails if any hooks.json script lacks a same-event, same-matcher twin in install.ts HOOK_REGISTRATIONS or maestro-install.js HOOK_REGISTRATIONS.
- [ ] hook-arbitration.md states the guard's exemption and the reason.
- [ ] The guard's header and hooks.md say that Bash writes by reviewer/refactor are not confined, and that a post-mortem finding is the trigger for a stronger guard.
- [ ] The mirror is refreshed, parity passes, and plugin.json is at 0.12.5.
- [ ] `code-graph skills status --summary` shows 0 unextracted for every edited concept.

## Blocked by

None — can start immediately
