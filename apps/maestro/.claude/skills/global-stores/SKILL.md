---
name: global-stores
description: "Explains Maestro's machine-wide node:sqlite stores under ~/.claude — skill tags, agent types, agent project tags, report defaults, handoff defaults and avatars — why each is global rather than per-project (the reasons differ), why node:sqlite rather than a JSON blob or a native module, why a store whose floor must survive an old `node` keeps its seed in a separate sqlite-free module, and how the two-dimensional skill/agent classification routes a skill to an agent. Use when working inside apps/maestro and adding a store, wondering why a tag survives switching projects, why SKILL_TAGS is gone, where a report or handoff default comes from before the project has an opinion, why handoff-defaults.ts has one table where report-defaults.ts has two, which surface edits which handoff tier and why a shipped pair offers Reset to default rather than Delete, why an agent's description is written back to its own .md instead of a store, or why agent-fork.ts was split in two."
metadata:
  type: concept-skill
  version: "1.9"
  last-update: 7d9972492e8941ebabb500dda544ddd621eb29a6
---

# Global stores

Six modules in `apps/maestro/src/core` share one mechanism: a `node:sqlite` database under
`~/.claude`, one store per machine, read by every project the app opens. They are the deliberate
counterweight to [`maestro-config-model`](../maestro-config-model/SKILL.md) — state that is
explicitly _not_ per-project.

| Store                                         | File                    | Keyed by                            |
| --------------------------------------------- | ----------------------- | ------------------------------------ |
| `~/.claude/maestro-skill-tags.sqlite`         | `skill-tags.ts`         | skill id                            |
| `~/.claude/maestro-agent-types.sqlite`        | `agent-types.ts`        | `(project_root, agent_name)` (`030`) |
| `~/.claude/maestro-agent-project-tags.sqlite` | `agent-project-tags.ts` | `(project_root, agent_name)` (`030`) |
| `~/.claude/maestro-report-defaults.sqlite`    | `report-defaults.ts`    | agent name → report id              |
| `~/.claude/maestro-handoff-defaults.sqlite`   | `handoff-defaults.ts`   | `"<sender>/<receiver>"` (`033`)      |
| `~/.claude/maestro-avatars.sqlite`            | `avatar-store.ts`       | `(project_root, agent_name)` (`030`) |

Each exports a `DEFAULT_*_DB_PATH` constant, and each accepts an override so tests never touch the
real machine's store.

## Keyed by project, not just agent name (`030`)

The three per-agent stores — types, project tags, avatars — widened their primary key from
`agent_name` alone to `(project_root, agent_name)`, `project_root = ''` meaning "global". This
matters only for a `project`-tier agent: two unrelated projects that each define
`.claude/agents/reviewer.md` no longer share one avatar/type/tag row. `user`/`maestro`/plugin-tier
agents are unaffected — they're the same agent everywhere, so they still key on `''` (global).

Every read/write function on these three takes an optional trailing `projectRoot?: string`:

- **Omitted** → touches the GLOBAL row only. This is what `/templates` and the plugin's
  install-time reader do, unchanged from before `030`.
- **Passed on a bulk read** (`readAllAgentTypes`, `readAllAgentProjectTags`, `readAllAvatars`) →
  one SQL query returns the global rows unioned with `projectRoot`'s own rows; a later row for the
  same agent name overwrites the earlier one as the result map is built, because `''` collates
  before any real path — so a project's own override wins over the global default for that project
  only.
- **Passed on a write** (`setAgentType`, `setAgentProjectTag`, `setAvatar`) → targets that
  project's own row exclusively.

**No migration.** Each store's `openDb()` calls a `dropLegacySchema()` helper that `DROP TABLE`s a
pre-`030` shape (no `project_root` column) before the `CREATE TABLE IF NOT EXISTS`/`seedIfEmpty`
that follows — a deliberate, one-time data loss, acceptable because Maestro wasn't installed
anywhere that mattered yet.

`report-defaults.ts` was deliberately **not** touched — it's already the global fallback tier by
definition (see below), a different kind of thing from these three's per-instance metadata.

## Why global — the reasons are not the same

Do not collapse these into one rationale; the modules' own headers distinguish them:

- **Skill tags and avatars** are global because _the thing is the same thing everywhere_. A skill
  from a marketplace is the same skill wherever it is used, so tagging it once should tag it
  everywhere; an agent named the same thing should look the same everywhere.
- **Report defaults and handoff defaults** are global for a different reason: they are the
  **fallback tier** a project falls back to when it has no opinion of its own, and the thing
  install/update syncs a project's `.claude/reports/*.md` and `.claude/handoffs/**.md` _from_.

**These two are the only stores a HOOK reads, and since `035` it reads them from the project's own
copy too.** Their generated bundles (`lib/maestro-report-defaults.cjs`,
`lib/maestro-handoff-defaults.cjs`) are now in `install.ts`'s `STATIC_ASSETS`, so
`maestro-inject-agent-context` resolves both tiers whether it runs from the marketplace cache or
from `<project>/.claude/scripts/`. Before that only the plugin's copy could — the project copy's
`require` resolved nothing, its try/catch swallowed the failure, and the tier silently did not
exist: no output format at all for an agent whose report is only global (reports have **no** seed
tier), and the shipped seed instead of the user's global row for a handoff. Consequence for this
skill: a store these two hooks read must keep a bundle that is safe under a bare, possibly old
`node`, and adding a `require` of a *third* store to the hook means adding its bundle to
`STATIC_ASSETS` in **both** install implementations. See `installing-maestro`'s manifest
sub-concept.

## `handoff-defaults.ts` is not a copy of `report-defaults.ts` (`033`)

Same argument for being global, deliberately different shape: **one table**, not
`report-defaults.ts`'s agent → `report_id` → content indirection; the id **is a path**
(`"<sender>/<receiver>"`, bare names) and is validated before any `path.join`; and the **seed lives
outside the store** in `handoff-seeds.ts`, which imports nothing, so the floor still answers on a
`node` too old for `node:sqlite`. See [Handoff defaults](sub-concepts/handoff-defaults.md).

Since `034` this store has **two editing surfaces** — `/templates`' Handoffs tab writes the global
rows, `/agents`' Interactions pane writes the project override that outranks them — and the tab is
the reason `template:handoffs:delete` refuses a seeded id. Both are in the sub-concept.

## The exception: a description is not a store

`/agents` also edits an agent's **description**, and that one deliberately does *not* get a store.
`src/core/agent-descriptions.ts` writes it back into the agent's own `.md` frontmatter over the
`agent:describe` channel. The reason is the test to apply before adding a seventh store: type, project
tag and avatar are **Maestro's own metadata** and mean nothing to a Claude session, so a machine-wide
copy is the truth. A description is the line **Claude Code itself reads** to decide when to dispatch
the agent, so a copy beside the app would make the page show one sentence while every run used
another.

Two guards bound the write, and both are about not lying to the user:

- `EDITABLE_AGENT_SOURCES` (`contracts.ts`) is `["project"]` (narrowed from `["project", "user",
  "maestro"]` in `029` — the `maestro` entry was editable by accident: bundled agents are ordinary
  files in a repo checkout but live inside `app.asar` in a packaged build). Every non-project tier is
  refused: `user`-tier agents belong to no project and are shared by every project on the machine;
  `maestro`/an **installed plugin's** agents live in a version-keyed marketplace cache that the next
  plugin update overwrites, so an edit there is discarded, not merely unowned.
  `describeUneditableSource` gives each its own message — see `agents-view`. `contracts.ts` is
  otherwise interfaces-only; this is a deliberate value export (alongside `GLOBAL_TAG` /
  `AVATAR_CATEGORIES` / `AGENT_TYPES` / `034`'s `BUNDLED_AGENT_NAMES`) so the renderer can decide
  from `source` alone with no round trip.
- `setAgentDescription` additionally `fs.access(W_OK)`-checks the file, so a packaged build's
  read-only bundled agents report why instead of appearing to save.

`replaceDescriptionInFrontmatter` **refuses** a YAML block scalar (`|`, `>`) or a value continued on
the next line rather than flattening it: `parseFrontmatter` already misreads those, and rewriting
only the first line would leave the continuation dangling as garbage keys.

## A fourth writer, on a fork

`agent-fork.ts`'s `copyAgentAttributeRows(fromName, toName, projectRoot, dbPaths?)` (`029`, rekeyed
`030`) is a new consumer of three of these six stores — avatar, agent type, project tag — called
only for a **renamed** fork on `/agents`. The read side stays name-only/global (a fork's source is
always a global-tier template), but the write side passes `projectRoot` — the new fork's own
project — since the copy always lands on a project-tier agent, and after `030`'s rekey landing it on
the global row would leak into every other project. A same-name fork needs no copy at all: the
shadowing row *is* the template's own global row. See `agents-view`.

**This writer is why `agent-fork.ts` was split in two (`031`).** It touches three sqlite stores, so
`agent-fork.ts` transitively imports `node:sqlite` — and `031`'s fork-staleness check has to reach
the plugin's hook scripts through a generated bundle that runs under a bare `node` which may predate
that module (the same constraint `maestro-skill-tags.cjs` lives with). So the sidecar and the
frontmatter arithmetic moved to **`agent-fork-record.ts`** (`agentForksPath`, `readAgentForks`,
`writeAgentForkRecord`, `removeAgentFork`, `bodyForHashing`, `hashAgentBody`, `mergeForkBody`,
`renameAgentInFrontmatter`), which imports no store; `agent-fork.ts` keeps `forkAgent` and
`copyAgentAttributeRows` and re-exports the rest, so every existing import still resolves. The
property to preserve: `grep -c "node:sqlite" plugins/maestro/scripts/lib/maestro-agent-sync.cjs`
must stay **0**. Adding a store import to `agent-fork-record.ts` breaks that silently — the bundle
still builds, and only a bare-`node` run notices.

## Why `node:sqlite`

No native module, and therefore no `electron-rebuild` step. `skill-tags.ts`'s header carries the
full argument — the other five cite it rather than restating it. A new store should use the same
mechanism for the same reason.

## The trap: `SKILL_TAGS` is gone

The old single-dimension `SKILL_TAGS` was literally the seven built-in agent _names_, matched 1:1
against an agent's name. It conflated "which kind of project" with "which kind of agent" into one
flat list and could only route a skill to an agent whose name it already knew. It has been replaced
by **two** dimensions — `projectTags` (from `project-tags.ts`'s catalog) and `agentTypes` (from
`agent-types.ts`'s closed vocabulary), each admitting `GLOBAL_TAG` for "regardless of". These match
against a seeded agent _instance's_ own stored attributes, which is what decouples Maestro from a
fixed agent roster. Any code or doc still routing by agent name is working from the retired model.

## Relationships

- [`agent-fork-sync`](../agent-fork-sync/SKILL.md) — why the sidecar and the frontmatter
  helpers had to leave `agent-fork.ts`: its `copyAgentAttributeRows` writes three of these
  stores, so it drags `node:sqlite` into any bundle that imports it.
- [`maestro-config-model`](../maestro-config-model/SKILL.md) — the per-project counterpart; the
  `reports` and `handoffs` slices are what override the `report-defaults` and `handoff-defaults`
  tiers.
- `maestro-architecture` (at the repo root `.claude/skills`) — the `SubagentStart` hook resolves a
  report *and* a per-route handoff protocol across these tiers at dispatch time.
- [`agent-fork-sync`](../agent-fork-sync/SKILL.md) — `syncProjectHandoffs` is `decideSync`'s third
  caller, and syncs `.claude/handoffs/` from this store the way `report-sync.ts` syncs
  `.claude/reports/`.
- [`plugin-libs-parity`](../plugin-libs-parity/SKILL.md) — five of these six have a generated CJS
  twin under `plugins/maestro/scripts/lib/` so hooks can read them without `node_modules` (every one
  but `avatar-store.ts`).
- [`agents-view`](../agents-view/SKILL.md) — the fourth writer above, and the "Fork into this
  project" button that triggers it.

## Sub-concepts

- [Skill tags](sub-concepts/skill-tags.md) — the two-dimensional skill→agent routing.
- [Agent types and project tags](sub-concepts/agent-classification.md) — the per-agent half of that
  match.
- [Report defaults](sub-concepts/report-defaults.md) — the global fallback tier and its two tables.
- [Handoff defaults](sub-concepts/handoff-defaults.md) — the one-table twin, its path-shaped id, and
  the sqlite-free seed module that keeps the floor alive on an old `node`.
- [Avatars](sub-concepts/avatars.md) — cosmetic, layered, keyed by agent name.
