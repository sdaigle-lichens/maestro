# Isolate tests from the real home directory and keep runtime mirrors in parity

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Fix test and build hygiene problems that came up while building the team meeting and the metrics file (tasks 079 and 080).

1. Home isolation. The install, uninstall and discovery tests fail in the sandbox with 'unable to open database file', which suggests they open the sqlite stores under the developer's real ~/.claude. Outside the sandbox, they may be writing into the developer's real global stores. channel-write-guard.test.ts and workflow-spec-cli.test.ts also spawn scripts without pinning HOME. Confirm the cause, then make every test that spawns scripts or touches global stores use a temp HOME (and pin or delete CLAUDE_CODE_SESSION_ID), as the repo's testing skill already requires. Those tests should then pass inside the sandbox.

2. Runtime mirrors. Rebuilding the plugin libs doesn't refresh this repo's own tracked copies under .claude/scripts, so parity.test.ts fails, and in task 080 this cost a loop-back. Make refreshing the mirrors part of finishing any plugin-lib change: say so in the repo's plugin-publishing rule and in the plugin-libs-parity developer skill, including running parity.test.ts before handing off. This is a repo-level rule only. Don't change the shipped plugin agents. Also fix the leftover parity.test.ts failure about path comments, so the parity test is green when the mirrors match.

   Tracked mirrors also conflict on merge. Tasks 079 and 080 both rebuilt maestro-session.cjs, so merging task-080 conflicted on .claude/scripts/lib/maestro-session.cjs. Any two tasks that rebuild the same lib will hit this. Evaluate generating the mirrors instead of tracking them (or otherwise removing the conflict), and if they stay tracked, have `maestro-task-status.cjs merge` name the resolution when a conflict is limited to generated libs or their mirrors: rebuild, or copy the plugin lib over the mirror.

3. Writes to the main checkout during a worktree run. While task 080 ran in its worktree, untracked copies of apps/maestro/src/core/run-metrics.ts and apps/maestro/test/core/run-metrics.test.ts appeared in the main checkout, byte-identical to the worktree's files and with the same mtime. They blocked the merge ("untracked working tree files would be overwritten by merge"). Find what wrote them, whether an agent resolving paths against the main checkout or a hook or script that uses the main project dir instead of the worktree, and fix it so a worktree run never writes into the main checkout.

4. Team-meeting checkpoints. The agenda confirmation, the mid-meeting checkpoint and owner-run dispatch exist only as SKILL.md instructions. Add a scripted dry run of the meeting tool sequence that covers start, brief, the checkpoint stops (cancel, redirect, stop), tally, end, and planning owner runs only after close. It must assert that a cancelled or stopped meeting closes cleanly and applies nothing.

## Acceptance criteria

- [ ] No test reads or writes the real ~/.claude. Every spawning test pins HOME to a temp dir and pins or deletes CLAUDE_CODE_SESSION_ID, including channel-write-guard.test.ts and workflow-spec-cli.test.ts.
- [ ] The install, uninstall and discovery tests pass inside the sandbox, or any remaining failure is shown to be unrelated to the real home dir.
- [ ] The plugin-publishing rule and the plugin-libs-parity skill say to refresh the .claude/scripts mirrors and run parity.test.ts after rebuilding the plugin libs.
- [ ] parity.test.ts passes when the mirrors match the plugin libs. The path-comment artefact is gone.
- [ ] Merging two tasks that both rebuilt a lib no longer leaves an unexplained mirror conflict: either the mirrors are no longer tracked, or `merge` names the mirror-copy resolution. The decision is documented.
- [ ] The source of the main-checkout writes during task 080 is identified and fixed, or proven not to come from Maestro's agents, hooks or scripts. A test or reproduction shows a worktree run leaves the main checkout untouched.
- [ ] A scripted dry run covers the team-meeting checkpoints (cancel, redirect, stop) and owner-run planning after close. It proves a cancelled or stopped meeting closes cleanly and applies nothing.
- [ ] The full suite has no failures caused by the environment, and any remaining failure is explained.

## Blocked by

None — can start immediately
