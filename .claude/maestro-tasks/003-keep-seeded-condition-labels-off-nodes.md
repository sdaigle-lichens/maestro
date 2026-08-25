# Keep seeded condition labels off the nodes they overlap

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Open a project that has no `.claude/maestro.json` and the canvas shows the starter configuration.
Several of its condition-edge labels render on top of the nodes below them — in the default
workflow, the route back from the review step lands squarely over the implementation node, and the
refactor routes overlap the nodes to their right. The text is unreadable and it makes a first
impression of a broken canvas on the one screen a new user is guaranteed to see.

This is not a canvas defect. The canvas honours a per-edge label offset and lets the user drag a
label anywhere; the seeded workflows simply ship no offsets, so every label sits at the midpoint of
its bezier — which, for the condition edges that arc back up the column, is inside a node.

Fix it where the geometry is decided. The seed already computes vertical rhythm from how many
skill chips each instance carries, so it knows enough about node extents to place labels that
clear them; the condition edges are generated in a handful of known shapes (a back-route up the
column, a sideways route to the refactor node), not arbitrary ones.

Two things to hold onto. The user must still be able to drag a label and have that stick — a
seeded offset is a starting position, not a lock. And the seed's output feeds the saved config, so
whatever is chosen becomes the offsets written to `maestro.json` on first save; they should look
deliberate in that file, not like noise.

Worth checking whether this is better solved once in the canvas — a label that avoids overlapping
node bounds would fix every workflow rather than the seeded ones — and taking that route instead
if it is not much more work. The acceptance criteria below are written to allow either.

## Acceptance criteria

- [ ] In a project with no `.claude/maestro.json`, every condition-edge label in the starter
      configuration is legible and clear of node bounds, verified by looking at a rendered window
- [ ] This holds for every seeded workflow variant, not only the default one — including the
      test-first variant and a multi-agent implementation chain, whose columns differ
- [ ] Labels stay clear when instances carry enough skill chips to make nodes noticeably taller
- [ ] Dragging a label still repositions it and the new position still survives a save and reopen
- [ ] Saving a freshly seeded project writes label positions that read as deliberate values
- [ ] Existing saved workflows are unaffected — a config that already has label positions opens
      exactly as before
- [ ] The known-issue entry for this in `docs/plans/review-m1-m2-outcome.md` is closed out

## Blocked by

None — can start immediately

Note: `docs/plans/core-absorption.md` moves the seeding logic into the app, and M3 reworks the
seeded implementation chain to come from repo detection. Neither blocks this, but if either is in
flight, land this on the side that avoids a conflict.
