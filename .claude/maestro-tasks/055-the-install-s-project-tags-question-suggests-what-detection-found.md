# The install's project-tags question suggests what detection found

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Fix the install flow's project-tags step so it reflects what repository detection already worked out, and so a newly-shipped detection category can reach a catalog that has already been seeded.

Three problems, one step.

**Nothing is pre-selected.** The install asks which catalog entries the project belongs to as a multi-select, and the skill explicitly instructs that nothing be pre-ticked. Detection has, by that point, already classified the repository and produced its evidence — so the user is asked to re-derive by hand an answer the install is already holding. The observed result is a project seeded with two implementation agents and one project tag, because the two came from different questions and only one of them was pre-filled. Pre-select the entries detection supports, leaving every one of them un-tickable-away only by the user's own choice.

**The question reads as single-select.** Whatever the mechanism allows, a user came away from the install believing a project could carry only one tag. Make the multi-select nature unmistakable in the question text and in the confirmation the install reports afterwards, and check the fallback path used when the catalog is too large to list as options — that path accepts a comma-separated reply and must obviously accept more than one name.

**A newly-shipped detection category can never reach an existing catalog, and is dropped in silence.** The catalog seeds only when its table has zero rows, so any machine that has ever read it holds exactly the originally-seeded categories forever. The install then intersects the confirmed tags against that catalog, so a category detection knows about but the catalog has never heard of is discarded with no message. This is not hypothetical: it is what will happen to every existing user the moment a new detection category ships. So when detection produces a category the catalog does not contain, **offer to add it** — as part of the same question, not a separate one — and add it to the catalog only on the user's say-so.

**The direction of that offer is the constraint that matters.** Detection may propose an entry *to* the catalog; the catalog must never drive detection. The signal tables that classify a repository stay fixed code with per-category logic, and a tag someone types into the catalog by hand still gets no automatic evidence. That asymmetry is deliberate and documented in the store, and this slice must not erode it: nothing here should read the catalog to decide what a repository is.

Declining the offer, or a non-interactive install, must keep today's behaviour — the unknown tag is dropped rather than recorded, so the existing guarantee that only real catalog entries are ever written to the config still holds.

## Skills to use

Load these before you start — they carry what this task needs, and reading them beats
rediscovering the same thing from source:

- `installing-maestro` — the install pipeline and its project-tags step
- `global-stores` — the catalog's seed-once-when-empty behaviour, which is the root of the dropped-tag bug
- `updating-maestro` — the version bump this carries

## When you're done

End by handing off to the **@scribe** agent with the `scribe` skill loaded. It is the routing rule
for what belongs in a concept skill versus in `docs/`, and it has to be in context before anything
is written. This slice changes behaviour that the concept skills already describe, so updating them
is part of the change rather than a follow-up.

## Acceptance criteria

- [ ] The project-tags question arrives with the detection-supported entries already selected, and the user can deselect any of them
- [ ] The question and the post-install report both make it unmistakable that a project may carry several tags, including on the large-catalog fallback path
- [ ] When detection produces a category absent from the catalog, the same question offers to add it, and it is added only when the user accepts
- [ ] Declining the offer, or running the install non-interactively, drops the unknown tag exactly as today — the config still records only real catalog entries
- [ ] Nothing added here reads the catalog to influence repository classification; the detection signal tables remain fixed per-category code
- [ ] A project whose repository detects as two categories ends the install with both recorded, rather than one
- [ ] The existing assertion that a detected category absent from the catalog is dropped still holds for the declined and non-interactive paths, with any new accepted-path behaviour covered by its own case
- [ ] Handed off to the @scribe agent with the `scribe` skill loaded, and the concept skills this change affects are updated

## Blocked by

None — can start immediately
