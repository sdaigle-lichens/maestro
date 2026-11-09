# Cut the number of backend-test-fix rounds in the Backend workflow

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Task 160 took nine test-and-fix rounds. @backend classified free text with no written grammar, so
each fix patched one rule and @test then found the neighbouring case. Rounds 7 and 8 were the same
defect class. Change this repository's Backend workflow, its handoffs and its test agent so a loop
like that ends sooner. This changes only this repository's own Maestro setup
(`.claude/maestro.json`, `.claude/handoffs/`, `.claude/agents/test.md`), not the plugin.

1. **Defect class in the test -> backend handoff.** The test -> backend payload gains a `defectClass`
   (a short name for the kind of defect) and a `sameClassProbes` list: the other inputs of that class
   that @test checked or expects to fail. @backend then fixes the whole class in one round.
2. **Written grammar for free-text classification.** When the change classifies free text (regexes,
   label parsing, prefix or keyword checks), the backend -> test payload carries the written grammar,
   with accepted forms, rejected forms and one example of each. @backend writes it before coding, and
   @test derives its edge sweep from it.
3. **Escalate a repeating defect class to refactor.** A new edge test -> refactor fires when the
   test -> backend payload's `defectClass` equals the one in the previous two backend rounds of the
   same run. This is a recorded comparison, not @test's impression. @refactor reports whether the
   defects come from the design, and its existing refactor -> backend edge sends the fix back.

Out of scope:
- Narrowing @test's FAIL rule and a `documentedLimits` list. Dropped at the manager review: on 160,
  @test cited a real acceptance criterion for the repeated rounds, so the saving is unproven, and it
  would let defects through on tickets with thin criteria.
- One probe file per feature. Dropped as tidiness only; no round failed because of it.
- The plugin's seeded workflow and handoff defaults for all projects. That is a separate follow-up
  once this has been tried here. This repo's backend/test handoffs are already customized against
  the seed, so a seed change would not reach this repo anyway.
- Forking @backend, and moving the test-maestro-desktop skill to loaded.

Evidence: the Post-Mortem section of 160-stop-flagging-hand-off-issues-on-an-agent-s-interim-stops.md
and the team meeting on task 160.

## Acceptance criteria

- [ ] The test -> backend handoff template asks for `defectClass` and `sameClassProbes`, and the backend side is told to fix the whole class
- [ ] The backend -> test handoff template asks for the written grammar (accepted and rejected forms, one example of each) when the change classifies free text, and says @test derives its edge sweep from it
- [ ] The Backend workflow has a test -> refactor edge whose condition is the same `defectClass` in the previous two backend rounds of the run, and the existing refactor -> backend edge still returns the fix
- [ ] `.claude/agents/test.md` states how @test records `defectClass` and compares it with earlier rounds
- [ ] No file under `plugins/` changes; the rendered orchestrator matches `maestro.json` (re-render it if the edge changes the HANDOFFS table), and `pnpm verify` passes
- [ ] The concept notes that describe the Backend workflow and the handoffs under `.claude/skills/maestro-architecture` reflect the change

## Touched surfaces

- .claude/maestro.json (Backend workflow edges)
- .claude/handoffs/backend/test.md and .claude/handoffs/test/backend.md
- .claude/agents/test.md (project agent, no fork needed)
- the rendered orchestrator `.claude/skills/maestro/SKILL.md` (HANDOFFS)
- concept notes under .claude/skills/maestro-architecture
- No plugin.json bump: no file under plugins/ changes
- merge order: after 165 and 166 (last in the epic). It changes the workflow and agents every session runs on, so other epics' managers get a note before it merges.

## Blocked by

- `165-ask-where-each-displayed-number-comes-from-in-to-maestro-tasks-and-show-every-outcome-in-the-post-mortem-digest.md`
- `166-seed-the-manager-review-loop-back-edges-with-the-app-s-direction-change-label.md`
- `168-re-review-and-stamp-the-maestro-architecture-concept-skill-after-tasks-160-and-163.md`
