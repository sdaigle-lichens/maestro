---
name: global-stores
description: "Explains Maestro's machine-wide node:sqlite stores under ~/.claude — skill tags, agent types, agent project tags, report defaults and avatars — why each is global rather than per-project (the reasons differ), why node:sqlite rather than a JSON blob or a native module, and how the two-dimensional skill/agent classification routes a skill to an agent. Use when working inside apps/maestro and adding a store, wondering why a tag survives switching projects, why SKILL_TAGS is gone, where a report default comes from before the project has an opinion, or why an agent's description is written back to its own .md instead of a store."
metadata:
  type: concept-skill
  version: "1.1"
  last-update: 5555a3e81af2255ebb44a312f5d932bd8dbdff8f
---

# Global stores

Five modules in `apps/maestro/src/core` share one mechanism: a `node:sqlite` database under
`~/.claude`, one store per machine, read by every project the app opens. They are the deliberate
counterweight to [`maestro-config-model`](../maestro-config-model/SKILL.md) — state that is
explicitly _not_ per-project.

| Store                                         | File                    | Keyed by               |
| --------------------------------------------- | ----------------------- | ---------------------- |
| `~/.claude/maestro-skill-tags.sqlite`         | `skill-tags.ts`         | skill id               |
| `~/.claude/maestro-agent-types.sqlite`        | `agent-types.ts`        | agent name             |
| `~/.claude/maestro-agent-project-tags.sqlite` | `agent-project-tags.ts` | agent name             |
| `~/.claude/maestro-report-defaults.sqlite`    | `report-defaults.ts`    | agent name → report id |
| `~/.claude/maestro-avatars.sqlite`            | `avatar-store.ts`       | agent name             |

Each exports a `DEFAULT_*_DB_PATH` constant, and each accepts an override so tests never touch the
real machine's store.

## Why global — the reasons are not the same

Do not collapse these into one rationale; the modules' own headers distinguish them:

- **Skill tags and avatars** are global because _the thing is the same thing everywhere_. A skill
  from a marketplace is the same skill wherever it is used, so tagging it once should tag it
  everywhere; an agent named the same thing should look the same everywhere.
- **Report defaults** are global for a different reason: they are the **fallback tier** a project
  falls back to when it has no opinion of its own, and the thing install/update syncs a project's
  `.claude/reports/*.md` _from_.

## The exception: a description is not a store

`/agents` also edits an agent's **description**, and that one deliberately does *not* get a store.
`src/core/agent-descriptions.ts` writes it back into the agent's own `.md` frontmatter over the
`agent:describe` channel. The reason is the test to apply before adding a sixth store: type, project
tag and avatar are **Maestro's own metadata** and mean nothing to a Claude session, so a machine-wide
copy is the truth. A description is the line **Claude Code itself reads** to decide when to dispatch
the agent, so a copy beside the app would make the page show one sentence while every run used
another.

Two guards bound the write, and both are about not lying to the user:

- `EDITABLE_AGENT_SOURCES` (`contracts.ts`) is `["project", "user", "maestro"]`. An **installed
  plugin's** agents are refused — they live in a version-keyed marketplace cache that the next plugin
  update overwrites, so an edit there is discarded, not merely unowned. `contracts.ts` is otherwise
  interfaces-only; this is a deliberate value export (alongside `GLOBAL_TAG` / `AVATAR_CATEGORIES` /
  `AGENT_TYPES`) so the renderer can decide from `source` alone with no round trip.
- `setAgentDescription` additionally `fs.access(W_OK)`-checks the file, so a packaged build's
  read-only bundled agents report why instead of appearing to save.

`replaceDescriptionInFrontmatter` **refuses** a YAML block scalar (`|`, `>`) or a value continued on
the next line rather than flattening it: `parseFrontmatter` already misreads those, and rewriting
only the first line would leave the continuation dangling as garbage keys.

## Why `node:sqlite`

No native module, and therefore no `electron-rebuild` step. `skill-tags.ts`'s header carries the
full argument — the other four cite it rather than restating it. A new store should use the same
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

- [`maestro-config-model`](../maestro-config-model/SKILL.md) — the per-project counterpart; the
  `reports` slice is what overrides the `report-defaults` tier.
- `maestro-architecture` (at the repo root `.claude/skills`) — the `SubagentStart` hook resolves a
  report across these tiers at dispatch time.
- [`plugin-libs-parity`](../plugin-libs-parity/SKILL.md) — four of these five have a generated CJS
  twin under `plugins/maestro/scripts/lib/` so hooks can read them without `node_modules`.

## Sub-concepts

- [Skill tags](sub-concepts/skill-tags.md) — the two-dimensional skill→agent routing.
- [Agent types and project tags](sub-concepts/agent-classification.md) — the per-agent half of that
  match.
- [Report defaults](sub-concepts/report-defaults.md) — the global fallback tier and its two tables.
- [Avatars](sub-concepts/avatars.md) — cosmetic, layered, keyed by agent name.
