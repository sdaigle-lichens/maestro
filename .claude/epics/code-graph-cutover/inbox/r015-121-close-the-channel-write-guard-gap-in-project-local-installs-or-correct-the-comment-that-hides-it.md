# Report r015: 121-close-the-channel-write-guard-gap-in-project-local-installs-or-correct-the-comment-that-hides-it.md

- Task: 121-close-the-channel-write-guard-gap-in-project-local-installs-or-correct-the-comment-that-hides-it.md
- Written: 2026-10-22T00:44:02.369Z
- From session: maestro-fbd4ccc9

## Task 121 report

**Outcome:** done. The channel write guard gap was real; branch 2a was taken.

**Step 1 (evidence):** reviewer/refactor (and meetings, worktree runs) could run unconfined under a project-local install with the plugin disabled.
- Guard registered only in plugins/maestro/hooks/hooks.json:109-118; absent from HOOK_SCRIPTS (install.ts:139) and HOOK_REGISTRATIONS (install.ts:337). Its own header said "no project-local twin" (maestro-channel-write-guard.js:8).
- It is the only confinement: reviewer.md has no disallowedTools; hooks.md:22 agrees.
- Guard keys on agent_type (channel-write-guard.ts:25). Without the plugin a reviewer still comes from a project fork (agent-fork.ts:90-135) or user copy (agent-sync.ts:25).
- Nothing else blocks: maestro-check-runtime.cjs:196-220 treats a missing plugin as informational.

**Changes:** guard added to HOOK_SCRIPTS and HOOK_REGISTRATIONS (install.ts) and to maestro-install.js; plugin copy stands down via projectOwnsHook; install.ts comment corrected; mirror .claude/scripts/maestro-channel-write-guard.cjs added; plugin bumped 0.12.3 -> 0.12.4; 10 new tests in channel-guard-install.test.ts plus 3 install tests; three guard suites repointed at the project copy; skill-gaps-contract.ts reformatted by Prettier (user-approved, out of original scope); concept skills updated.

**Findings / caveats:**
- Runtime identity hash changes: every existing project is told once to re-install or /maestro-update.
- Plugin-side stand-down reaches users only after 0.12.4 is published and re-pulled.
- This repo's .claude/settings.json is not updated (sandbox denies writes); run /maestro-update here. The plugin guard covers it meanwhile.
- `pnpm verify` fails in this sandbox only at the turbo test step (ENOENT mkdir /tmp/<rand>/ssr; TMPDIR apparently stripped, unconfirmed). Lint, check, typecheck and 2137 tests pass via `pnpm exec turbo run typecheck test --env-mode=loose`.
- New tests were never run against the pre-fix code (no negative control); real Claude Code hook dispatch is not exercised.
- Scribe: the installing-maestro stamp exited 9 (EROFS) and its lines were applied by hand; the other three skills' stamps (maestro-architecture 1.26, updating-maestro 2.1, plugin-libs-parity 2.1) were hand-edited without running the CLI, and extract/apply were not run. Re-run stamp/status for those.

**Suggested ticket changes:** none.
