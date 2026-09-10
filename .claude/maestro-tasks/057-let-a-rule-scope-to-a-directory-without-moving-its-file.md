# Let a rule scope to a directory without moving its file

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`/rules`' directory assignment has exactly one behavior today: assigning a project rule to a
directory **moves** its file into `<assignedDir>/.claude/rules/` (`applyRules` in
`apps/maestro/src/core/rules.ts`, mirrored by `plugins/maestro/scripts/maestro-apply-rules.js`).
That is the right behavior for most projects, and the wrong one whenever the assigned directory is
somewhere a `.claude/` directory must not exist — which this repository's own `CLAUDE.md` says about
everything under `plugins/<name>/`, while also being the repo that most wants a rule scoped there
(`.claude/rules/plugin-publishing.md`, added in `056`).

Right now this repo's own `.claude/maestro.json` carries an assignment
(`{ id: "plugin-publishing", paths: ["plugins/maestro/**"] }`) that a real `/rules` Save would
apply by moving the rule file into `plugins/maestro/.claude/rules/` — recreating the exact violation
the rule exists to prevent. The assignment was hand-written into the config without ever running the
real apply step, specifically to avoid that. See `rule-view`'s "Things that bite" (the entry this
task's title answers) for the full account and the three options considered.

Add a second mode to directory-scoped rule assignment: **scope without move.** The rule's `id` and
`paths` are assigned exactly as today, but `source` (or a new field — this is a design decision, not
a given) tells `applyRules` to leave the file where it is on disk. A project's own conventions decide
which mode a given assignment needs; the UI needs some way to express the choice per assignment
(a toggle on the row, a modifier on the picker — again a design decision).

## Skills to use

Load these before you start:

- `rule-view` — the mechanism this changes: the slice shape, `applyRules`, the two implementations
  that must stay mirrored, and the "Things that bite" entry that names this exact contradiction
- `maestro-config-model` — the `MaestroRuleV3` shape in the rules sub-concept
- `updating-maestro` — if this touches the plugin script, the version bump it carries

## When you're done

End by handing off to the **@scribe** agent with the `scribe` skill loaded, so `rule-view` and the
rules sub-concept get the new mode folded in and this task's "Things that bite" entry gets replaced
with what actually shipped — including, once this lands, correcting this repo's own
`plugins/maestro/**` assignment to use the new mode and re-running a real Save so config and disk
agree for the first time.

## Acceptance criteria

- [ ] A directory-scoped rule assignment can be marked "scope only" and `applyRules` (both
      implementations) leaves the file in place for that mode while still moving it for the existing
      default mode
- [ ] The `/rules` UI can express the choice per assignment, not just per rule
- [ ] `plugins/maestro/scripts/maestro-apply-rules.js` and `apps/maestro/src/core/rules.ts` stay in
      step with each other for the new mode, the way they already must for the existing one
- [ ] This repo's own `plugin-publishing` assignment is switched to the new mode and a real Save
      applied, so `.claude/maestro.json` and `.claude/rules/plugin-publishing.md`'s actual location
      agree with no hand-edited workaround left behind
- [ ] `rule-view`'s "Things that bite" entry on this contradiction is replaced with a description of
      the shipped mode
- [ ] Handed off to the @scribe agent with the `scribe` skill loaded

## Blocked by

None — can start immediately
