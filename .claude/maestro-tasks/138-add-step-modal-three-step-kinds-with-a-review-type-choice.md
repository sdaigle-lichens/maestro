# Add-step modal: three step kinds with a review type choice

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

In the desktop app's workflow canvas, the modal that adds a step now offers four side-by-side buttons (agent, human review, manager review, skill), which are cramped. Change it to three step kinds: Agent, Skill and Review. Choosing Review shows a second choice between Human (selected by default) and Manager, which adds a human_review or manager_review node exactly as the two separate buttons do today. Make the add-step modal wider so the choices and their fields have room. Includes the renderer change and component tests for the new choice (Review defaults to Human, Manager adds a manager_review node); the saved maestro.json shape does not change. Nothing under plugins/ changes, so no version bump.

## Acceptance criteria

- [ ] The add-step modal shows three step kinds: Agent, Skill and Review
- [ ] Choosing Review shows Human and Manager, with Human selected by default
- [ ] Adding a Review with Human creates a human_review node, and with Manager a manager_review node, saved to maestro.json as before
- [ ] The add-step modal is wider than before and its choices are no longer cramped
- [ ] Tests cover the default and both review types; pnpm verify passes

## Blocked by

None — can start immediately
