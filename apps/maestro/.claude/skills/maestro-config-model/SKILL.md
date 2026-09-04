---
name: maestro-config-model
description: "Explains MaestroConfigV3 — the schema at .claude/maestro.json that the desktop app writes and the runtime reads, the slice-merge discipline that keeps /workflows saves from clobbering /rules assignments, the read-before-write rule when one slice has two writers, why mergeSlice has no else branch and why the reports and handoffs slices deliberately have no arm in it, which fields are machine-owned, and which state deliberately lives outside this file (sessions, concept-skills.json). Use when working inside apps/maestro or plugins/maestro and adding a config field, wondering why a saved change vanished, which file is authoritative for a given piece of state, or how instances/nodes/edges/rules map onto the canvas."
metadata:
  type: concept-skill
  version: "1.4"
  last-update: 09ac67a729dace3fc5e437e956037d53771cdac8
---

# Maestro config model (v3)

`.claude/maestro.json` is the single place the two halves of Maestro meet: the desktop app writes it
with no Claude session in the loop, and the runtime hooks read it inside a session with no app
running. Everything else is derived. The schema is `MaestroConfigV3` in
`apps/maestro/src/core/types.ts`; `config.ts` reads, merges and writes it; `save.ts` is the one
entry point the IPC layer calls.

## The shape

| Field                                   | Meaning                                                                                                               |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `version: 3`                            | Schema version. `mergeSlice` re-stamps it on every write.                                                             |
| `agents_available` / `skills_available` | What the project has offered to the canvas.                                                                           |
| `workflow_instances`                    | Reusable agent+skills pairings (`MaestroInstanceV3`) that nodes point at.                                             |
| `workflows`                             | The graphs themselves — `MaestroWorkflowV3`, made of `MaestroNodeV3` and `MaestroEdgeV3`.                             |
| `rules`                                 | `MaestroRuleV3[]` — rule files and the scopes they are assigned to.                                                   |
| `reports?`                              | Per-agent report overrides. Absent means "no project-level opinion", and resolution falls through to the global tier. |
| `handoffs?`                             | Per-route `handoff_details` protocol overrides (`033`), keyed `"<sender>/<receiver>"` with **bare** agent names. Flat, not nested — `decideSync` tracks one thing per key and the thing here is a pair. Same absence rule as `reports?`. |
| `runtimeVersion?`                       | The plugin version whose runtime bundle was last installed here.                                                      |
| `project_tags?`                         | Which Project Tags catalog entries this project belongs to.                                                           |
| `gates?`                                | The orchestrator's two optional Step 1 gates, `{ confidence_check, use_design_check }`. **Absent means both off** — resolved at read time, never migrated. |

## Slice merges are the load-bearing rule

Saves never write the whole file. `ConfigSlice` is a union of exactly four shapes — `workflows`,
`rules`, `project-tags`, `gates` — and `mergeSlice` copies only that slice's fields onto the current
config. The comment on it is explicit about why: **this separation is the reason `/workflows` saves can't
clobber `/rules` assignments and vice versa, and widening any branch to write another's fields
reintroduces that bug.** Adding a field means deciding which slice owns it, not appending to
whichever save path is nearest.

**`mergeSlice` has four explicit `sliceType` tests and no `else`, on purpose** (`032`). It used to
end in a catch-all `else` that happened to mean `project-tags`; that is a latent instance of exactly
the clobbering bug the function's own header warns about, because the *next* slice added would have
silently inherited the previous one's write. A fifth slice must add a fifth test — being forgotten
should be a no-op, never a wrong write.

**`reports` and `handoffs` have no `mergeSlice` arm at all, and that is not an omission.** They are
never written through `config:save`. Their writers are the install-time syncs (`report-sync.ts`,
`handoff-sync.ts`) and the explicit save functions (`saveProjectReportOverride`,
`saveProjectHandoffOverride`), each of which does its own `readConfig` → mutate one key →
`writeConfig`. Adding a `sliceType` for either would put a second, racier path onto state that
already has a writer. `033` followed that precedent rather than reopening it.

**A slice can have more than one writer, and then read-before-write is the rule.** The `workflows`
slice now has two: `/workflows`, and `/agents` (which edits the selected instance's `loaded_skills` /
`referenced_skills`). Because the merge replaces the *whole* block, a writer that saves a copy it
loaded minutes ago reverts everything the other one did in between — so `/agents` re-reads via
`data:workflows` immediately before calling `config:save`, and mutates only the one instance in that
fresh config. Any third writer of an existing slice owes the same.

## What is machine-owned, and what lives elsewhere

- `runtimeVersion` is **the one machine-owned field**. `installRuntime()` and `maestro-install.js`
  stamp it on every install/update, and it is the only thing either writes here unasked
  (see `install.ts`'s header).
- **Session state is not here.** `maestro_session.json`, `maestro_session.log.jsonl` and
  `maestro_session_tasks.json` are ephemeral and separately owned.
- **Concept-skill state is not here either.** As of `ff24b37` it lives in its own
  `<root>/.claude/concept-skills.json` (`MaestroConceptSkillsState`), because concept skills are a
  plain `.claude/skills` convention and a repo can keep a reconciled list without Maestro installed.
  Older docs that say `maestro.json` holds `concept-skills-last-update` are stale.

## Files

| File                       | Role                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------- |
| `src/core/types.ts`        | The schema — every `MaestroConfigV3` type and slice.                                                |
| `src/core/config.ts`       | `maestroJsonPath`, `readConfig`, `writeConfig`, `mergeSlice`, `blankConfig`, `writeRuntimeVersion`, `resolveGates`/`DEFAULT_GATES`. |
| `src/core/save.ts`         | `saveConfig` — merge, write, re-render the orchestrator, apply rules.                               |
| `src/core/render.ts`       | Renders the orchestrator's handoff table from the config.                                           |
| `src/core/success-path.ts` | Derives the agent→skill success path a workflow describes.                                          |

## Relationships

- [`workflow-view`](../workflow-view/SKILL.md) and [`rule-view`](../rule-view/SKILL.md) — the two
  editors, one slice each.
- [`global-stores`](../global-stores/SKILL.md) — the classification state that is deliberately
  _machine_-wide instead of living in this per-project file.
- `maestro-architecture` (at the repo root `.claude/skills`) — the runtime that reads this file.

## Sub-concepts

- [Workflows slice](sub-concepts/workflows-slice.md) — instances, nodes, edges and the success path.
- [Rules slice](sub-concepts/rules-slice.md) — rules and their scopes.
- [Reports slice](sub-concepts/reports-slice.md) — per-agent overrides and tier fallback.
- [Handoffs slice](sub-concepts/handoffs-slice.md) — per-route overrides, the path-shaped key, and
  the third tier that `reports` does not have.
- [Project tags slice](sub-concepts/project-tags-slice.md) — catalog membership.
- [Gates slice](sub-concepts/gates-slice.md) — the orchestrator's optional Step 1 gates, and how an
  absent or malformed value resolves.
