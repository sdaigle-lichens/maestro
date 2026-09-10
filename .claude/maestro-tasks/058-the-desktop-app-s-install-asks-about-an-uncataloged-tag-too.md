# The desktop app's install asks about an uncataloged tag too

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Close the other half of the uncataloged-project-tag gap, so the two install paths stop disagreeing about what a repository is.

**The state after the previous slice.** The terminal install skill now names the categories detection supports in its question text, says plainly that a project may carry several, and — when detection produces a category the tag catalog has never heard of — offers to add it, adding it only on the user's say-so. Its multi-select was corrected since: `AskUserQuestion` cannot pre-tick an option, so **what the user checks is exactly what gets recorded**, with no option whose meaning depends on its tick state. The app's consent step is free to pre-check the detected set — its own UI can — but the recorded result must match what the terminal path produces for the same answer. The desktop app's install path got none of that. It still intersects the detected categories against the catalog in one unguarded filter and writes the survivors, so a category the catalog lacks is discarded with no message, no record in the install report, and nothing on screen.

This is latent today and becomes real the moment a new detection category ships: the catalog seeds only when its table is empty, so every machine that has ever read it holds exactly the originally-seeded categories forever. The first user to install into an infrastructure repository through the app will have it detected correctly and recorded as nothing.

**The constraint that shapes the fix.** The seeding step lives inside a non-interactive function — it cannot prompt, and it must not start. Deciding on the user's behalf is precisely the bug. So the core's job is to stop *deciding* and start *reporting*: the install result should carry the categories detection produced that the catalog does not contain, distinctly from the ones it recorded. The consent step then belongs to the caller that has a user in front of it.

Where that leaves the user-facing half is a real design choice and should be made deliberately rather than by whichever is easier to wire: asking before the seed happens, or seeding without the tag and offering to add it afterwards with a reseed. Prefer the option that does not leave a correct config unreachable if the user closes the window — a config missing a tag that the user can add later is recoverable; a blocked install is not.

**Accepting means two writes, not one.** The category is added to the machine-wide catalog *and* recorded in this project's tags. Adding it to the catalog alone leaves the project still recording nothing, which is the same bug with an extra step.

**The direction of the offer is the invariant to protect.** Detection may propose an entry to the catalog; the catalog must never drive detection. Nothing added here may read the catalog to decide what a repository is, and a tag someone types in by hand still gets no automatic evidence. That asymmetry is documented in the store and was deliberately preserved by the previous slice.

Declining, and any path with no user attached, must keep today's behaviour exactly — the tag is dropped rather than recorded, so the existing guarantee that only real catalog entries reach the config still holds.

## Skills to use

Load these before you start — they carry what this task needs, and reading them beats
rediscovering the same thing from source:

- `installing-maestro` — the two install implementations that must agree, and the install report they produce
- `global-stores` — the tag catalog's seed-once-when-empty behaviour, which is the root of the gap
- `maestro-config-model` — the `project_tags` slice being written
- `updating-maestro` — whether this carries a version bump, and which component

## When you're done

Run the project's `default` workflow to completion — its success path is implementation → human
review → **@test** → **@reviewer** → **@scribe**. Do not treat the documentation step as a shortcut
past the two before it. When you reach **@scribe**, load the `scribe` skill: it is the routing rule
for what belongs in a concept skill versus in `docs/`, and it has to be in context before anything
is written. Two concept skills already record this gap as open — closing it means updating them
rather than leaving the note behind.

## Acceptance criteria

- [ ] The app's first-install seed no longer discards a detected-but-uncataloged category silently — the install result distinguishes the categories recorded from the ones detection produced that the catalog lacks
- [ ] The consent decision is made by a caller with a user in front of it, not inside the non-interactive seeding function, which neither prompts nor decides
- [ ] Accepting writes the category to the machine-wide catalog and to this project's recorded tags; adding it to only one of the two is a failure
- [ ] Declining, or any path with no user attached, drops the category exactly as today, and the existing assertion covering that still passes unchanged
- [ ] Nothing added here reads the catalog to influence repository classification; the detection signal tables remain fixed per-category code
- [ ] Installing the same repository through the app and through the terminal skill, answering the offer the same way, produces the same `project_tags`
- [ ] A category already in the catalog is recorded without any offer being raised, on both paths
- [ ] If the slice changes published plugin surface, `plugin.json` is bumped; if it does not, no version change is made
- [ ] Handed off to the @scribe agent with the `scribe` skill loaded, and the concept skills recording this as an open gap are updated

## Blocked by

None — can start immediately
