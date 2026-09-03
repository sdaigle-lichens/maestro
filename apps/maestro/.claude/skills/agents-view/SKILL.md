---
name: agents-view
description: "Explains how the /agents view in the Maestro desktop app is built end-to-end: the three-pane shell and its 1120px scroller, the single edit session that fans out to six different write paths on Save, the loaded/referenced skill chips and their tri-state, the tabs-and-arrows avatar editor, and the load-bearing card min-height. Use when the user is working inside apps/maestro and asks how the agents page works, why a Save wrote to six places, why a description is written to the agent's own .md, why the skills section is read-only, why the card doesn't reflow when you press Edit, or where the Interactions pane is going next."
metadata:
  type: concept-skill
  version: "1.0"
  last-update: 5555a3e81af2255ebb44a312f5d932bd8dbdff8f
---

# Agents View

The `/agents` route (`src/renderer/src/routes/agents.tsx`) is where you browse the subagents a
project can dispatch, read the report a run would actually receive, and edit an agent's properties
and its cosmetic avatar in place.

It is the third of the app's editor routes, alongside `workflow-view` and `rule-view` — but unlike
those two it does **not** own one slice of one file. An "agent" as this page presents it is assembled
from six different homes, and that is the single fact everything else here follows from.

## Layout

```
┌───────────────────────────── TopNav (top-nav.tsx, unchanged) ─────────────────────────────┐
├──────────────────┬────────────────────────────────────────┬───────────────────────────────┤
│ Agents           │                                        │ Interactions            [▤]  │
│ [▤]              │        ┌────────────────────────┐      │                              │
│ [Filter agents…] │        │ probe-agent  DEVELOPER │      │ [Main Session]          [✎]  │
│                  │        │                        │      │ ┌──────────────────────────┐ │
│ ┌──────────────┐ │        │      ┌──────────┐      │      │ │ the resolved report,     │ │
│ │ backend  [✎] │ │        │  ‹   │  avatar  │   ›  │      │ │ capped at 50% and faded  │ │
│ │ [◲] desc…    │ │        │      └──────────┘      │      │ └──────────────────────────┘ │
│ └──────────────┘ │        │  Hair · Long Bangs     │      │  Project override — saving…  │
│ ┌──────────────┐ │        │ ── // DESCRIPTION ──   │      │                              │
│ │ frontend [✎] │ │        │ ── // SKILLS ──        │      │                              │
│ │ [◲] desc…    │ │        │ ── // PROJECT TAG ──   │      │                              │
│ └──────────────┘ │        └────────────────────────┘      │                              │
│ [+ New agent]    │                     [Cancel] [Save]    │◂ drag                        │
└──────────────────┴────────────────────────────────────────┴───────────────────────────────┘
      292px                        flex: 1, min 560px                 400px, 280–720
```

Both side panes collapse to their header row. The right pane is resizable by dragging its left edge.

**One horizontal scroller wraps the nav _and_ the pane row**, with an inner `min-width: 1120px`, so
chrome and content scroll together and nothing clips on a narrow window. There are no breakpoints —
this is a desktop window, so it has a floor rather than a set of layouts.

The page renders the real `TopNav` with no arguments. The page-local `ProjectSelect` the old version
carried is **gone**, and its removal fixed a latent split: the list was fetched for `viewedRoot`
while `reports.get` resolved against `currentRoot()`, so the two could describe different projects.
Everything on this page now reads the open project, and only the nav's folder button changes it.

## One edit session, six write paths

Pressing Edit — from the card footer, a list row's pencil, or the Interactions pencil — clones the
agent into a **draft** (deep-copying `layers` and `skills`). Every control edits the draft. Cancel
drops it. **Nothing touches disk until Save**, which then fans out to the channel that owns each
field:

| Field | Channel | Destination |
| --- | --- | --- |
| report | `report:save` | `.claude/reports/<agent>.md` — a **project override**, keyed by the agent's own name |
| avatar | `avatar:set` | `~/.claude/maestro-avatars.sqlite`, global |
| type | `template:agent-types:save` | `~/.claude/maestro-agent-types.sqlite`, global |
| project tag | `template:agent-project-tags:save` | `~/.claude/maestro-agent-project-tags.sqlite`, global |
| description | `agent:describe` | **the agent's own `.md` frontmatter** |
| skills | `config:save` (workflows slice) | `.claude/maestro.json`'s `workflow_instances` |

Each write is attempted only when that field actually changed, and **failures are collected per
field**: a partial failure toasts what failed and **stays in edit mode**, rather than closing the
editor as if the whole save had landed. There is no transaction across six stores — the honest
alternative is to say which parts got through.

Two of these are documented in depth elsewhere rather than restated here:

- **Why the description is a file write and not a seventh store** — see the "The exception: a
  description is not a store" section of [`global-stores`](../global-stores/SKILL.md). Short version:
  type/tag/avatar are Maestro's own metadata, but a description is the line Claude Code itself reads
  to decide when to dispatch the agent.
- **Why the skills write re-reads before writing** — see `maestro-config-model`'s read-before-write
  rule and `workflow-view`'s "no longer the only writer" note.

## Data in

The route holds no loader-driven state beyond the first paint. `refresh()` fans out five reads in
parallel, and re-runs on every project change and after every save:

```
getToolsData()                            → data.agents (id, description, source), data.skills
window.maestro.data.workflows()           → config.workflow_instances, config.skills_available, seeded
window.maestro.templates.agentTypes.list()        → Record<agent, AgentType>
window.maestro.templates.agentProjectTags.list()  → Record<agent, string>
window.maestro.avatar.list()                      → Record<agent, AvatarLayers>
window.maestro.templates.projectTags.list()       → the catalog for the dropdown
```

`avatar:list` exists because of this page. The list draws a composited thumb per row, and the
per-agent `avatar:get` would have been one sqlite open per agent on every render — see
`global-stores`' avatars sub-concept.

Only the **report** is refetched per selection, because it is the only per-agent thing that is
project-scoped.

## Skills are the instance's, not the agent's

The chips come from the first `workflow_instances` entry whose `agent` matches the selected agent,
flattened out of its two lists. `AgentSkill.mode` is therefore **tri-state**:

| `mode` | Means | On save |
| --- | --- | --- |
| `"loaded"` | in `loaded_skills` — the SubagentStart hook injects it before the agent works | stays in `loaded_skills` |
| `"referenced"` | in `referenced_skills` — offered, loaded only if the task needs it | stays in `referenced_skills` |
| `null` | on screen but unticked | dropped from **both** lists |

The third state is what lets the count read "2 of 3 active" without the chip vanishing the instant it
is unticked, so unticking is visibly reversible before Save.

**The loaded/ref toggle inside each chip is the one control the design did not draw**, and it is not
cosmetic: an instance keeps its skills in two lists, so a chip that showed only "attached" would let
a save silently demote every loaded skill to referenced. Ticking a fresh chip defaults it to
**referenced**, matching `instance-skill-picker.tsx` on the workflows canvas — offering a skill is
the reversible choice; loading one costs context on every run.

The `+` attaches the next unused entry from `config.skills_available`, which keeps `maestro.json`
internally consistent — an instance skill that is not in the project's available set is a config that
disagrees with itself.

Skills are **read-only** in two cases, both signposted in the footer note rather than by a silently
inert control: when the agent has no instance in this project's workflow, and when the config is
`seeded` (no `maestro.json` on disk). The second matters — writing would materialise a starter config
as a side effect of visiting `/agents`.

## The avatar block

`agent-avatar-block.tsx` is a **tabs-and-arrows** editor: eight category buttons pick the active
category, the two arrows cycle that category's options, and a dice button randomises all eight.
Optional categories include `null` ("none") in the cycle; the three required ones (body/head/eyes) do
not.

This **supersedes `avatar-picker.tsx`'s swatch-rows layout on this page only** — that component is
still what `/create-subagent` renders, so it was not deleted. The two were prototyped side by side:
swatch rows grow with the number of options and made the card 914px tall instead of 637px, tall
enough to push the details below the fold.

`AvatarCanvas` takes a `fill` prop here rather than a pixel `size`, because the frame is a responsive
`aspect-square` box whose width the layout decides (max 232px in view, 168px in edit — the arrows
need the room).

## Things that bite

- **`CARD_MIN_HEIGHT` is a measured constant, not a round number.** The card must be the same height
  in view and edit mode so pressing Edit does not reflow the page under the pointer. Measured in a
  real window: natural view height **607px**, natural edit height **627px**, so the floor is 627. If
  you change edit-mode card content, **re-measure and update it** — the `test-maestro` skill's CDP
  harness is how.
- **The single line of edit-mode explanation lives in the card's _footer_, outside the card.** That is
  the same constraint: an in-card note changes the card's height with its own wrapping, and the note
  is conditional (it changes for a plugin-owned agent, or one with no instance), so in-card it would
  make the height vary by agent.
- **Measuring that height by setting `card.style.minHeight = ""` deletes React's own inline
  declaration** until the next render, so every later measurement in the same probe silently loses the
  floor and reports a card that "doesn't respect its minimum". Save the previous inline value and
  restore *that*. This cost a probe run.
- **The description is not editable for every agent.** `EDITABLE_AGENT_SOURCES` in `contracts.ts`
  is `["project", "user", "maestro"]`; an installed plugin's agents render a read-only paragraph even
  in edit mode. The renderer decides from `DiscoveredDefinition.source` alone, with no round trip —
  which is why that constant is a value export from an otherwise interfaces-only file.
- **A pencil on an _unselected_ row cannot build the draft immediately.** That agent's report is still
  in flight, so `startEdit` sets `selected` plus a `pendingEdit` flag and an effect builds the draft
  once `base` resolves. Building it inline would clone a draft carrying the previously selected
  agent's report.
- **List descriptions are truncated in JS (`clampText`), deliberately not `-webkit-line-clamp`.** The
  clamp loses its ellipsis as a flex child and how many lines fit depends on the Chromium build; the
  untruncated text still goes in `title`.
- **`defaultAvatarLayers()` is what most rows show**, since most agents have never been customised.
  It returns the first option of every category except `hat` — it previously returned only the
  required three, which composites a naked sprite.
- **Two page-local surfaces are mixed from tokens, not hard-coded.** The design names `#2b2722` (side
  panes, avatar frame) and `#2f2b26` (the read-only report block) and the token set has neither, so
  `PANE_SURFACES` sets `--pane` and `--sunken` with `color-mix()` on the page root. They resolve to
  exactly those two hexes in dark mode and follow the theme in light. When asserting on them: a
  `color-mix()` result serialises as `color(srgb r g b)` with 0..1 channels, **not** as `rgb()`.
- **The right pane's drag writes width straight to the DOM and only tells React on mouseup.** A
  `setState` per `mousemove` re-renders the card, the list and every canvas on it, once per pixel.
- **The Interactions pane's single instance pair is a seam, not the final shape.** A Maestro agent can
  be instantiated more than once in a workflow; today `report-resolution.ts` resolves exactly one
  report per agent, so there is one "Main Session" header + body. The next change here makes it a list
  of such pairs, one per interaction instance.
- **`components/tabs/discovered-definitions.tsx` is still shared with `/skills`.** This page grew its
  own list (a skill has no avatar and no per-row pencil); do not widen the shared table to serve both.

## Files

| File | Role |
| --- | --- |
| `src/renderer/src/routes/agents.tsx` | State, the draft, the six-way save, the round trips. |
| `src/renderer/src/components/agents/agent-shared.ts` | `AgentDraft` / `AgentSkill`, the constants, `clampText`, `cycleOption`, `PANE_SURFACES`, the shared class strings. |
| `src/renderer/src/components/agents/agent-list.tsx` | Left pane. Holds the `/create-subagent` link. |
| `src/renderer/src/components/agents/agent-card.tsx` | Centre pane card + the Edit/Cancel/Save footer. |
| `src/renderer/src/components/agents/agent-avatar-block.tsx` | The frame in both modes, and the tabs+arrows editor. |
| `src/renderer/src/components/agents/interactions-pane.tsx` | Right pane, its resize handle and auto-growing editor. |
| `src/core/agent-descriptions.ts` | The node side of `agent:describe` — file resolution and the frontmatter rewrite. |
| `src/renderer/src/components/avatar/avatar-canvas.tsx` | Composites the layers; `fill` is this page's. |
| `test/core/agent-descriptions.test.ts` | The frontmatter rewrite's refusals and its byte-identical body. |

## Relationships

- [`global-stores`](../global-stores/SKILL.md) — four of the six write paths, and why the fifth
  (description) deliberately is not one.
- [`maestro-config-model`](../maestro-config-model/SKILL.md) — the workflows slice this page is the
  second writer of, and the read-before-write rule that follows.
- [`workflow-view`](../workflow-view/SKILL.md) — the other writer, and where `loaded_skills` /
  `referenced_skills` are normally edited.
- [`create-skills-architecture`](../create-skills-architecture/SKILL.md) — the `/create-subagent` flow
  this page's "+ New agent" link is the entry point for.
- [`test-maestro`](../test-maestro/SKILL.md) — how the measured numbers above were measured, and how
  to re-measure them.
