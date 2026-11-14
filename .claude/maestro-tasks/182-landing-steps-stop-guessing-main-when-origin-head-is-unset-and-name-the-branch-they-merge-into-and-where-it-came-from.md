# Landing steps stop guessing main when origin/HEAD is unset, and name the branch they merge into and where it came from

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Every Maestro landing step (starting a task branch and its worktree, rebase, merge, the check that the main checkout is on the default branch, switch-back) takes the default branch from origin/HEAD, else a local main, else master. When origin/HEAD was never set in a clone, that silent fallback rebases and merges task work into main even when the remote's default is dev. The project decision: no Maestro setting; the user fixes the clone with git (`git remote set-head origin --auto`, or `git remote set-head origin <branch>` when the team integrates into a branch other than the remote's default).

Change the rule so the default branch comes only from origin/HEAD. When origin/HEAD is unset, every landing step refuses, changing nothing, with a message that says origin/HEAD is not set and gives the exact command `git remote set-head origin --auto`, plus `git remote set-head origin <branch>` for a team that integrates into another branch. No step falls back to main or master any more. When origin/HEAD is set, behaviour is unchanged, except that every landing message that names the default branch says it comes from origin/HEAD (for example "merging into dev (origin/HEAD)").

The land-the-task skill's `<DEFAULT>`, and any other skill or template prose that tells a worker how to find the default branch (including the maestro-manager merge plan's base), follow the same rule instead of their own "else main". This needs core logic (the one default-branch resolver and its callers), the generated plugin libs and their .claude/scripts mirrors, the hand-written plugin script that prints branch messages, skill and template wording, including messages in source code, tests, and a plugin patch version bump.

## Acceptance criteria

- [ ] With origin/HEAD unset (and a local main present), merge, switch-back and starting a task branch each refuse, change nothing, and print `git remote set-head origin --auto` and `git remote set-head origin <branch>`
- [ ] With origin/HEAD pointing at dev (set by `git remote set-head origin dev` while the remote's default is main), task branches start from, rebase onto and merge into dev
- [ ] With origin/HEAD set, landing behaves as before, and every message naming the default branch says it comes from origin/HEAD
- [ ] land-the-task's `<DEFAULT>` and every skill or template describing the default branch no longer fall back to main or master
- [ ] Tests cover the unset refusal (with a local main present), a locally overridden origin/HEAD, and the unchanged set case; the full suite is green
- [ ] plugins/maestro/.claude-plugin/plugin.json gets a patch bump, the generated libs are rebuilt and the .claude/scripts mirrors refreshed

## Touched surfaces

- apps/maestro/src/core/landing-guards.ts (defaultBranch resolver and its callers)
- apps/maestro/src/core/plugin-entries/maestro-session.ts, maestro-epic.ts and generated libs maestro-session.cjs, maestro-epic.cjs
- plugins/maestro/scripts/maestro-task-status.cjs (hand-written; branch messages)
- plugins/maestro/skills/land-the-task/SKILL.md, plugins/maestro/skills/maestro-manager/SKILL.md, plugins/maestro/templates/maestro/SKILL.md (default-branch wording)
- plugins/maestro/.claude-plugin/plugin.json (version, patch; 181 and standalone 178 also bump it, parallel OK, whichever merges later rebases)
- generated libs and .claude/scripts mirrors, shared with 181 (maestro-epic.cjs): parallel OK, merge order 181 then this, this rebases and rebuilds (user runs `pnpm refresh:runtime`)

## Blocked by

None — can start immediately
