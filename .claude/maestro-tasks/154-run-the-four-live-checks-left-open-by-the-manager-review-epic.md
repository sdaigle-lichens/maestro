# Run the four live checks left open by the manager-review epic

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Several behaviours from this epic were only covered by unit tests or fixtures. Run each one for real once and record what was observed. This is verification plus a documentation update: no plugin change, no version bump and no code fix. Any defect found becomes a finding in the report, not a fix in this task.

The four checks:
1. Human-review gate on AskUserQuestion. Task 137 saw the review gate deny SendMessage live, but never AskUserQuestion. Deliberately try an AskUserQuestion at a human review before the round's review file exists, and record whether Claude Code honours the deny and what the denial said.
2. Worktree channel write. Task 139's allow rule was never shown to stop the classifier denial, and its portable form has never run live. Run a worktree agent writing its channel file with only the portable rule in effect, and record whether the write is denied. The denial is intermittent, so a clean write is evidence, not proof: say so. A rule change in settings is the user's to make: if the portable rule cannot be isolated without one, ask the user.
3. Add-step modal and workflow canvas. Open the real desktop app window and check the add-step modal (Agent, Skill and Review kinds, Human by default or Manager, the wider modal, the modal resetting on open, the node actually being added) and a manager_review node on the canvas. If no real window can be reached from the session, ask the user to look and record what they report.
4. End-to-end resumed agent. Resume a finished agent for real and check tasks 151 and 153 against it: the handoff records that run's own result, a next-numbered payload raises no warning, a re-verify-only run raises no warning, and a run that edits files and skips its payload is still warned.

A check that cannot be run is reported as not run, with the reason. It is never reported as passed.

## Acceptance criteria

- [ ] Each of the four checks is reported as observed or not run, with what happened or why not
- [ ] The AskUserQuestion result says whether the deny was honoured and quotes what the denial said
- [ ] The worktree result says which allow rule was in effect and that one clean write does not prove the denial is gone
- [ ] The window result names who looked at the real window: the session or the user
- [ ] The resume result covers the handoff record and all three payload-warning cases
- [ ] Every defect found is listed as a finding, and none is fixed in this task
- [ ] The Live check section of the maestro-architecture developer skill records the results

## Touched surfaces

- .claude/skills/maestro-architecture/SKILL.md (Live check section)
- No plugin, generated lib or version file changes, so no overlap with task 152

## Blocked by

None — can start immediately
