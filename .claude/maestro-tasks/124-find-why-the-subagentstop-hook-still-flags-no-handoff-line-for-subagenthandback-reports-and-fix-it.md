# Find why the SubagentStop hook still flags NO HANDOFF line for SubagentHandback reports, and fix it

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 123's report (r017, .claude/epics/code-graph-cutover/inbox/) found that `maestro-task-status.cjs handoff-issues` reported "NO HANDOFF line" (kind `missing`) for every subagent in that run. Each subagent had ended with a `SubagentHandback` tool call whose report did contain `HANDOFF: success`. The orchestrator routed correctly from the report text, but the warning is a false positive, and it trains the orchestrator to ignore real ones.

This case is supposed to be handled already. `apps/maestro/src/core/handoff-label.ts` (task 087) recovers the label from the agent's transcript: `handbackHandoff` scans JSONL lines for a `tool_use` block named `SubagentHandback` or `SendMessage`, and `messageText` reads `message|content|text|summary|report` from its input. `apps/maestro/src/core/handoff-check.ts` `checkHandoff` then flags `missing` when no label is found. So something in that chain no longer matches what Claude Code produces.

Step 1, find the cause with evidence. Use a real recent subagent transcript from this repo's Maestro sessions (the session state under `.claude/maestro_sessions/`, or the agent transcript the SubagentStop payload points at). Find which of these is true:
- The hook reads the wrong transcript (the parent's `transcript_path` instead of the agent's own).
- The transcript isn't written yet when SubagentStop fires.
- The tool name or input key changed (e.g. a namespaced tool name, or a key other than the five read).
- The block shape differs from `message.content[]` / top-level `content[]`.
- Something else.
Put the evidence in the report, including the actual JSONL shape of a SubagentHandback call, redacted to its structure.

Step 2, fix it at the cause in `src/core`. Add a test built from that real shape, which fails before the fix and passes after; show the negative control. Then:
- Rebuild the plugin libs (`pnpm --filter maestro build:plugin-libs`).
- Refresh any changed `.claude/scripts/lib/` mirror and run `pnpm --filter maestro exec vitest run test/core/parity.test.ts`.
- Bump the maestro plugin's patch version (0.12.5 -> 0.12.6).
- Keep the bundle's export surface a superset (plugin-libs-parity).

If the cause turns out to be on Claude Code's side and maestro can't recover the label, don't guess. Make the `missing` message say the report may have arrived through a hand-back the hook couldn't read, and to check the report text, and say why in the report.

Update the maestro-architecture concept skill (its hooks sub-concept) if what it says about handoff recovery changes. Stamp with an explicit `--bump`; on exit 9 apply the printed lines verbatim. Then run `code-graph extract <id>` and `code-graph apply <id>` for each concept you edited.

## Acceptance criteria

- [ ] The report names the cause with evidence from a real transcript, including the SubagentHandback call's JSONL structure.
- [ ] A test using that real shape fails on the pre-fix code and passes after.
- [ ] A subagent ending with a SubagentHandback report containing HANDOFF: success records no `missing` issue.
- [ ] Libs are rebuilt, mirrors refreshed, parity passes, and the plugin is at 0.12.6.
- [ ] `pnpm verify` passes in the sandbox.
- [ ] `code-graph skills status --summary` shows 0 unextracted for every edited concept.

## Blocked by

None — can start immediately
