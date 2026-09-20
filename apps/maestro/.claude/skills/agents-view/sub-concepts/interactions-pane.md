# The Interactions pane (`034`)

The right pane of [`agents-view`](../SKILL.md): two tabs (`044`) — **Interactions** (default) and
**Content** — sharing the card's one edit session, with no Save of its own.

Tab state (`useState<"interactions" | "content">`) is **local to `interactions-pane.tsx`**, not
lifted to the route: it has no bearing on the edit session or Save/Cancel, unlike everything else
the pane holds. `data-testid="interactions-tabs"` plus one `data-testid="interactions-tab-<name>"`
button per tab; the interactions list keeps `data-testid="interactions-list"` but is now gated on
`tab === "interactions"` too, and the new pane is `data-testid="agent-content"`.

## The Content tab (`044` read-only, `045` editable)

The body comes from `getAgentBody(projectRoot, bundledDir, agentName)` (`agent-descriptions.ts`),
which resolves the file through the **same** `findAgentFile` tier walk (project → user → maestro →
plugins) the description editor already uses — so the Content tab can never show a different
agent's file than the rest of the page — then returns `extractAgentBody(contents)`, a plain slice
past the `FRONTMATTER` match (the same technique `replaceDescriptionInFrontmatter` uses to leave a
body untouched, so it's byte-identical by construction). The channel (`agent:content`) returns a
plain `string`, with no tier/source label — unlike the report and handoff entries below, nothing
here needs to say which tier answered, since there is exactly one file per agent, not one per tier.
Refetched per selection in the **same** `Promise.all` as `reports.get`/`handoffs.routes`, so
switching agents while the Content tab is active refreshes it too.

**Editability is gated on the SAME `contentEditable = descriptionEditable` boolean the description
field already uses (`045`)** — kept as its own named variable in `agents.tsx` rather than inlining
`descriptionEditable` a second time, purely so the write-path block and the pane props read
self-documenting. In view mode on a project-tier agent, the Content tab renders its own pencil
(`title="Edit this agent's content"`, `PENCIL_BUTTON`) that starts the shared edit session without
switching tabs first. In edit mode it swaps the read-only `<pre>` for
`<textarea data-testid="agent-content-editor">`, filling the available height (`flex-1 min-h-0`,
native scroll) — deliberately **not** the Interactions tab's auto-grow-to-content behaviour, since a
markdown body can run very long and this pane has no cap/fade the way those entries do. On a
non-project-tier agent the tab stays read-only in edit mode, with `contentNote` rendered below the
block — a **hand-written parallel** of the card's own footer note (the renderer can't reach
`describeUneditableSource`, which lives in `agent-descriptions.ts`, a non-renderer-safe module, so
the two strings can drift and are not a shared import). The existing "Copy into the project" fork
button is the escape hatch — forking copies the full file, body included, so a freshly forked
agent's Content tab is editable with no further changes needed.

**The content write is the mirror image of the description write (`045`).** `setAgentContent`
(`agent-descriptions.ts`) resolves the file through the same `findAgentFile` walk and the same
`EDITABLE_AGENT_SOURCES` gate `setAgentDescription` uses, then calls
`replaceBodyInFrontmatter(contents, body)` — `match[0] + body`, the exact inverse of
`replaceDescriptionInFrontmatter`: that one rewrites inside the frontmatter block and leaves the
body untouched, this one keeps the frontmatter block byte-for-byte and replaces everything after
it. Unlike the description, the body is **never normalized** — a textarea's raw multi-line value is
written verbatim, since a body is free text and not a single frontmatter value. `handleSave()`
checks it right after the description block (`d.content !== base.content`), pushes a failure as
`content: <error>` into the same `failures` array, and calls `setContent(d.content)` on success so
the Content tab reflects the new body with no re-fetch. `AgentContentResult` carries `{ file,
source }` and, deliberately, no `content` echo — the caller already holds the value it just wrote.

## The Interactions tab

A **list of header + body pairs**: the agent's resolved report first, headed "Main Session", then
**one entry per outgoing handoff route** the project's workflow graph wires. `agents.tsx` holds them
as `routes: ResolvedHandoffRoute[]` and the draft mirrors the bodies in `AgentDraft.handoffs`, keyed
by `"<sender>/<receiver>"`.

- **A route header reads `→ receiver`**, plus ` · <label>` when the edge is a condition edge. Each
  entry has its own auto-growing textarea (the pane scrolls, the boxes don't) and its own pencil,
  and every pencil starts the **card's one** edit session.
- **Since `037`, each entry with a receiver also names the file its template writes to** — a small
  `→ .claude/channels/<receiver>/<sender>.1.md` line below the tier note, computed inline in
  `interactions-pane.tsx` from `route.sender`/`route.receiver` (both already on
  `ResolvedHandoffRoute`). This is a label only: `036` moved the payload itself off the orchestrator's
  context and onto that file, and this pane's editor still edits the resolved `handoff_details`
  *template*, not the file — nothing here reads or writes the channel file. Null for the Main Session
  report entry and for a route whose edge reaches no agent (`receiver: null`).
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
- **The entries are keyed by PAIR, not by edge.** `backend → test` on the `default` workflow and on
  `tdd` are one file and one row, so both edges share one editor and editing either changes both —
  which is exactly why the editor lives here and not on a `/workflows` edge, where it would imply it
  edited that edge's payload alone.

**The handoff write path is the only one of the eight that is a list.** `handleSave()` loops
`d.handoffs`, skips every body equal to `base.handoffs[id]`, and pushes a failure as
`handoff <id>: <error>` into the same `failures` array the other seven use — so a partial failure
names the route and still returns before `setDraft(null)`. Each write is its own file, which is why
it is not batched into one channel call. On any successful write the route list is **re-read**
(`handoff:routes` again) rather than patched locally: dropping `syncedFrom` moves the resolved
*source* too, so the pane's tier label has to move from "Global default" to "Project override" and
only main knows that.

Test hooks: `data-testid="interactions-list"` with `data-routes="<n>"`, and
`data-testid="interaction-<sender>/<receiver>"` per entry.

The three tiers behind each body, the global store, and the `/templates` Handoffs tab that edits
that global tier are [`global-stores`](../../global-stores/SKILL.md)' subject, not this file's.
