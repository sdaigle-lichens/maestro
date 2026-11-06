# Remove the duplicate and dead code found by the code-graph audit

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

A blind audit for code-graph ticket 070 (results in that repo's docs/evals.md, pinned commit 3814a30) found duplicate and dead code in this repo. It was re-checked on main at 7637a2f; the lines below are from that commit, so confirm them again. This is a behaviour-preserving code cleanup with test and doc updates, a rebuild of the generated plugin libs if a bundled source changes, a patch plugin version bump if anything under plugins/ changes, and the repo's runtime refresh.

In scope:
1. Three hook scripts each define the same `readGlobalHandoff`, a try/catch lazy require of `readHandoffDefault`: maestro-inject-agent-context.js:146, maestro-subagent-log.js:87 and maestro-resume-target.cjs:69. Keep one definition. Hook scripts committed as `.js` are copied into a project as `.cjs`, and the lazy require is what keeps a hook working when the lib is missing, so both must still hold in an installed project.
2. `parseBlockedBy` (tasks.ts:50) and `extractPostMortemSection` (tasks.ts:65) were reported to cut a `## Heading` section the same way. Compare them and share the cut if they really match. `maestro-tasks.cjs` is the hand-maintained twin of tasks.ts, so the two must still agree.
3. `SessionTitleRef` (session-title.ts:38) and `SessionRef` (session-sweep.ts:151) are the same two-field interface. Keep one.
4. `readSessionLog` (session-log.ts:66) has no caller. Remove it, its re-export in the core barrel, and its mention in the log-view skill.
5. session-sweep.ts repeats the `sessionDirsFor` / `rmSync` removal loop (lines 123 and 180) and the `now` / `idleCapMs` defaulting (lines 110-111, 162-163, 191-192). Share them where that makes the file simpler. The idle cap differs on purpose: sweeping uses `SESSION_SWEEP_IDLE_CAP_MS`, deleting and listing use `SESSION_DELETE_IDLE_CAP_MS`. Keep that.

Out of scope, decided by the user or already gone:
- Keep `tailSessionLog` and its tests. It has no production caller, but the log-view skill says it is kept on purpose for differential coverage. Do not remove it.
- The audit's repeated ready/blocked expression in tasks.ts no longer exists: one `every` remains at line 158, and line 191 is a different filter.
- `taskHeading` in session-title.ts and `parseTitle` in tasks.ts were noted as judgement calls and not audited. Leave them unless they turn out to be true duplicates while doing item 2.

## Acceptance criteria

- [ ] `readGlobalHandoff` has one definition and every hook that used it still works in an installed project, including when the lib is missing
- [ ] `parseBlockedBy` and `extractPostMortemSection` share their section cut, or the task reports why they differ; tasks.ts and maestro-tasks.cjs still agree
- [ ] One session reference interface remains
- [ ] `readSessionLog` is gone from the source, the barrel and the log-view skill
- [ ] `tailSessionLog` and its tests are unchanged
- [ ] session-sweep.ts behaviour is unchanged, including the two different idle caps
- [ ] The full suite, lint and typecheck pass; if anything under plugins/ changed, the plugin version is bumped and the parity test passes after the runtime refresh

## Touched surfaces

- plugins/maestro/scripts/maestro-inject-agent-context.js, maestro-subagent-log.js, maestro-resume-target.cjs and their .claude/scripts mirrors
- apps/maestro/src/core/tasks.ts and plugins/maestro/scripts/lib/maestro-tasks.cjs (hand-maintained twin)
- apps/maestro/src/core/session-title.ts, session-sweep.ts, session-log.ts and index.ts
- plugins/maestro/scripts/lib/*.cjs (generated: rebuild, never hand-edit) and .claude/scripts/lib mirrors
- plugins/maestro/.claude-plugin/plugin.json (version)
- apps/maestro/.claude/skills/log-view/SKILL.md
- Overlaps task 151 in maestro-subagent-log.js, the generated libs and the version file: blocked by it

## Blocked by

- `151-read-a-resumed-agent-s-current-hand-back-not-its-previous-run-s.md`
