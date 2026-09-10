# Install discovery sees every skills directory in the tree

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Make an install find all of a project's own skills, and give this repository's publishing discipline a home an agent will actually read.

**The bug.** Two readers in this codebase answer the question "what skills does this project have", and they disagree. One reads a single directory — the repository root's `.claude/skills/`. The other walks every `.claude/skills` in the tree, and is what the concept-skill machinery uses. Both install paths — the desktop app's and the terminal skill's step 3 — use the narrow one.

On a monorepo the effect is severe and completely silent. This repository's own install recorded seven entries in `skills_available`: the five concept skills at the root, the bundled design-check gate, and the scribe routing rule. The twelve concept skills living beside the app they document were invisible, so the frontend instance was seeded with **no skills at all** on a repository that ships a canvas skill and a canvas-geometry skill, and the skill whose entire purpose is preventing a hand-edit of a generated bundle — a failure mode documented as passing every test — was offered to nobody.

The fix is to use the tree-walking reader on both install paths. Two things to be careful about while doing it: the walk must stay bounded the way the existing one is rather than becoming a scan of the whole repository, and a skill's identity must not change — the id is the directory name unless frontmatter overrides it, and the canvas, the tag store and the config all key on that. Two skills in different directories sharing a name is now reachable in a way it was not before, so decide what happens and make it visible rather than letting one silently win.

The skill-to-agent mapping that runs at install time reads the tag store keyed by skill id, so newly-discovered skills with no tags recorded simply fall through to the existing best-fit path — that is the intended behaviour, not a gap to close here.

**The second half: this repository's publishing discipline becomes a rule.** The rules slice is a project's way of attaching a standing constraint to a directory, and this repository has never used it — the slice is empty — while carrying exactly the kind of constraint it is for. Everything under the published plugin directory has rules that are invariant, directory-scoped, and expensive to get wrong: the generated libraries are generated and must never be hand-edited, every change there must bump the plugin manifest's version or it reaches nobody, nothing that exists to help someone develop this repository may ship there, and hook scripts are copied into a project under a different extension than the one they run under in the plugin. Those live today only in prose that an agent has to know to go and read.

Write them as a rule assigned to that directory. Keep it to the invariants an agent can violate in a single edit — this is not a second copy of the concept skills, and anything that needs explaining rather than obeying belongs in the skill it already lives in.

Finally, the highest-stakes skills should not be optional. Skills attach to an instance in two modes, and everything this project's install recorded landed in the load-only-if-relevant mode. For the ones whose failure is silent rather than loud — the generated-bundle parity rule and the change-delivery rule — promote them so they are in context before the agent starts, the way the documentation-routing skill already is.

## Skills to use

Load these before you start — they carry what this task needs, and reading them beats
rediscovering the same thing from source:

- `installing-maestro` — the install pipeline and what it discovers today
- `concept-skills-system` — the tree-walking skill discovery this must adopt, and how a skill's id is decided
- `rule-view` — the rules slice, the directory tree, and how a save moves rule files
- `maestro-config-model` — the shape of the rules slice being written
- `updating-maestro` — the version bump this carries

## When you're done

End by handing off to the **@scribe** agent with the `scribe` skill loaded. It is the routing rule
for what belongs in a concept skill versus in `docs/`, and it has to be in context before anything
is written. This slice changes behaviour that the concept skills already describe, so updating them
is part of the change rather than a follow-up.

## Acceptance criteria

- [ ] Both install paths discover skills from every `.claude/skills` directory in the project tree, not only the repository root's
- [ ] The discovery stays bounded in the same way the existing tree walk is, rather than scanning the whole repository
- [ ] A skill's id is unchanged by this — still the directory name unless frontmatter overrides it — and a name collision between two directories is handled deliberately and visibly rather than silently resolved
- [ ] Re-seeding this repository from scratch records the concept skills that live beside the app, and the frontend instance is no longer seeded with an empty skill list
- [ ] A newly-discovered skill with no tags recorded falls through to the existing best-fit assignment rather than erroring
- [ ] A rule carrying the published-plugin directory's invariants exists and is assigned to that directory through the rules slice
- [ ] The rule states only what an agent can violate in one edit; explanation stays in the concept skills that already hold it
- [ ] The generated-bundle parity and change-delivery skills are attached in the auto-load mode rather than the load-if-relevant mode
- [ ] Any change to published plugin surface in this slice carries a `plugin.json` version bump
- [ ] Handed off to the @scribe agent with the `scribe` skill loaded, and the concept skills this change affects are updated

## Blocked by

None — can start immediately
