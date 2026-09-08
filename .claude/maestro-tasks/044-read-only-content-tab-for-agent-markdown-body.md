# Read-only Content tab for agent markdown body

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Add a two-tab strip to the Agents view's right side panel (Interactions pane): "Interactions" (default — today's existing resolved-report + handoff-routes list, pixel-for-pixel unchanged) and "Content" (new). The Content tab shows the selected agent's full markdown body — everything after its YAML frontmatter block — read-only at this stage, for agents of every tier (project, user, maestro/bundled, plugin). Add the core-level logic to resolve an agent's file across the existing tier order and extract its body (the frontmatter block itself is never shown here), and the round trip to fetch it, following the same per-selection-read pattern the pane already uses for the resolved report and handoff routes. Switching the selected agent while the Content tab is active must refresh its contents to the newly selected agent.

## Acceptance criteria

- [x] Interactions pane renders two tabs, "Interactions" and "Content"; "Interactions" is selected by default and its rendered content and behavior are unchanged from today. Evidence: CDP probe against a two-agent fixture project showed `interactions-list` present and `agent-content` absent before any tab click; `interactions-list`'s own JSX is byte-for-byte unchanged.
- [x] Selecting the Content tab shows the selected agent's markdown body (everything after the closing frontmatter `---`), for agents of every tier. Evidence: CDP probe — clicking the Content tab showed `agent-content` matching the fixture file's post-frontmatter content; tier walk itself (project/user/maestro/plugin) is `findAgentFile`, already covered by `setAgentDescription`'s own tier-order tests.
- [x] Switching the selected agent while the Content tab is active updates it to the newly selected agent's body. Evidence: CDP probe — selecting the second fixture agent while Content stayed active replaced the body text with the second agent's own ("SECOND agent's body"), first agent's text gone.
- [x] A core-level test verifies the extracted body is byte-identical to the source file's content after the frontmatter block, for a representative agent file. Evidence: `test/core/agent-descriptions.test.ts`'s new `extractAgentBody`/`getAgentBody` describe blocks assert `source.endsWith(body)` and an exact-string reconstruction.

## Divergences from the brief

- No new tier-resolution logic was written. `findAgentFile` (already used by `agentDescribe`/`setAgentDescription`) already walks project → user → maestro/bundled → plugins, so only the body-extraction half (`extractAgentBody`, plus `getAgentBody` composing it with `findAgentFile`) is new.
- The `agent:content` IPC channel returns a plain `string` (the body only), not a `{ body, source }` shape — the acceptance criteria never asked the Content tab to show which tier it resolved from (unlike the report/handoff panes, which do show a tier label), so no tier metadata crosses the wire.

## Blocked by

None — can start immediately
