# Give maestro's code-graph install hint the exact commands

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A merge review (report: .claude/epics/code-graph-cutover/merge-review.md, R6) found that maestro's hint for a missing code-graph plugin names no command. Before the cutover it said `claude plugin install concept-skills@maestro`. Today apps/maestro/src/core/skill-availability.ts (around line 226) says only "Install it from the code-graph marketplace and enable it for this project." A user who sees it has to go and find the marketplace source themselves.

Make the hint give the exact two commands: add the code-graph marketplace, then install the plugin. The plugin id is `code-graph@code-graph`. The marketplace is the GitHub repo sdaigle-lichens/code-graph, so the likely commands are `claude plugin marketplace add sdaigle-lichens/code-graph` and `claude plugin install code-graph@code-graph`. Confirm both against code-graph's own README or its install skill before writing them. Keep maestro autonomous: the hint is text only, with no code dependency on code-graph. code-graph-plugin.test.ts pins that no plugin name creeps into maestro beyond the allowed soft references, so check this text fits what it allows, and extend the allowance deliberately if needed.

Find every other place that shows the same hint (the desktop app's skill-availability UI, the dev stub, install skills, README) and keep them consistent.

Follow the publishing rules: rebuild the plugin libs if a plugin-entries module's graph changed, copy changed libs to .claude/scripts/lib/, run the parity test, and bump the maestro plugin's patch version.

## Acceptance criteria

- [ ] The missing-code-graph hint shows the exact marketplace-add and install commands, confirmed against code-graph's own docs.
- [ ] A test pins the hint text, including both commands.
- [ ] Every surface that shows the hint uses the same text.
- [ ] Libs rebuilt if needed, mirrors in sync (parity test green), maestro plugin patch version bumped, and `pnpm verify` passes (outside the sandbox, or with TURBO_ENV_MODE=loose).

## Blocked by

None — can start immediately
