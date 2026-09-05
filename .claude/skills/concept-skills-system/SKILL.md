---
name: concept-skills-system
description: "Explains the concept-skill machinery the maestro plugin ships: what marks a SKILL.md as a concept skill (frontmatter metadata.type/version/last-update), the sub-concepts/ and agents/ directory convention, the maestro-concept-skills.cjs CLI that owns versions and stamping, where the repo-level state lives (.claude/concept-skills.json, not maestro.json), and how create/update/update-single/scribe divide the work. Use when working on any of the four concept-skill skills, adding a CLI subcommand, wondering why a skill isn't in the list, or deciding whether something belongs in a concept skill or in docs/."
metadata:
  type: concept-skill
  version: "1.2"
  last-update: 4d2513dac4c6fdef96d89502abfba7859879d641
---

# Concept-skill system

A **concept skill** is an ordinary `.claude/skills/<id>/SKILL.md` whose frontmatter `metadata:` map
says it explains one of the project's core concepts, and how fresh that explanation is:

```yaml
metadata:
  type: concept-skill
  version: "1.0"
  last-update: <commit sha>
```

Nothing else distinguishes it. That is deliberate — concept skills are a plain `.claude/skills`
convention, so a repo can keep a reconciled list of them without Maestro installed at all.

## Directory shape

```
<dir>/.claude/skills/<concept-id>/
  SKILL.md
  sub-concepts/<name>.md     # distinct parts of the concept, linked from SKILL.md
  agents/<agent>.md          # per-agent notes; written only by /update-single-concept-skill
```

In a monorepo a concept skill goes in the `.claude` **nearest its code** — which is why this repo's
app concepts live under `apps/maestro`. The exception is code the repo *publishes*: `plugins/` ships
to the plugin's end users, so nothing developer-facing may live there, and the concepts describing
the runtime sit in the root `.claude` instead. See the placement rule in the repo's `CLAUDE.md`.

## The four skills, and what each is allowed to cost

| Skill | Job | Depth |
| --- | --- | --- |
| `create-concept-skills` | Derive the whole list empirically, agree it with the user, write skeletons | Breadth only — delegates reading to cheap subagents and must not become a know-it-all session |
| `update-concept-skills` | Reconcile the list against what changed since `last-update` | Diff-driven; accepts a code-change report to skip re-exploration |
| `update-single-concept-skill` | Take one skill from skeleton to worth loading, incl. `agents/` notes | Deep on one concept, still not exhaustive |
| `scribe` | The placement rule: concept skill vs `docs/` vs a `docs/` file a skill references | — |

Version conventions follow that split: `update-concept-skills` bumps a touched skill **minor**,
`update-single-concept-skill` bumps one **major** (a deep research pass is what separates a
researched skill from a skeleton), and a skill created in either run gets **initial**.

**The repo-level record moves by `0.1` and effectively only by `0.1`.** A reconciliation bumps it
minor whether or not concepts were added or deleted — adding one is the ordinary outcome of a pass,
not a different kind of event, and treating it as a major made the number jump a whole version for a
routine run. `--bump major` on `state-set` stays in the CLI for a wholesale re-derivation of the
list; nothing in the four flows reaches for it today, and `create-concept-skills` seeds a new list
with `initial` instead.

## The CLI owns the versions

```
maestro-concept-skills.cjs list [--json]
maestro-concept-skills.cjs state
maestro-concept-skills.cjs agents
maestro-concept-skills.cjs stamp <id-or-dir> --bump minor|major|initial [--sha <sha>]
maestro-concept-skills.cjs state-set --bump minor|major|initial [--sha <sha>]
```

Every command takes `--root <dir>` (default `$CLAUDE_PROJECT_DIR`, then cwd).

**Never hand-edit `metadata.version` or `metadata.last-update`.** The script owns them so a version
cannot quietly drift — and a version stuck at `1.0` makes `/update-single-concept-skill` re-research
a concept that was already done.

## `list` is a runtime contract, not just a maintenance command

Two **published** plugin skills inject its stdout with Claude Code's `` !`command` `` syntax while
the harness expands them, each granting exactly
`Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" list)` in `allowed-tools`:
`use-code-architecture-design-check` (to judge whether a task adds or reshapes a concept) and
`code-architecture-design` (to load the concepts a new module sits next to). So `list`'s human
output format is depended on by end users' sessions, not only by the four flows — changing its shape
is a published-surface change, and both skills must keep the same fallback wording for the empty /
`[shell command execution disabled by policy]` case. `--json` is the stable form for programmatic
callers; leave it to them.

## Traps

- **A skill without the markers is invisible to `list`,** however concept-shaped it reads. This repo
  hit exactly that: eight hand-written concept skills existed under `apps/maestro/.claude/skills`
  while `list` reported none.
- **Repo-level state is not in `maestro.json`.** Since `ff24b37` it lives in its own
  `<root>/.claude/concept-skills.json` (`MaestroConceptSkillsState`: `version`, `last_update`). Docs
  or code referencing a `concept-skills-last-update` key on `maestro.json` are stale.
- **`create-concept-skills` must not write `agents/`.** Those notes need an understanding it has
  deliberately not acquired.

## Files

| File | Role |
| --- | --- |
| `plugins/maestro/scripts/maestro-concept-skills.cjs` | The CLI. |
| `plugins/maestro/scripts/lib/maestro-concept-skills.cjs` | Generated bundle of the shared logic. |
| `apps/maestro/src/core/concept-skills.ts` | The source: parsing, discovery, stamping, state. |
| `apps/maestro/src/core/plugin-entries/maestro-concept-skills.ts` | Entry point for the bundle. |
| `plugins/maestro/skills/{create,update}-concept-skills/`, `update-single-concept-skill/`, `scribe/` | The four skills. |
| `apps/maestro/test/core/concept-skills.test.ts` | Tests. |

## Relationships

- [`task-queue`](../task-queue/SKILL.md) — the other plugin subsystem with a CJS/TS pair.
- `plugin-libs-parity` (in `apps/maestro/.claude/skills`) — how `concept-skills.ts` reaches the CLI.
- `maestro-architecture` — the runtime that dispatches the `@scribe` agent that maintains this list.

## Sub-concepts

- [Metadata markers](sub-concepts/metadata-markers.md) — the frontmatter contract and versioning.
- [The four skills](sub-concepts/the-four-skills.md) — how create / update / update-single / scribe
  divide the work.
