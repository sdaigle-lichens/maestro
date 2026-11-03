# Task 144 — review round 1 (manager review, run as human review: task is in no epic)

## Goal

Every handoff channel file belongs to exactly one task or session, so parallel /maestro sessions
(main checkout + worktrees sharing `.claude/channels/`) never inject, resume, sweep, list or
gap-acknowledge each other's payloads (the 045/048 collision).

## Changed

- **Core:** `apps/maestro/src/core/handoff-channels.ts`. It adds `channelScopeOf`, every lane function now takes a scope, and the layout becomes `.claude/channels/<scope>/<receiver>/<sender>.N.md` with consumed files under `<scope>/.consumed/<receiver>/`.
- **Core consumers:** `handoff-payload.ts`, `resume-delivery.ts`, `meeting-mode.ts`, `channel-write-guard.ts`, `contracts.ts`, `handoff-seeds.ts`, `report-defaults.ts` (old seeds kept as priors), `types.ts`, `index.ts` and `plugin-entries/maestro-session.ts`.
- **Plugin scripts:**
  - context injection: `maestro-inject-agent-context.js`;
  - subagent log: `maestro-subagent-log.js`;
  - resume and task status: `maestro-resume-target.cjs`, `maestro-task-status.cjs`;
  - session cleanup: `maestro-session-cleanup.{cjs,sh}`;
  - workflow recording: `maestro-set-session-workflow.cjs`;
  - write guard: `maestro-channel-write-guard.js`.
- **Plugin text:**
  - the `scribe`, `reviewer` and `refactor` agent files;
  - the orchestrator template's skill-step bullet.
- **Plugin release:** `plugin.json` 0.13.10 → 0.13.11, and the generated `scripts/lib/*.cjs` rebuilt.
- **Desktop app:** the `/maestro` Channels card shows `<scope>/<receiver>` (`legacy` for old files), the `/agents` Interactions lane label shows the scoped path, and `shared/ipc.ts` has the scope field.
- `scribe-output/*.ast.json`: regenerated graph extracts (incidental).

## Did

- @backend implemented the approved design. The scope is `task-<NNN>`, else `session-<id8>`, else `session-none`.
  - Old root-level lanes are reported as stranded, never delivered, and aged out after 14 days.
  - SessionEnd retires only its own scope's `.consumed/`.
  - The write guard confines writes to the session's own scope.
  - Typecheck, `check` and lint pass.

## Deviations from the ticket

- **The test suite is red: 121 of 2467 tests fail in 18 files.** Existing tests still call the unscoped API, and four files fail only on stale mirrors. @backend may not write tests. Updating them and adding the collision, legacy and guard tests is @test's next step, as the ticket's test criteria intend.
- **`pnpm refresh:runtime` was blocked by the sandbox** while writing `.claude/skills/maestro/SKILL.md`. The parity test fails until you run it.
- **@backend's own payloads were written in the OLD layout.** The hooks running this session are the stale mirrors, so `.claude/channels/test/backend.1.md` and `.claude/channels/scribe/backend.2.md` are in the old place. After the refresh, the new hooks treat them as stranded. The orchestrator will copy them (not move them) into `.claude/channels/task-144/...` and name the paths in @test's and @scribe's prompts.

## Decisions

- **Scope key:** task, else session. You approved this in the design pass.
- **Scribe gap reports:** they now reach only a later scribe on the same task. This is intended; the cross-task case was the reported leak.
- **`session-none`:** the fallback when no session id resolves. The write guard denies writes with no resolvable scope.

## Sibling impact

- Projects running an older runtime keep writing the root layout until they update. Those files then strand and age out.
- Any unacknowledged scribe gaps currently in root lanes will not be delivered after the update.

## Questions

- None blocking. Run `! pnpm refresh:runtime` before @test is dispatched.
