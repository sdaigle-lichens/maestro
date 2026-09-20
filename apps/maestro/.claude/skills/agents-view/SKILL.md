---
name: agents-view
description: "Explains how the /agents view in the Maestro desktop app is built end-to-end: the three-pane shell and its 1120px scroller, the Project/Global left-pane split, the single edit session that fans out to eight different write paths on Save, why only the description (and, since `045`, the Content tab body) locks on a Global-tier card and how forking a global agent into the project works, the loaded/referenced skill chips and their tri-state, the tabs-and-arrows avatar editor, the Interactions pane's two tabs — Interactions (the resolved report plus one editor per outgoing handoff route, each labelled since `037` with the `.claude/channels/<receiver>/<sender>.1.md` lane path its template writes to) and Content (`044`, `045` made it editable for project-tier agents via `setAgentContent`/`replaceBodyInFrontmatter`, gated on the same `EDITABLE_AGENT_SOURCES` check as the description) — the fork-review block that renders below the card, and the load-bearing card min-height. Use when the user is working inside apps/maestro and asks how the agents page works, why a Save wrote to eight places, why a description or a Content tab body is written to the agent's own .md, why an agent's description or content can't be edited, how the "Copy into the project" button works, why a forked agent is flagged as behind its template and what update/keep/detach do, why the skills section is read-only, why the card doesn't reflow when you press Edit, how the Interactions pane's per-route handoff editors work, why a route shows (or doesn't show) a channel lane path, or how the Content tab resolves, shows and (for project-tier) saves an agent's markdown body."
metadata:
  type: concept-skill
  version: "1.13"
  last-update: 4a94620c64a136a5b12d3df435b0b033a32f17a9
---

# Agents View

The `/agents` route (`src/renderer/src/routes/agents.tsx`) is where you browse the subagents a
project can dispatch, read the report a run would actually receive, and edit an agent's properties
and its cosmetic avatar in place.

It is the third of the app's editor routes, alongside `workflow-view` and `rule-view` — but unlike
those two it does **not** own one slice of one file. An "agent" as this page presents it is assembled
from seven different homes, and that is the single fact everything else here follows from.

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
│ ┌──────────────┐ │        │ ── // DESCRIPTION ──   │      │ → test                  [✎]  │
│ │ frontend [✎] │ │        │ ── // SKILLS ──        │      │ ┌──────────────────────────┐ │
│ │ [◲] desc…    │ │        │ ── // PROJECT TAG ──   │      │ │ handoff_details protocol │ │
│ └──────────────┘ │        └────────────────────────┘      │ └──────────────────────────┘ │
│ [+ New agent]    │                     [Cancel] [Save]    │◂ drag                        │
└──────────────────┴────────────────────────────────────────┴───────────────────────────────┘
      292px                        flex: 1, min 560px                 400px, 280–720
```

The left pane is two labelled sections, **Project** and **Global** (`agent-list.tsx`'s
`SectionLabel`) — `source === "project"` vs. everything else — shown only when non-empty. Since
`discoverAgents` already runs `dedupeById` over project → user → bundled → plugins (first wins),
every agent appears in exactly one section, and forking one moves its row from Global to Project on
the next refresh — that movement is the confirmation the fork worked, no toast needed. The card
carries a matching uppercase tier tag next to the agent name.

Both side panes collapse to their header row. The right pane is resizable by dragging its left edge.

**One horizontal scroller wraps the nav _and_ the pane row**, with an inner `min-width: 1120px`, so
chrome and content scroll together and nothing clips on a narrow window. There are no breakpoints —
this is a desktop window, so it has a floor rather than a set of layouts.

The page renders the real `TopNav` with no arguments. The page-local `ProjectSelect` the old version
carried is **gone**, and its removal fixed a latent split: the list was fetched for `viewedRoot`
while `reports.get` resolved against `currentRoot()`, so the two could describe different projects.
Everything on this page now reads the open project, and only the nav's folder button changes it.

## One edit session, eight write paths

Pressing Edit — from the card footer, a list row's pencil, or *any* of the Interactions pane's
pencils — clones the agent into a **draft** via `cloneDraft(base)` (`agents.tsx`), which deep-copies
`layers`, `skills` **and** `handoffs`; a shallow spread would edit `base` and make Cancel a no-op.
Every control edits the draft. Cancel drops it. **Nothing touches disk until Save**, which then fans
out to the channel that owns each field:

| Field | Channel | Destination |
| --- | --- | --- |
| report | `report:save` | `.claude/reports/<agent>.md` — a **project override**, keyed by the agent's own name |
| handoffs (`034`) | `handoff:save`, once per edited route | `.claude/handoffs/<sender>/<receiver>.md` — a project override, and it **drops that pair's `syncedFrom`** |
| avatar | `avatar:set` | `~/.claude/maestro-avatars.sqlite` — global, or this project's own row (see below) |
| type | `template:agent-types:save` | `~/.claude/maestro-agent-types.sqlite` — global, or this project's own row |
| project tag | `template:agent-project-tags:save` | `~/.claude/maestro-agent-project-tags.sqlite` — global, or this project's own row |
| description | `agent:describe` | **the agent's own `.md` frontmatter** |
| content (`045`) | `agent:content:save` | **the same `.md`'s body**, everything past the frontmatter block |
| skills | `config:save` (workflows slice) | `.claude/maestro.json`'s `workflow_instances` |

Each write is attempted only when that field actually changed, and **failures are collected per
field**: a partial failure toasts what failed and **stays in edit mode**, rather than closing the
editor as if the whole save had landed. There is no transaction across eight destinations — the
honest alternative is to say which parts got through.

The two least obvious paths are documented with the pane that owns them: the **content** write
(`setAgentContent`/`replaceBodyInFrontmatter`, the mirror image of the description write) and the
**handoff** write (the only path that is a list, and the only one that re-reads after writing) are
both in [`interactions-pane`](sub-concepts/interactions-pane.md).

**Avatar/type/project-tag are global or project-scoped depending on the selected agent's tier
(`030`).** `handleSave()` computes `const projectScoped = agent?.source === "project"` from the
already-in-scope `DiscoveredDefinition` and passes it as the trailing argument to all three writes
(`avatar.set`, `agentTypes.save`, `agentProjectTags.save`). Editing a `user`/`maestro`/plugin-tier
agent still writes the one shared global row, exactly as before `030`; editing a project-tier agent
scopes the write to the open project, so two projects with a same-named agent no longer collide.
`refresh()`'s three bulk reads (`agentTypes.list`, `agentProjectTags.list`, `avatar.list`) always
pass `true` — this page wants the merged (global ∪ open-project) view regardless of which agent is
selected. See [`global-stores`](../global-stores/SKILL.md)'s "Keyed by project, not just agent
name" section for the store-level mechanism.

Two of these are documented in depth elsewhere rather than restated here:

- **Why the description (and, since `045`, the content) is a file write and not a store** — see the
  "The exception: a description is not a store" section of [`global-stores`](../global-stores/SKILL.md).
  Short version: type/tag/avatar are Maestro's own metadata, but a description and a body are what
  Claude Code itself reads to decide when to dispatch the agent and how it behaves — the same
  argument, extended to the second file-backed field.
- **Why the skills write re-reads before writing** — see `maestro-config-model`'s read-before-write
  rule and `workflow-view`'s "no longer the only writer" note.

## Data in

The route holds no loader-driven state beyond the first paint. `refresh()` fans out seven reads in
parallel, and re-runs on every project change and after every save:

```
getToolsData()                            → data.agents (id, description, source), data.skills
window.maestro.data.workflows()           → config.workflow_instances, config.skills_available, seeded
window.maestro.templates.agentTypes.list(true)        → Record<agent, AgentType> — merged, global ∪ open project
window.maestro.templates.agentProjectTags.list(true)  → Record<agent, string> — merged
window.maestro.avatar.list(true)                      → Record<agent, AvatarLayers> — merged
window.maestro.templates.projectTags.list()       → the catalog for the dropdown
window.maestro.agents.sync()                      → AgentSyncSummary — which forks are behind their template (`031`)
```

The seventh read is the only one that is *also* computed app-wide: `install-context.tsx`'s
`refresh()` calls the same channel on project selection and hangs the result off
`InstallContextValue.agentSync`, so `/maestro` can show the headline count without visiting this
page. Both call sites swallow a failure the way the auto-refresh does — a fork check that throws
must not stop the page from loading.

`avatar:list` exists because of this page. The list draws a composited thumb per row, and the
per-agent `avatar:get` would have been one sqlite open per agent on every render — see
`global-stores`' avatars sub-concept.

**Three things are refetched per selection, in one `Promise.all`** (`034`, `content` added `044`):
`reports.get(agent)`, `handoffs.routes(agent)`, and `agents.content(agent)`. They are the per-agent
pair (now a triple), project-scoped — everything else arrives with the global attributes in
`refresh()`'s bulk reads. `handoff:routes` is deliberately **one** call for every row the
Interactions pane will render rather than a `get` per route: the graph walk that produces the list
(`handoff-routes.ts`) is not renderer-safe, and a fan-out would reopen the global sqlite store once
per row on every click. Each read failing toasts on its own and falls back to `NO_REPORT` /
`NO_ROUTES` / `NO_CONTENT`; none of the three stops the others.

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

The card's cosmetic avatar editor — tabs-and-arrows over seven categories, the eyes/hair
`ColorControl` and its live recolor, and why it supersedes `avatar-picker.tsx` here only — is
[`avatar-block`](sub-concepts/avatar-block.md).

## The Interactions pane (`034`)

The right pane's two tabs (`044`) — the Interactions list (the resolved report plus one editor per
outgoing handoff route, each labelled since `037` with its `.claude/channels/<receiver>/<sender>.1.md`
lane path) and the Content tab (`044` read-only, `045` editable for a project-tier agent) — plus the
content and handoff write paths they own, are [`interactions-pane`](sub-concepts/interactions-pane.md).

## Forking a global agent

The Copy button, same-name vs. renamed forks, the `agent-forks.json` provenance record, and the
fork-review block that renders below the card (`031`) are
[`forking-a-global-agent`](sub-concepts/forking-a-global-agent.md).

## Things that bite

- **`CARD_MIN_HEIGHT` is a measured constant, not a round number.** The card must be the same height
  in view and edit mode so pressing Edit does not reflow the page under the pointer. Measured in a
  real window: natural view height **607px**, natural edit height **627px**, so the floor is 627. If
  you change edit-mode card content, **re-measure and update it** — the `test-maestro` skill's CDP
  harness is how. Re-measured on the packaged build for `034`: view **618.95px**, edit **603.83px**,
  applied **627px** in both modes — unchanged, and expected to be, because the Interactions pane is
  outside the card and `034` changed no edit-mode card content.
- **The single line of edit-mode explanation lives in the card's _footer_, outside the card.** That is
  the same constraint: an in-card note changes the card's height with its own wrapping, and the note
  is conditional (it changes for a plugin-owned agent, or one with no instance), so in-card it would
  make the height vary by agent.
- **Measuring that height by setting `card.style.minHeight = ""` deletes React's own inline
  declaration** until the next render, so every later measurement in the same probe silently loses the
  floor and reports a card that "doesn't respect its minimum". Save the previous inline value and
  restore *that*. This cost a probe run.
- **The description — and, since `045`, the Content tab body — is not editable for every agent, as
  of `029`, only `project`-tier is.** `EDITABLE_AGENT_SOURCES` in `contracts.ts` is `["project"]`;
  every other tier renders a read-only paragraph (description) or `<pre>` (content) even in edit
  mode. The renderer decides from `DiscoveredDefinition.source` alone, with no round trip — which is
  why that constant is a value export from an otherwise interfaces-only file.
  `describeUneditableSource(agentName, source)` (`agent-descriptions.ts`) gives the thrown refusal a
  tier-specific message, shared verbatim by both fields' server-side rejection: `user`-tier says the
  agent is machine-wide and points at forking rather than claiming it was "created" anywhere (there
  is no such place); `maestro`/plugin-tier names the plugin and says an update overwrites the file.
  The card's own footer note and the Content tab's `contentNote` are each a **separate, hand-written
  parallel** of that message (`agents.tsx`), not a shared import — the renderer can only pull
  `contracts`/`text` out of `src/core`, so the three strings can drift; check all of them if you
  change one.
- **A pencil on an _unselected_ row cannot build the draft immediately.** That agent's report is still
  in flight, so `startEdit` sets `selected` plus a `pendingEdit` flag and an effect builds the draft
  once `base` resolves. Building it inline would clone a draft carrying the previously selected
  agent's report.
- **List descriptions are truncated in JS (`clampText`), deliberately not `-webkit-line-clamp`.** The
  clamp loses its ellipsis as a flex child and how many lines fit depends on the Chromium build; the
  untruncated text still goes in `title`.
- **Two page-local surfaces are mixed from tokens, not hard-coded.** The design names `#2b2722` (side
  panes, avatar frame) and `#2f2b26` (the read-only report block) and the token set has neither, so
  `PANE_SURFACES` sets `--pane` and `--sunken` with `color-mix()` on the page root. They resolve to
  exactly those two hexes in dark mode and follow the theme in light. When asserting on them: a
  `color-mix()` result serialises as `color(srgb r g b)` with 0..1 channels, **not** as `rgb()`.
- **The right pane's drag writes width straight to the DOM and only tells React on mouseup.** A
  `setState` per `mousemove` re-renders the card, the list and every canvas on it, once per pixel.
- **`components/tabs/discovered-definitions.tsx` is still shared with `/skills`.** This page grew its
  own list (a skill has no avatar and no per-row pencil); do not widen the shared table to serve both.

## Files

| File | Role |
| --- | --- |
| `src/renderer/src/routes/agents.tsx` | State, the draft (`cloneDraft`, `handoffsOf`), the eight-way save, the round trips. |
| `src/renderer/src/components/agents/agent-shared.ts` | `AgentDraft` (incl. `034`'s `handoffs: Record<handoffId, string>` and `045`'s `content: string`) / `AgentSkill`, the constants, `clampText`, `cycleOption`, `PANE_SURFACES`, the shared class strings. |
| `src/renderer/src/components/agents/agent-list.tsx` | Left pane. Holds the `/create-subagent` link. |
| `src/renderer/src/components/agents/agent-card.tsx` | Centre pane card + the Edit/Cancel/Save footer. |
| `src/renderer/src/components/agents/agent-avatar-block.tsx` | The frame in both modes, and the tabs+arrows editor. |
| `src/renderer/src/components/agents/interactions-pane.tsx` | Right pane: the Interactions/Content tab strip (`044`), the report + one entry per route, `HANDOFF_TIER`, the resize handle, one auto-growing editor per entry, and (`045`) the Content tab's own pencil, `agent-content-editor` textarea and `contentNote` for a project-tier agent. |
| `src/core/handoffs.ts` | `resolvedRoutesFrom(projectRoot, agent, dbPath?)` — the pane's one round trip, and `saveProjectHandoffOverride`, its write. |
| `src/core/agent-descriptions.ts` | The node side of `agent:describe` — file resolution, the frontmatter rewrite, `describeUneditableSource`'s tier-specific refusals, (`044`) `extractAgentBody`/`getAgentBody` for the Content tab, and (`045`) `replaceBodyInFrontmatter`/`setAgentContent`, the tab's write path. |
| `src/core/agent-fork.ts` | `forkAgent` — byte-copy or renamed-frontmatter fork, and `copyAgentAttributeRows`. Re-exports everything below. |
| `src/core/agent-fork-record.ts` | The sidecar and the hashing/merging helpers, split out of `agent-fork.ts` in `031` so nothing sqlite-shaped reaches the generated bundle. |
| `src/core/sync-decision.ts` | `decideSync` — the one shared, `fs`-free rule, also called by `report-sync.ts`. |
| `src/core/agent-sync.ts` | `computeAgentSync` (read-only) and `applyAgentSync` (the only writer). |
| `src/core/diff.ts` | `diffLines`/`hasChanges`/`unifiedDiffText` — LCS, with a `MAX_LINES = 4000` fallback to a whole-file replace. |
| `src/renderer/src/components/agents/agent-fork-review.tsx` | The review block: both descriptions, the diff, and the three actions. |
| `test/core/sync-decision.test.ts` | The branch table — `detached` outranks everything, `stale-customized` decided before `templateAdvanced`. |
| `test/core/agent-sync.test.ts` | One case per `031` acceptance criterion, including the mtime-and-bytes proof that computing writes nothing. |
| `src/renderer/src/components/avatar/avatar-canvas.tsx` | Composites the layers; `fill` is this page's. |
| `test/core/agent-descriptions.test.ts` | The frontmatter rewrite's refusals and its byte-identical body. |
| `test/core/agent-fork.test.ts` | Hash normalization and `forkAgent` end-to-end, including every refusal path. |

## Relationships

- [`agent-fork-sync`](../agent-fork-sync/SKILL.md) — the mechanism behind the fork review on
  this page: the one decision function `report-sync.ts` shares, the two staleness triggers, and
  what update / keep / detach write.
- [`global-stores`](../global-stores/SKILL.md) — five of the eight write paths, why the description
  and (`045`) the content deliberately are not stores, and where `copyAgentAttributeRows`
  reads/writes those same three stores for a renamed fork.
- [`maestro-config-model`](../maestro-config-model/SKILL.md) — the workflows slice this page is the
  second writer of, and the read-before-write rule that follows.
- [`workflow-view`](../workflow-view/SKILL.md) — the other writer, and where `loaded_skills` /
  `referenced_skills` are normally edited.
- [`create-skills-architecture`](../create-skills-architecture/SKILL.md) — the `/create-subagent` flow
  this page's "+ New agent" link is the entry point for.
- [`test-maestro`](../test-maestro/SKILL.md) — how the measured numbers above were measured, and how
  to re-measure them.
- [`plugin-libs-parity`](../plugin-libs-parity/SKILL.md) — `maestro-agent-sync` is the tenth
  generated bundle, and the reason the fork record had to leave `agent-fork.ts`.
- `updating-maestro` (at the repo root `.claude/skills`) — why a plugin-tier fork is checked by
  version string alone, and why that is the *correct* answer rather than a shortcut.
