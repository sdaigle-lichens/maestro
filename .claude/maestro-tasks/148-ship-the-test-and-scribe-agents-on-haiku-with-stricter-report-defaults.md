# Ship the test and scribe agents on Haiku with stricter report defaults

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Make Haiku the default model for the test and scribe subagents in everything Maestro ships, instead of only in this repo's local forks. This is a mix of plugin agent files, report-default content in app source, tests, a plugin version bump and a regenerate/refresh step. (1) The published test and scribe agent definitions declare the Haiku model in their frontmatter, using the same model id the local forks in this repo already use. (2) The global default reports that new installs and syncs seed for test, scribe and backend carry the stricter, checkable evidence the local setup proved out: test reports list the exact gates run with results, gates skipped with a reason, and a notCaught line per new test; scribe reports list each file with action, the source files verified against, stamp failures, whether a changelog entry was added and why, and what was intentionally not touched; backend reports carry the testTargets section (behaviors with failure modes and files, plus pre-handoff checks). The test-to-reviewer handoff default gains the commands run, negative control and real-path-exercised fields. Shipped defaults must be project-neutral: replace this repo's own pnpm commands and parity-test references with generic wording, and keep this repo's own forks as they are. Include messages and strings in source code where the report defaults live. Check that the agent-sync and fork flows still carry or preserve the model frontmatter line when a fork syncs the template body, and fix it if the line is dropped or overwritten. Bump the maestro plugin version (patch) and run the runtime refresh so tracked mirrors and libs stay in parity.

## Acceptance criteria

- [ ] The shipped test and scribe agent files declare the Haiku model in frontmatter; no other shipped agent gains a model line
- [ ] A fresh read of the global report defaults returns the stricter test, scribe and backend reports and the extended test-to-reviewer handoff, with no reference to this repo's own commands or paths
- [ ] Syncing or forking a test or scribe agent from the template keeps the model frontmatter, covered by a test
- [ ] Existing tests for report defaults, agent sync and agent fork are updated and pass; lint, check, typecheck and the parity test pass
- [ ] plugins/maestro/.claude-plugin/plugin.json version is bumped by a patch and the generated libs and .claude/scripts mirrors are refreshed (pnpm refresh:runtime handed to the user if the sandbox cannot write them)

## Blocked by

None — can start immediately
