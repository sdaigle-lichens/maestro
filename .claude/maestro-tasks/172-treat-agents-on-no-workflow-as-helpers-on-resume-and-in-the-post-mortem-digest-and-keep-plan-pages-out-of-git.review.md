# Review — task 172 (round 1, manager-review fallback: no epic)

## Goal
Treat agents on no workflow as helpers: no handoff-routes wording on resume, no "missing HANDOFF" in the post-mortem digest, and keep generated plan pages (`.claude/maestro-tasks/views/`) out of git.

## Changed
- `plugins/maestro/scripts/maestro-inject-agent-context.js` — new `resumeLine()`; mirror `.claude/scripts/maestro-inject-agent-context.cjs` refreshed
- `plugins/maestro/scripts/maestro-post-mortem.js` — helper classification in the digest
- `plugins/maestro/scripts/maestro-install.js`, `apps/maestro/src/core/install.ts` — `**/.claude/maestro-tasks/views/` added to the committed-mode `# Maestro` block
- `plugins/maestro/skills/maestro-install/SKILL.md`, `plugins/maestro/skills/to-maestro-tasks/references/plan-view.md` — glob list / note
- `.gitignore` — views glob
- `plugins/maestro/.claude-plugin/plugin.json` 0.14.0 → 0.14.1; `.claude/maestro.json` runtimeVersion 0.14.1 (from refresh:runtime)
- Tests: `install.test.ts`, `install-ignore-mode.test.ts` (3 new), `post-mortem-outcomes.test.ts`, `post-mortem-dedupe-165.test.ts` (fixtures now stamp `offered_skills`)

## Did
- @backend: implemented all three slices with tests; no plugin-entries source changed, so libs unchanged.
- orchestrator: user ran `pnpm refresh:runtime`; parity and full verify re-run.

## Deviations from the ticket
- A workflow node with zero outgoing routes (e.g. terminal scribe) also gets the shorter resume line — "no routes" read literally, not "not on a workflow".
- Helper = first dispatch has no `offered_skills` (same test SubagentStop uses). Logs written before `offered_skills` existed will read every agent as a helper.
- A helper that never returned (no-return) is still listed under Problems.
- Update SKILL.md unchanged (it lists no globs; `/maestro-update` re-runs the append-only installer, so the line is added once).
- App install path (`install.ts`) has no dedicated new test.

## Decisions
- Reuse the `offered_skills` stamp rather than reading maestro.json in the digest.

## Sibling impact
- 170 and 171 also touch hook scripts and plugin.json: whichever merges later takes the next patch version.

## Questions
- Is the terminal-node wording (no routes → no routes mentioned) acceptable?

## Verified
- Commit a3f90d5 plus the uncommitted working tree above (nothing committed yet).
- `pnpm --filter maestro exec vitest run test/core/parity.test.ts`: 44/44 pass.
- `pnpm verify`: lint, check, typecheck pass; tests 3153/3153 pass (160 files).
