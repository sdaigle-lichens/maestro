# Ship it: the terminal install path produces the same graph

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Close the delivery half, so the new behaviour actually reaches a project rather than only the desktop app's own canvas.

Three distinct things, each with its own silent failure mode.

**The generated bundle.** The seeding logic reaches the plugin's install script through a committed CJS bundle generated from the TypeScript source. Nothing rebuilds it automatically and nothing fails when it is stale — the committed bundle keeps working and every test keeps passing, and the only symptom is that the terminal install path goes on seeding the previous graph. Regenerate it and read the resulting diff rather than trusting a green suite.

**The install skill's own detection prose.** The published install skill carries a prose description of the repository-classification step, written for a session doing the analysis by hand. It currently describes only the application categories. It needs the infrastructure branch, including the precedence rule, so that a session-driven install and the app's deterministic detection reach the same chain for the same repository. It also documents the seeded-agent list that the install's skill-mapping step intersects against, which is now chain-dependent.

**The version bump.** The marketplace cache is keyed by the plugin's version string and `autoUpdate` only re-pulls on inequality, so any change under the published plugin directory that ships without a bump reaches nobody, silently. Bump the component that matches what a consumer sees change.

The acceptance test for the whole feature is that both install paths agree: the deterministic desktop path and the terminal path must produce the same starter configuration for the same infrastructure repository, because they are meant to be the same seeding function reached two ways.

## Skills to use

Load these before you start — they carry what this task needs, and reading them beats
rediscovering the same thing from source:

- `plugin-libs-parity` — regenerating the bundle, and why a stale one fails silently with a green suite
- `updating-maestro` — the two delivery paths and the version-bump rule that decides whether a change reaches anyone
- `installing-maestro` — the terminal install path whose output must match the app's

## When you're done

End by handing off to the **@scribe** agent with the `scribe` skill loaded. It is the routing rule
for what belongs in a concept skill versus in `docs/`, and it has to be in context before anything
is written. This slice changes behaviour that the concept skills already describe, so updating them
is part of the change rather than a follow-up.

## Acceptance criteria

- [ ] The generated seeding bundle is rebuilt from source, and its diff is inspected and explained rather than assumed correct
- [ ] The bundle's export surface is still a superset of what the install script requires, and the bundle that must stay free of the sqlite import still is
- [ ] The published install skill's repository-classification step describes the infrastructure branch and its precedence rule, matching the deterministic detection's behaviour
- [ ] The install skill's account of which agents a seed creates reflects that the set is now chain-dependent
- [ ] `plugin.json` version is bumped, with the component chosen to match what a consumer of the plugin sees change
- [ ] Running the terminal install against an infrastructure repository and seeding the same repository through the desktop app produce the same starter configuration
- [ ] Handed off to the @scribe agent with the `scribe` skill loaded, and the concept skills this change affects are updated

## Blocked by

- `052-an-infrastructure-chain-seeds-a-simpler-starter-graph.md`
- `058-the-desktop-app-s-install-asks-about-an-uncataloged-tag-too.md`
