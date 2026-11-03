# One command to refresh this repo's mirrors and orchestrator

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

After a plugin change, this repo's tracked copies must be refreshed before pnpm verify is green: the generated plugin libs are rebuilt, each changed lib and plugin script is copied over its .claude/scripts mirror, and the rendered orchestrator (.claude/skills/maestro/SKILL.md) plus the .claude/settings.json hook registrations are re-synced. Agents can't write those paths from the sandbox, so in tasks 130, 131 and 132 of the manager-review epic the user had to run several hand-built commands; in 132 the agent gave maestro-render-orchestrator.cjs as the re-render step, which only rewrites the HANDOFFS table and not STEPS, costing a second round-trip (maestro-install.js . was needed). Add one package script in this repo (a dev script, not shipped in the plugin) that does the whole refresh in the right order and is idempotent, so an agent hands the user exactly one `! pnpm …` line. Make the parity test's failure messages name that command, including for a stale STEPS region of the rendered orchestrator, instead of listing individual cp commands. Update the repo's developer docs that describe the refresh (the plugin-publishing rule, the updating-maestro and plugin-libs-parity developer skills, and the orchestrator/agent guidance that tells agents what to hand the user) to name the one command, and say that maestro-render-orchestrator.cjs alone does not refresh STEPS. Also add the missing human-review gate row (PreToolUse, matcher AskUserQuestion|SendMessage) to the hook table in the installing-maestro developer skill's manifest sub-concept. Includes the script, the test message change, the doc edits, and tests for the script if it has logic beyond chaining commands. No plugin version bump unless something under plugins/ changes.

## Acceptance criteria

- [ ] One package script refreshes the libs, the .claude/scripts mirrors, the rendered orchestrator (HANDOFFS and STEPS) and the settings hook registrations; running it twice changes nothing the second time
- [ ] After the script runs on a fresh plugin change, the parity and orchestrator-render tests pass with no other manual step
- [ ] A stale mirror or a stale STEPS region makes the parity test fail with a message naming the one command
- [ ] The plugin-publishing rule and the updating-maestro and plugin-libs-parity developer skills name the command and warn that maestro-render-orchestrator.cjs alone does not refresh STEPS
- [ ] The installing-maestro manifest hook table lists the review gate hook
- [ ] pnpm verify passes; the plugin version is bumped (patch) only if a file under plugins/ changed

## Blocked by

None — can start immediately
