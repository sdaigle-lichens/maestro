# Always write Maestro tasks to the repository-root .claude

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Maestro task files must only ever be created in the .claude directory at the root of the repository, never in a sub .claude folder such as apps/maestro/.claude. Today the task writer used by /to-maestro-tasks resolves its target as CLAUDE_PROJECT_DIR, falling back to the process cwd, and the skill text says the files go under <cwd>/.claude/maestro-tasks/. A session whose cwd was a subdirectory therefore created a stray queue at apps/maestro/.claude/skills/.claude/maestro-tasks/ (a task file plus status.json, both tracked in git).

Make the writer resolve the project root as: the nearest ancestor directory (starting from the resolved project dir / cwd) containing .claude/maestro.json, falling back to the git root, and only then to the starting directory. Write the queue and status.json under that root's .claude/maestro-tasks/. Update the to-maestro-tasks skill text to say the queue lives at the repository root rather than <cwd>. Then relocate the existing stray task into the root queue: give it the next free number, keep its content, re-sync the root status.json, and delete the stray maestro-tasks directory (and any now-empty parent .claude folder created only for it). Because the plugin's scripts/lib files are generated from apps/maestro/src/core/plugin-entries, check whether the resolution logic belongs in a generated lib or in the standalone script, and edit the source accordingly.

## Acceptance criteria

- [ ] Running the task writer from apps/maestro, and from apps/maestro/.claude/skills, creates files only under the root .claude/maestro-tasks/
- [ ] Root detection prefers the nearest ancestor with .claude/maestro.json, then the git root, then the starting directory
- [ ] No maestro-tasks directory exists anywhere in the repository except the root .claude
- [ ] The relocated task keeps its content, has the next free number, and appears in the root status.json
- [ ] The to-maestro-tasks SKILL.md states that tasks are written to the repository-root .claude, not <cwd>
- [ ] If any generated plugin lib was affected, it was regenerated from its TypeScript source rather than hand-edited
- [ ] plugins/maestro/.claude-plugin/plugin.json version is bumped (patch)

## Blocked by

None — can start immediately
