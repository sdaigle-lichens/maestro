# Read-only Content tab for agent markdown body

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Add a two-tab strip to the Agents view's right side panel (Interactions pane): "Interactions" (default — today's existing resolved-report + handoff-routes list, pixel-for-pixel unchanged) and "Content" (new). The Content tab shows the selected agent's full markdown body — everything after its YAML frontmatter block — read-only at this stage, for agents of every tier (project, user, maestro/bundled, plugin). Add the core-level logic to resolve an agent's file across the existing tier order and extract its body (the frontmatter block itself is never shown here), and the round trip to fetch it, following the same per-selection-read pattern the pane already uses for the resolved report and handoff routes. Switching the selected agent while the Content tab is active must refresh its contents to the newly selected agent.

## Acceptance criteria

- [ ] Interactions pane renders two tabs, "Interactions" and "Content"; "Interactions" is selected by default and its rendered content and behavior are unchanged from today.
- [ ] Selecting the Content tab shows the selected agent's markdown body (everything after the closing frontmatter `---`), for agents of every tier.
- [ ] Switching the selected agent while the Content tab is active updates it to the newly selected agent's body.
- [ ] A core-level test verifies the extracted body is byte-identical to the source file's content after the frontmatter block, for a representative agent file.

## Blocked by

None — can start immediately
