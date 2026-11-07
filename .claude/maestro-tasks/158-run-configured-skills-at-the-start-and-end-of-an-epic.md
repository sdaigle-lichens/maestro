# Run configured skills at the start and end of an epic

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Let a project configure skills that a maestro-manager runs once at the start of an epic and once at the end, the way /maestro already runs its start and end skills. This is code, tests, a desktop-app setting, a change to the published maestro-manager skill, a plugin version bump and a runtime refresh.

Config: extend the existing lists rather than adding a new file, so maestro.json gains start_skills.maestro_manager and end_skills.maestro_manager, ordered skill ids resolved by the one existing reader, with a missing key meaning an empty list. The desktop app edits both through the existing skill-list pickers and save path. Seeded defaults are empty.

The epic boundary: one new command on the epic CLI, `boundary <slug> start|end [--force]`, decides whether a step is due, records it and produces its scope. It prints one line: nothing configured, not due with the reason, already ran, or the skills to run with the path of a scope file. The run is claimed when the line is printed, so a boundary runs at most once and an interrupted run needs --force. The manager skill calls it for start after the merge plan and before the first spawn, and for end after each acknowledgement, so the manager never works out due-ness, once-only state or scope itself.

Start is due once, just before the first workers are spawned: not on epic creation, when tasks may not exist yet, not on resume, and not on an epic that already has workers or finished tasks. Finished means the epic has at least one task, every task is done and merged, and no report or note is unacknowledged. This is a new defined moment, as the epic has no finished state today.

Scope: each skill receives the path of a scope file holding one repo-relative path per line. At start the file holds the epic's tasks' `## Touched surfaces` entries that resolve to existing files, dropping annotations, globs and prose; the task writer adds that section to every task, so an older task without one simply adds nothing. An epic has no branch of its own, because each task has its own worktree branch and base, so the start boundary records the base commit and the end scope is the existing files changed between that commit and the merged result. An epic with no recorded start commit falls back to the Touched surfaces rule.

Output: the manager saves each skill's output in the epic's folder and shows it to the user as a backlog to triage. Nothing becomes a task or is handed to an implementer unless the user says so.

The mechanism is generic and names no scout. Background, not scope here: the first intended user is a Haiku refactor scout shipped from code-graph under its own ticket, taking a list of repo-relative paths and returning a `PROPOSALS:` section. It spawns its own Haiku agent because a configured skill runs in the manager's context. Evidence in code-graph docs/evals.md: Ticket 071 passed only the scout alone as an advisory list, and Ticket 073 rejected a declined-findings list as input, so the scout may repeat at epic end what was declined at epic start. Limits to keep: confidence is low to moderate, neither epic boundary was benched, the bench scopes were 4 to 11 files, and the scout's false-finding count was high, so its output prompts review and does not prove the code is clean. Reviewer intake, automatic hand-back and an architect rename are deliberately out of scope.

## Acceptance criteria

- [ ] maestro.json supports start_skills.maestro_manager and end_skills.maestro_manager as ordered skill-id lists, including plugin-namespaced ids; a missing key is an empty list, and resolveSkillLists stays the one reader for the app and the runtime.
- [ ] The desktop app adds, removes and reorders both lists and a save round-trips through maestro.json, verified in a running window.
- [ ] With no lists configured, an epic behaves as it does today and the boundary command reports nothing to run.
- [ ] The start boundary runs once, after the merge plan and before the first spawn, and does not run on resume or on an epic that already has workers or finished tasks.
- [ ] The end boundary becomes due only when the epic has at least one task, every task is done and merged, and no report or note is unacknowledged; it then runs once.
- [ ] --force re-runs a boundary, and it is the only way to run end skills again after tasks are added to a finished epic.
- [ ] Each skill receives the path of a scope file with one repo-relative path per line, holding only existing files.
- [ ] `boundary <slug> start|end` prints the scope file as an absolute path, while the paths inside the file stay relative to the git root.
- [ ] The start scope comes from the tasks' Touched surfaces, and annotated, glob, prose and missing-file entries add nothing.
- [ ] The start boundary records the base commit, the end scope is the existing files changed since that commit on the merged result, and an epic with no recorded commit falls back to Touched surfaces.
- [ ] The manager skill saves each skill's output in the epic's folder and shows it to the user; nothing becomes a task or a hand-back without the user saying so.
- [ ] The mechanism names no specific skill in code, skill prose or seeded defaults.
- [ ] Tests cover the boundary command through its interface: unconfigured, once-only, resume, an already-running epic, each finished condition, --force and both scope rules.
- [ ] Generated plugin libs are rebuilt, the maestro plugin's version is bumped, the runtime mirrors are refreshed, the parity test passes, the affected concept skills and install and update docs are current, and pnpm verify passes.

## Touched surfaces

- apps/maestro/src/core/skill-lists.ts
- apps/maestro/src/core/epics.ts
- apps/maestro/src/core/plugin-entries/maestro-epic.ts
- apps/maestro/src/core/types.ts
- apps/maestro/src/core/config.ts
- apps/maestro/src/core/seed.ts
- apps/maestro/src/renderer/src/routes/maestro.tsx
- plugins/maestro/skills/maestro-manager/SKILL.md
- plugins/maestro/scripts/maestro-epic.cjs
- plugins/maestro/scripts/lib (generated)
- .claude/scripts mirrors (generated)
- plugins/maestro/.claude-plugin/plugin.json (version)
- apps/maestro/.claude/skills/maestro-config-model/sub-concepts/skill-lists-slice.md
- .claude/skills/task-queue/sub-concepts/epics.md

## Blocked by

None — can start immediately

## Post-Mortem

- **Problem:** The end scope came out empty for a project nested in its git repo: `git diff --name-only` printed toplevel paths that were then checked against the project root. The review caught it, not the tests, which only used repo-root projects.
  **Fix:** none
- **Problem:** "Repo-relative" in the ticket was ambiguous for a nested project. The first fix made scope paths project-relative, then another session added a criterion asking for git-root-relative paths, because the consuming skill resolves against the git root. The user chose the git root, which took a second backend round.
  **Fix:** none
- **Problem:** A backend agent was cut off mid-change when the session ended and couldn't be resumed. A cold agent had to pick up its partial edits.
  **Fix:** none
- **Problem:** The "verified in a running window" criterion couldn't be met: Electron aborts in the Linux Bash sandbox (SUID chrome-sandbox). The task was marked done with that check left to the user.
  **Fix:** none
- **Problem:** Each lib change needed the user to run `! pnpm refresh:runtime` (three times this session), because the sandbox can't write `.claude/scripts/`.
  **Fix:** none
