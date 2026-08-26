# Per-agent output/report templates, decoupled from the fixed agent list

Implement the following vertical slice. When complete, ensure every acceptance criterion below is met.

## Why

Today, five of the seven bundled Maestro agents (`plugins/maestro/agents/{backend,frontend,mobile,scribe,test}.md`)
hardcode a `## Mandatory Output Format` section — a fenced JSON block the agent must always emit at the
end of its run. `refactor.md` and `reviewer.md` have no such section. This couples "does this agent report
a structured output" to whether someone wrote that section into its `.md` file by hand, and it only exists
for the 7 agents Maestro ships — any other agent (a project's own, a global `~/.claude/agents/` one, a
plugin's) has no way to participate at all.

The goal: pull the output-format instruction out of the agent `.md` files entirely and inject it at
runtime instead — the same move already made for `handoff_details`
(`templates/handoffs/<sender>/<receiver>.md`, injected by `maestro-inject-agent-context.js`, "the whole
communication layer no longer lives in the agent files"). This makes report templates available to **any**
discovered agent, not just the 7 bundled ones, and lets an agent that genuinely needs no output section
just... not have one, rather than needing a maintainer to leave a gap in a markdown file.

Read `apps/maestro/.claude/skills/maestro-architecture/SKILL.md` and
`apps/maestro/.claude/skills/log-view/SKILL.md` before starting — this slice extends the same
`SubagentStart` hook (`maestro-inject-agent-context.js`) both describe, and must not disturb its existing
skills/HANDOFF-routing behavior, which stays exactly as documented.

## What to build

### 1. Two-tier report storage

**Global tier** (new — mirrors `skill-tags.ts` / `~/.claude/maestro-skill-tags.sqlite`, not
`maestro.json`): a new module `apps/maestro/src/core/report-defaults.ts`, backed by `node:sqlite` at
`~/.claude/maestro-report-defaults.sqlite`. Two tables:

- `agent_reports (agent_name TEXT PRIMARY KEY, report_id TEXT NOT NULL)`
- `reports (report_id TEXT PRIMARY KEY, content TEXT NOT NULL, version INTEGER NOT NULL)`

This is global (per machine, every project), unlike skill tags being global for the reason skill tags are
("a skill is the same skill everywhere") — here it's because it's the fallback tier when a project has no
opinion, and it's what install/update syncs *from*. There is **no UI to edit this tier** in this slice —
see "What's explicitly out of scope" below. It only needs to be readable (by the hook and by the
install/update scripts) and seedable (by the migration step, #5).

Follow the `skill-tags.ts` → `plugin-entries/maestro-skill-tags.ts` → generated
`lib/maestro-skill-tags.cjs` pattern exactly: add `apps/maestro/src/core/plugin-entries/maestro-report-defaults.ts`
re-exporting the read functions, run `pnpm --filter maestro build:plugin-libs` to produce
`plugins/maestro/scripts/lib/maestro-report-defaults.cjs`, and wrap every `require()` of it in try/catch —
this runs under whatever `node` is on the session's PATH, not Electron's bundled one, and `node:sqlite`
needs Node ≥ 22.5. Degrade to "no global default" on a missing/old `node`, exactly like
`maestro-install.js` degrades its skill-map best-fit step.

**Project tier**: a new `reports` slice on `MaestroConfigV3` (`apps/maestro/src/core/types.ts`,
`contracts.ts`) —

```ts
interface MaestroReportEntry {
  id: string; // always the agent's own name when created by the UI (see §4)
  syncedFrom?: { version: number; hash: string }; // absent for a hand-authored override; present
  // when it was materialized from a global default, for the install/update staleness check
}
type MaestroReportsSlice = Record<string /* agent name */, MaestroReportEntry>;
```

Content lives at `<project>/.claude/reports/<report id>.md` — plain markdown, no frontmatter needed (the
file *is* the content that gets injected, not a template with metadata). Gitignore this the way the other
project-writable Maestro artifacts are **not** ignored — unlike the ephemeral session files, this is
authored config and should be committed, same tier as `.claude/handoffs/` overrides.

### 2. Pure resolution module

`apps/maestro/src/core/report-resolution.ts` (pure — no `fs`, mirrors `read-scope.ts`/`write-scope.ts`'s
style): given an agent name, the project's `reports` slice, and the global tier's data, resolve to
`{ source: "project" | "global" | "none", content: string | null, reportId: string | null }`. Order:
project override (file exists at the mapped id) → global default (agent has a row in `agent_reports`) →
`none`. This is the one function both the hook and the app UI call, so the two can never disagree about
what's "in effect" for a given agent.

### 3. Hook injection — unconditional, independent of workflow matching

Extend `plugins/maestro/scripts/maestro-inject-agent-context.js`. Critically: **this new lookup must not
be gated behind `matchedInstances.length === 0`** the way the existing skills/HANDOFF logic is. Today the
hook returns `null` (full no-op) whenever the invoked agent type isn't mapped to any node in the active
workflow. A report instruction has to fire whenever the agent type resolves to *any* report (project or
global), regardless of whether it's part of a matched workflow — otherwise an agent used outside Maestro's
routing (or a project with no `maestro.json` at all, for the global tier) would silently lose the report
instruction the static `.md` block used to always provide.

Concretely: add a second, independent branch in the hook's `IIFE` — call it after (or instead of, when)
`collect()` returns `null` — that resolves the report via `report-resolution.ts`'s logic (reading the
project's `maestro.json` `reports` slice if present, and the global sqlite via the generated `.cjs` lib,
wrapped in try/catch) and, if non-empty, appends its content as another `additionalContext` part:

```
Mandatory output format for the `<agent_type>` agent:

<resolved report content, verbatim>
```

If resolution yields `none`, emit nothing for this part (existing behavior for `refactor`/`reviewer`
today, now true for any unconfigured agent). Keep this as its own function/branch, not folded into
`collect()` — it has a different no-op condition than the skills+routing logic and conflating them risks
re-introducing the `matchedInstances` gate for reports by accident later.

### 4. Install / update sync

Both delivery paths — `/maestro-install`/`/maestro-update` (`plugins/maestro/scripts/maestro-install.js`
and its update counterpart) and the desktop app's `installRuntime()`/equivalent update path
(`apps/maestro/src/core/install.ts`) — gain a sync step over every agent the project's `reports` slice
references (not the whole global set — only what this project has actually opted into via an existing map
entry with `syncedFrom` metadata, or newly-seeded on first install):

- No project file at the mapped id → copy the current global default in, write `.claude/reports/<id>.md`,
  and record `syncedFrom: { version, hash: sha256(content) }` in the `reports` slice.
- Project file present, its content hash still equals its recorded `syncedFrom.hash`, and the global
  default's version has advanced past `syncedFrom.version` → overwrite with the new global content, bump
  `syncedFrom` to the new `{ version, hash }`. (Unmodified since last sync — safe to refresh.)
- Project file present, its content hash does **not** match `syncedFrom.hash` → the user edited it. Skip
  silently in terms of writes, but surface it in the install/update summary as "stale but customized" —
  same spirit as the existing `installedRuntimeId`/`shippedRuntimeId` staleness badge, not a new
  mechanism.

This is deliberately not a "does maestro.json exist" seed-once operation like `maestro.json` itself
(`installRuntime()` seeds only when absent) — reports need to keep tracking a moving global default, which
is the entire reason `syncedFrom` exists.

### 5. Migration — strip and seed, same change

For the 5 existing agent files with a `## Mandatory Output Format` section
(`backend.md`, `frontend.md`, `mobile.md`, `scribe.md`, `test.md`):

- Remove that section from each `.md` file.
- Seed the global sqlite store (`reports` table) with that exact content, `version: 1`, one row per
  agent, `report_id` equal to the agent's own name (`backend`, `frontend`, `mobile`, `scribe`, `test`) —
  do **not** collapse the near-identical backend/frontend/mobile shapes into one shared id as part of this
  migration; that reuse is future work once a global-editing UI exists to manage shared ids sanely (see
  "out of scope" below). One row per agent keeps this step a mechanical, verifiable copy with no judgment
  calls.
- Add corresponding `agent_reports` rows (`backend` → `backend`, etc.).
- `refactor` and `reviewer` get no rows — unchanged behavior, no report section, exactly as today.

Do this as a one-time seed script (e.g. run once during this task's implementation to populate a
maintainer's/CI's `~/.claude/maestro-report-defaults.sqlite`, or — more robust — a small idempotent
migration the app/install script runs on first read if the `reports` table is empty, so a fresh machine
that installs Maestro after this change still gets the 5 seeded defaults rather than nothing). Prefer the
idempotent-seed-on-first-read approach: it works uniformly for every user of the plugin, not just whoever
happens to run a one-off script now.

### 6. New `/agents` page, replacing the Tools "Agents" tab

New route `apps/maestro/src/renderer/src/routes/agents.tsx`:

- **Left pane**: the exact same list `AgentsTab`/`DiscoveredDefinitionsList` render today, sourced from
  `discoverAgents(projectRoot, bundledDir)` — no new status badge per row (explicitly decided against).
  Move the `Create a subagent` link (`CreateLink to="/create-subagent"`) here from the removed tab.
- **Right pane**: on selecting an agent, show the *resolved* report content (via `report-resolution.ts` —
  project override if present, else global default, else empty) in a single freeform text editor. No
  structured fields, no separate tabs for "project" vs "global" — one editor showing what's in effect.
- **Save semantics — "if you touch it, it becomes this project's override."** Any edit + save always
  writes a **project** override: `.claude/reports/<agent-name>.md` (id = the agent's own name, never
  whatever id it may have inherited from the global tier — editing `backend` must never affect `frontend`
  or `mobile` even if they currently share a global id) and sets
  `reports[agentName] = { id: agentName }` (no `syncedFrom` — it's a hand-authored override now, not
  tracking a global default) in `maestro.json`. Plain file write via a new `config:save`-style IPC path —
  **no Claude session, no `claude:preview`/`claude:run`, no token** — the renderer sends text, main writes
  it, same shape as the `/rules` save path.
- Remove `apps/maestro/src/renderer/src/components/tabs/agents-tab.tsx` and its entry in `TABS` in
  `routes/tools.tsx`. Add `/agents` to the top nav alongside `Skills`/`Workflows`/`Rules`/`Session Log` —
  the same graduation `/skills` got when it grew its own inline editor and stopped fitting a `/tools` tab.

### What's explicitly out of scope for this slice

- **No UI to edit the global default tier.** The global store must exist, be seeded, and be readable by
  the hook and by install/update — but nothing in the app writes to it yet. (Confirmed with the user:
  deferred to a follow-up task.)

  Proposed home for that follow-up, so it isn't re-litigated from scratch: a new **`/templates` page**,
  reached from the **hamburger menu** (alongside `/docs` and `/tools`) rather than the per-project nav bar
  — global report defaults, like the store in §1, are the same on every project, so they belong with the
  concerns that don't need a project open, not beside Workflows/Rules/Agents. Split the page into tabs so
  future global-template classes (beyond reports) each get a tab rather than a new nav entry; the first
  tab is "Reports," editing rows straight out of `report-defaults.ts`'s `reports`/`agent_reports` tables.
  Low edit frequency was the other reason for this placement — closer to a settings surface than a
  frequently-visited one.
- **No explicit "suppress this report" state.** A project can only override-to-different-content, never
  override-to-nothing when a global default exists. "No report" only ever arises from no override + no
  global default. Do not add a null/sentinel value to the `reports` slice for this.
- **No per-agent status indicator in the left list.** Confirmed with the user — the list stays exactly as
  plain as today's Tools table.
- **No shared/reusable report ids created through the UI.** Every project-override id equals its agent's
  own name; the id indirection exists in the schema (for the global tier's future reuse, and so
  install/update sync has somewhere to record `syncedFrom`) but nothing in this slice lets a user point two
  agents at one shared project-level id.

## File-by-file map

| Concern | File |
| --- | --- |
| Global report-defaults store (sqlite, mirrors `skill-tags.ts`) | `apps/maestro/src/core/report-defaults.ts` |
| Pure resolution (project → global → none) | `apps/maestro/src/core/report-resolution.ts` |
| `MaestroReportsSlice`/`MaestroReportEntry` types | `apps/maestro/src/core/types.ts`, re-exported via `contracts.ts` |
| Plugin-lib bundle entry for the global store | `apps/maestro/src/core/plugin-entries/maestro-report-defaults.ts` → generated `plugins/maestro/scripts/lib/maestro-report-defaults.cjs` (`pnpm --filter maestro build:plugin-libs`) |
| Hook injection (new, unconditional branch) | `plugins/maestro/scripts/maestro-inject-agent-context.js` |
| Install/update sync step | `plugins/maestro/scripts/maestro-install.js` + its update path, and `apps/maestro/src/core/install.ts` |
| Migration: strip sections, seed defaults | `plugins/maestro/agents/{backend,frontend,mobile,scribe,test}.md`; seed logic in `report-defaults.ts` (idempotent on first read) |
| New page | `apps/maestro/src/renderer/src/routes/agents.tsx` (+ a detail/editor component under `components/`) |
| Removed tab | `apps/maestro/src/renderer/src/components/tabs/agents-tab.tsx`, its entry in `routes/tools.tsx`'s `TABS` |
| Save channel (plain write, no model) | `src/shared/ipc.ts` + handler in `src/main/ipc.ts` |
| Nav entry | `apps/maestro/src/renderer/src/components/top-nav.tsx` |

## Acceptance criteria

- [ ] Any discovered agent (project/user/bundled-maestro/plugin-sourced) can have a report resolved for
      it, not just the 7 bundled workers
- [ ] `backend`/`frontend`/`mobile`/`scribe`/`test` have their `## Mandatory Output Format` section removed
      from their `.md` files, and a subagent run through Maestro still receives the same report instruction
      — now via injection, sourced from the seeded global default
- [ ] `refactor`/`reviewer` (and any other agent with no configured report) receive no output-format
      instruction, same as today
- [ ] The `SubagentStart` hook injects a resolved report **even when the agent type doesn't match any node
      in the active workflow** (i.e. this lookup is not gated by `matchedInstances`, unlike the existing
      skills/HANDOFF logic)
- [ ] A project can override an agent's report; the override is a plain `.md` file at
      `.claude/reports/<agent-name>.md`, referenced from `maestro.json`'s new `reports` slice
- [ ] Editing and saving from the `/agents` page always writes a project override keyed by the *edited
      agent's own name*, never a shared/inherited global id — editing `backend`'s report never changes what
      `frontend` or `mobile` resolve to
- [ ] `/maestro-install` and `/maestro-update` (both the terminal script and the desktop app's install
      path) sync project reports from the global default: materialize if absent, refresh if unmodified since
      last sync, skip-and-flag-as-stale-but-customized if the project copy has diverged
- [ ] The global sqlite store degrades gracefully (no crash, no report injected) on a `node` without
      `node:sqlite` (< 22.5), matching the existing `maestro-skill-tags.cjs` precedent
- [ ] `/tools`' Agents tab is removed; `/agents` is a new top-level route with the same agent list on the
      left (no status badges) and a single freeform editor on the right showing the resolved report
- [ ] Saving a report from `/agents` is a plain file write — no Claude session, no `claude:preview`/`run`,
      no token involved
- [ ] No UI exists yet for editing the global default tier — confirmed out of scope for this slice
