# Make the scribe end with a HANDOFF label the workflow can route

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

In task 111 (report r006), a scribe at the end of the Documentation workflow ended with `HANDOFF: done`. `checkRoute` in apps/maestro/src/core/handoff-check.ts accepts `success` with no edge, because the last node of a path has none, but it has no route for `done`. So the orchestrator stopped and asked the user, even though the docs were finished. Code-graph's scribe skill is maestro-neutral by design and carries no HANDOFF text. The rule belongs to maestro's own scribe agent: plugins/maestro/agents/scribe.md has no HANDOFF rule, and neither does its project copy at .claude/agents/scribe.md.

Make a scribe that finished its documentation end with `HANDOFF: success`, and report skipped steps in its body, not through the label. Skipped steps include a graph refresh skipped for lack of a tsconfig, or targets left to enrich. A scribe that could not finish should end with a label that some workflow can route, or that the `unrouted` stop is meant to catch; say which in the agent body.

Check whether the scribe is the only agent missing this rule. If the other templates under plugins/maestro/agents/ already state it, follow their wording. If several lack it, fix the shared source instead: the report defaults or the orchestrator template's dispatch text. Don't loosen `checkRoute` to accept synonyms such as `done` or `complete`; the strict check is what caught this.

Related: task 108 gave docs-only work a route when it turns up a code change. Keep its behaviour.

Also carry 112's acknowledgement rule in the same edit (report r007). A scribe retires a skill-gap report only by ending with `SKILL_GAPS_HANDLED: <file>, …` (parsed by `parseGapsHandled` in handoff-channels.ts). Today that instruction exists only in the block SubagentStart injects, so a resumed scribe, which gets no `additionalContext`, is never told it. Put it in scribe.md and in the scribe's report default in report-defaults.ts: name each gap file handled, including ones handled by enrichment only, with a remainder left to enrich, or with no graph to enrich. State the order of the two final lines (`SKILL_GAPS_HANDLED:` then `HANDOFF:`), and check `checkRoute` still reads the label with both present.

Follow the publishing rules: bump the maestro plugin's patch version, and copy any changed agent or template to its tracked .claude/ mirror, then re-render the orchestrator skill if its template changed. Another session may have uncommitted changes to .claude/maestro.json and plugins/maestro/.claude-plugin/plugin.json (0.11.27). Check `git diff` first and bump on top of what's there. Never touch plan.md or merge-proposal.md at the repo root.

## Acceptance criteria

- [ ] maestro's scribe agent (the plugin template and its .claude/agents mirror) tells the scribe to end with `HANDOFF: success` when its docs are done, and where to report skipped steps.
- [ ] The report states whether other agent templates lacked the same rule, and either fixes them or names why not.
- [ ] scribe.md (plugin and mirror) and the scribe report default tell the scribe to end with `SKILL_GAPS_HANDLED: <file>, …` for every gap report it handled, so a resumed scribe knows it too.
- [ ] A test or fixture shows a finished scribe's final message passes `checkRoute` for the Documentation workflow with no issue, and that `HANDOFF: done` is still flagged as unrouted.
- [ ] Maestro plugin patch version bumped, mirrors in sync (parity test green), and `pnpm verify` passes.

## Blocked by

None — can start immediately
