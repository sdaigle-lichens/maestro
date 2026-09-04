---
name: agents-view
description: "Explains how the /agents view in the Maestro desktop app is built end-to-end: the three-pane shell and its 1120px scroller, the Project/Global left-pane split, the single edit session that fans out to seven different write paths on Save, why only the description locks on a Global-tier card and how forking a global agent into the project works, the loaded/referenced skill chips and their tri-state, the tabs-and-arrows avatar editor, the Interactions pane's list of the resolved report plus one editor per outgoing handoff route, the fork-review block that renders below the card, and the load-bearing card min-height. Use when the user is working inside apps/maestro and asks how the agents page works, why a Save wrote to seven places, why a description is written to the agent's own .md, why an agent's description can't be edited, how 'Fork into this project' works, why a forked agent is flagged as behind its template and what update/keep/detach do, why the skills section is read-only, why the card doesn't reflow when you press Edit, or how the Interactions pane's per-route handoff editors work."
metadata:
  type: concept-skill
  version: "1.4"
  last-update: 09ac67a729dace3fc5e437e956037d53771cdac8
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
every agent appears in exactly one section, and forking one (below) moves its row from Global to
Project on the next refresh — that movement is the confirmation the fork worked, no toast needed.
The card carries a matching uppercase tier tag next to the agent name.

Both side panes collapse to their header row. The right pane is resizable by dragging its left edge.

**One horizontal scroller wraps the nav _and_ the pane row**, with an inner `min-width: 1120px`, so
chrome and content scroll together and nothing clips on a narrow window. There are no breakpoints —
this is a desktop window, so it has a floor rather than a set of layouts.

The page renders the real `TopNav` with no arguments. The page-local `ProjectSelect` the old version
carried is **gone**, and its removal fixed a latent split: the list was fetched for `viewedRoot`
while `reports.get` resolved against `currentRoot()`, so the two could describe different projects.
Everything on this page now reads the open project, and only the nav's folder button changes it.

## One edit session, seven write paths

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
| skills | `config:save` (workflows slice) | `.claude/maestro.json`'s `workflow_instances` |

Each write is attempted only when that field actually changed, and **failures are collected per
field**: a partial failure toasts what failed and **stays in edit mode**, rather than closing the
editor as if the whole save had landed. There is no transaction across seven destinations — the
honest alternative is to say which parts got through.

**The handoff path is the only one that is a list.** `handleSave()` loops `d.handoffs`, skips every
body equal to `base.handoffs[id]`, and pushes a failure as `handoff <id>: <error>` into the same
`failures` array the other six use — so a partial failure names the route and still returns before
`setDraft(null)`. Each write is its own file, which is why it is not batched into one channel call.
On any successful write the route list is **re-read** (`handoff:routes` again) rather than patched
locally: dropping `syncedFrom` moves the resolved *source* too, so the pane's tier label has to move
from "Global default" to "Project override" and only main knows that.

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

- **Why the description is a file write and not a seventh store** — see the "The exception: a
  description is not a store" section of [`global-stores`](../global-stores/SKILL.md). Short version:
  type/tag/avatar are Maestro's own metadata, but a description is the line Claude Code itself reads
  to decide when to dispatch the agent.
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

**Two things are refetched per selection, in one `Promise.all`** (`034`): `reports.get(agent)` and
`handoffs.routes(agent)`. They are the per-agent, project-scoped pair — everything else arrives with
the global attributes in `refresh()`'s bulk reads. `handoff:routes` is deliberately **one** call for
every row the Interactions pane will render rather than a `get` per route: the graph walk that
produces the list (`handoff-routes.ts`) is not renderer-safe, and a fan-out would reopen the global
sqlite store once per row on every click. Either read failing toasts on its own and falls back to
`NO_REPORT` / `NO_ROUTES`; neither stops the other.

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

## The Interactions pane (`034`)

The right pane is a **list of header + body pairs**: the agent's resolved report first, headed
"Main Session", then **one entry per outgoing handoff route** the project's workflow graph wires.
`agents.tsx` holds them as `routes: ResolvedHandoffRoute[]` and the draft mirrors the bodies in
`AgentDraft.handoffs`, keyed by `"<sender>/<receiver>"`.

- **A route header reads `→ receiver`**, plus ` · <label>` when the edge is a condition edge. Each
  entry has its own auto-growing textarea (the pane scrolls, the boxes don't) and its own pencil,
  and every pencil starts the **card's one** edit session.
- **Every entry names the tier its body came from.** `HANDOFF_TIER` maps the four
  `ResolvedHandoff["source"]` values: `project` → "Project override", `global` → "Global default",
  `seed` → "Shipped by Maestro", `none` → "No protocol configured". The fourth is the point of the
  list — a wired route with no template at any tier is a real gap, and this is where it is visible
  instead of silent (`scribe → reviewer` is the live example; Maestro ships nothing for it).
- **A route whose edge reaches no agent** (`receiver: null`, so `handoffId: null`, `source: "none"`)
  keeps its place in the list and renders **read-only** — there is no pair to key a template on.
- **The pane has no Save of its own.** It shares the card's edit session, so the card's Save commits
  the report and every changed handoff alongside description/type/tag/skills/avatar, and Cancel
  discards all of it together.

Test hooks: `data-testid="interactions-list"` with `data-routes="<n>"`, and
`data-testid="interaction-<sender>/<receiver>"` per entry.

The three tiers behind each body, the global store, and the `/templates` Handoffs tab that edits
that global tier are [`global-stores`](../global-stores/SKILL.md)' subject, not this file's.

## Forking a global agent

Only the description locks on a Global-tier card (see "Things that bite" below) — every other field
still saves normally. The escape hatch is a free-text name input (defaulting to the agent's own
name) plus a "Fork into this project" button in the view-mode footer
(`data-testid="agent-fork-name"` / `"agent-fork-button"`), calling `forkAgent`
(`src/core/agent-fork.ts`) over the `agent:fork` channel.

- A **same-name fork** copies the template file byte-for-byte, including its `description:` line —
  shadowing is the mechanism: a project `.claude/agents/<name>.md` wins `dedupeById`'s resolution, so
  the list shows one row, now sourced from the project.
- A **renamed fork** rewrites only the frontmatter `name:` line and calls
  `copyAgentAttributeRows(fromName, toName, projectRoot)` to copy the avatar/type/project-tag rows to
  the new name — see `global-stores`. The read side stays global/name-only (the template is always a
  global-tier agent); the write side scopes to the fork's own project (`030`), since the copy always
  lands on a project-tier agent. A same-name fork needs no copy: the shadowing row *is* the
  template's own global row.

Every fork — same-name or renamed — writes a provenance record to
`<projectRoot>/.claude/agent-forks.json` (`AgentForkRecord`: `sourceTier: "user" | "plugin"`,
`sourcePlugin`, `pluginVersion`, `templateBodyHash`, `templateBody`, `forkedAt`), **never** into the
agent's own frontmatter beyond the rename — `agent-fork.ts`'s header explains why (Maestro's own
bookkeeping doesn't belong in a file format it doesn't own, same argument as the seven-write-paths
description exception below). `hashAgentBody` strips **both** the `name:` and the `description:` frontmatter lines (and their
continuations) before hashing, so neither editing the description after forking nor renaming the
fork at creation marks it as diverged. The `name:` half is `031`'s correction: `forkAgent` rewrites
exactly that line on a renamed fork, so a description-only normalisation left every renamed fork
hashing differently from its own template **from birth** — permanently stale-but-customized, with
the refresh branch never firing for it.

`/create-subagent`'s "Start from a template" field (`target: "project"` only) is a **different,
lighter-weight thing** — it seeds a fresh manual-mode form's `name`/`description` from a picked
agent, not a byte-for-byte copy of its body. See `create-skills-architecture`.

## Reviewing a fork against its template (`031`)

A fork is a snapshot, and the template moves on. `src/core/agent-sync.ts` notices; **this page is
where the user answers.**

**The mechanism is not documented here.** The shared decision function, the two staleness triggers,
the hashing normalisation, the provenance record and what `update`/`keep`/`detach` actually write
all live in [`agent-fork-sync`](../agent-fork-sync/SKILL.md) — a concept, not a view, because
`report-sync.ts` is its other caller and a reader arriving from there has no reason to open this
file. Read that first; what follows is only what is true of this page.

| Surface | What it shows |
| --- | --- |
| `/maestro`'s `ForkedAgentsCard` (`maestro.tsx`, `data-testid="maestro-diverged-forks"`) | The headline count from `useInstall().agentSync`, linking to `/agents`. Renders nothing when `diverged` is empty. |
| This page's banner (`data-testid="agent-fork-diverged"`) | One chip per diverged fork at the top of `<main>`; clicking one selects it. |
| `agent-fork-review.tsx` (`data-testid="agent-fork-review"`, `data-verdict`) | The per-agent review: both descriptions side by side, the body diff (`data-testid="agent-fork-diff"`, from `src/core/diff.ts`), and **Update / Keep as fork / Detach**. |

- **The review renders BELOW the card, not inside `AgentCard`.** `CARD_MIN_HEIGHT` (below) is a
  measured constant keeping the card the same height in view and edit mode; a conditional diff block
  inside it would make that height vary by agent and by template state. The review is also hidden
  while editing. Because no edit-mode card content changed, `CARD_MIN_HEIGHT` did **not** need
  re-measuring for `031`.
- **Update is offered even for a stale-customized fork, behind a two-click confirmation**
  ("Take the new body…" → "Discard my edits and take it"). "Never overwritten" is a promise about
  the **automatic** path — `computeAgentSync` writes nothing, ever — and refusing a user who has
  read the diff and pressed twice would leave no route to take the update at all.
- **Both descriptions are on screen beside the diff on purpose.** A fork syncs its body while its
  description stays the user's, so the two drift — the description ending up promising something the
  new body no longer does. Not a blocker, and only noticeable if both are visible.
- **`refresh()` fans out a seventh read** (`window.maestro.agents.sync()`), so a fork, an update or
  a detach is reflected without a round trip of its own. The count the banner shows is
  `summary.diverged`, which is deliberately narrower than `refreshed + staleCustomized` — see
  [`agent-fork-sync`](../agent-fork-sync/SKILL.md).

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
- **The description is not editable for every agent — as of `029`, only `project`-tier is.**
  `EDITABLE_AGENT_SOURCES` in `contracts.ts` is `["project"]`; every other tier renders a read-only
  paragraph even in edit mode. The renderer decides from `DiscoveredDefinition.source` alone, with no
  round trip — which is why that constant is a value export from an otherwise interfaces-only file.
  `describeUneditableSource(agentName, source)` (`agent-descriptions.ts`) gives the thrown refusal a
  tier-specific message: `user`-tier says the agent is machine-wide and points at forking rather than
  claiming it was "created" anywhere (there is no such place); `maestro`/plugin-tier names the plugin
  and says an update overwrites the file. The card's own footer note is a **separate, hand-written
  parallel** of that message (`agents.tsx`), not a shared import — the renderer can only pull
  `contracts`/`text` out of `src/core`, so the two strings can drift; check both if you change one.
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
- **The Interactions pane is a LIST, and the handoff entries in it are keyed by PAIR, not by edge**
  (`034`). `backend → test` on the `default` workflow and on `tdd` are one file and one row, so both
  edges share one editor and editing either changes both — which is exactly why the editor lives
  here and not on a `/workflows` edge, where it would imply it edited that edge's payload alone.
- **`components/tabs/discovered-definitions.tsx` is still shared with `/skills`.** This page grew its
  own list (a skill has no avatar and no per-row pencil); do not widen the shared table to serve both.

## Files

| File | Role |
| --- | --- |
| `src/renderer/src/routes/agents.tsx` | State, the draft (`cloneDraft`, `handoffsOf`), the seven-way save, the round trips. |
| `src/renderer/src/components/agents/agent-shared.ts` | `AgentDraft` (incl. `034`'s `handoffs: Record<handoffId, string>`) / `AgentSkill`, the constants, `clampText`, `cycleOption`, `PANE_SURFACES`, the shared class strings. |
| `src/renderer/src/components/agents/agent-list.tsx` | Left pane. Holds the `/create-subagent` link. |
| `src/renderer/src/components/agents/agent-card.tsx` | Centre pane card + the Edit/Cancel/Save footer. |
| `src/renderer/src/components/agents/agent-avatar-block.tsx` | The frame in both modes, and the tabs+arrows editor. |
| `src/renderer/src/components/agents/interactions-pane.tsx` | Right pane: the report + one entry per route, `HANDOFF_TIER`, the resize handle, one auto-growing editor per entry. |
| `src/core/handoffs.ts` | `resolvedRoutesFrom(projectRoot, agent, dbPath?)` — the pane's one round trip, and `saveProjectHandoffOverride`, its write. |
| `src/core/agent-descriptions.ts` | The node side of `agent:describe` — file resolution, the frontmatter rewrite, and `describeUneditableSource`'s tier-specific refusals. |
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
- [`global-stores`](../global-stores/SKILL.md) — five of the seven write paths, why the sixth
  (description) deliberately is not one, and where `copyAgentAttributeRows` reads/writes those same
  three stores for a renamed fork.
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
