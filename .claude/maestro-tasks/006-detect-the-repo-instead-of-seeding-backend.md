# Detect the repo instead of seeding "backend"

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Step 4 of `docs/plans/m3-in-app-install.md`. Read that plan first — it lists the specific signals
to key on.

Opening an unconfigured project today hands back a starter configuration whose implementation-agent
chain is hardcoded to `["backend"]`, regardless of what the repo actually is. A frontend project
gets a backend agent, and the user's first impression of the canvas is a workflow that is wrong
about their codebase. Replace the constant with a heuristic that reads the repo.

**The heuristic must stand alone.** An optional LLM refinement is deferred to a later milestone's
confirmation modal; nothing here may depend on a model being available, because this runs on first
open of every project.

**Return the evidence, not just the answer.** The detection reports *why* it concluded what it did
— naming the dependencies or files it matched — so the UI can show "detected `react` and `express`
in package.json" rather than an unexplained choice the user is asked to trust. A detector that is
occasionally wrong but shows its reasoning is usable; one that is occasionally wrong and silent is
not.

**The user must be able to correct it before it is committed to.** Detection produces a proposal;
the user amends it and installs. Getting this wrong is low-stakes only if it is easy to override.

Note that the seeded configuration is still *unsaved* until the user presses save — the existing
"starter configuration, not saved" banner covers that and should keep working unchanged.

## Acceptance criteria

- [ ] A frontend-only repo, a backend-only repo, and a repo that is both each seed an
      implementation chain that matches, rather than a constant
- [ ] Repos with no JavaScript package manifest but other language markers are still detected
      rather than falling through to a default that ignores them
- [ ] An unrecognised repo falls back to a sensible default instead of seeding an empty chain
- [ ] The detection result carries human-readable evidence naming what it matched
- [ ] The evidence is surfaced in the UI next to the detected agents, before install
- [ ] The detected chain is editable by the user before anything is written
- [ ] Detection requires no model and no network, and does not noticeably delay first open of a
      large repo
- [ ] The seeded configuration is still reported as unsaved until the user saves it
- [ ] Detection is covered by tests over fixture repo layouts, one per signal class

## Blocked by

- `004-install-and-update-the-runtime-from-the-app.md`
