---
name: concept-skills-system
description: "Explains the concept-skill machinery the opt-in concept-skills plugin ships (plugins/concept-skills, built from packages/concept-skills): what marks a SKILL.md as a concept skill (frontmatter metadata.type/version/last-update), the sub-concepts/ and agents/ directory convention, the concept-skills.cjs CLI that owns versions and stamping, where the repo-level state lives (.claude/concept-skills.json, not maestro.json), and the agents list in concept-skills.json, the install/update/uninstall lifecycle skills, and how create/update/update-single/scribe divide the work. Use when working on any of the four concept-skill skills, adding a CLI subcommand, wondering why a skill isn't in the list, deciding whether something belongs in a concept skill or in docs/, or deciding which .claude/skills directory a new concept skill belongs in (an app's, or the repo root's — the rule is by audience, and nothing developer-facing may live under plugins/)."
metadata:
  type: concept-skill
  version: "1.6"
  last-update: 62480e70bb0ff20ae35d470edc9d4dc093f296d0
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

## Where a concept skill goes

Documentation written for agents working on a codebase — concept skills in particular — goes in the
`.claude/skills/` **nearest the code it describes**. In this repo that is a choice between exactly
two homes:

| Home | For |
| --- | --- |
| `apps/<app>/.claude/skills/` | A concept that lives inside that app. Loads only for work under that app. |
| `.claude/skills/` at the repo root | Everything else — including concepts whose code sits under `plugins/maestro/` (the runtime, the install/update paths, the task queue, this machinery). Loads repo-wide. |

**The split is by audience, not by which directory the code sits in.** `plugins/<name>/` ships to
that plugin's end users, so nothing developer-facing may live there (see
`.claude/rules/plugin-publishing.md`). A concept describing `plugins/maestro/` therefore has no app
to belong to and lands at the root: `maestro-architecture` documents the plugin's runtime *for
developers* and is a root skill, while `plugins/maestro/skills/maestro-install/` is a skill the
plugin *publishes*.

## The four skills

`create-concept-skills` (derive the whole list, breadth only, skeletons),
`update-concept-skills` (reconcile against `last-update`, bumps minor),
`update-single-concept-skill` (one skill from skeleton to worth loading, incl. `agents/` notes,
bumps major) and `scribe` (the concept-skill vs `docs/` placement rule). A skill created in either
run gets `initial`, and the repo-level record moves only by `0.1`. See
[The four skills](sub-concepts/the-four-skills.md) for each one's budget and the bump rationale.

## The CLI owns the versions

```
concept-skills.cjs list [--json]
concept-skills.cjs state
concept-skills.cjs agents              # the "agents" list in concept-skills.json
concept-skills.cjs agents-discover     # what agent files / maestro.json suggest
concept-skills.cjs agents-set <name>...
concept-skills.cjs stamp <id-or-dir> --bump minor|major|initial [--sha <sha>]
concept-skills.cjs state-set --bump minor|major|initial [--sha <sha>]
```

Every command takes `--root <dir>` (default `$CLAUDE_PROJECT_DIR`, then cwd). The root is resolved
once at the top of the CLI and passed down; never read `CLAUDE_PROJECT_DIR` without that fallback —
an inline `node -e` that does reads `undefined/.claude/…`, swallows the error, and reports an empty
answer that looks like a real one.

**Never hand-edit `metadata.version` or `metadata.last-update`.** The script owns them so a version
cannot quietly drift — and a version stuck at `1.0` makes `/update-single-concept-skill` re-research
a concept that was already done.

A stamp rewrites only the two `metadata:` lines: `packages/concept-skills/test/concept-skills.test.ts` asserts the rest
of the file comes back **byte-identical**, including a `description` with a colon in it. A
frontmatter rewriter that reserialises what it parsed eventually loses something, so the test is
byte equality rather than a structural comparison.

## `list` is a runtime contract, not just a maintenance command

The published `load-concept-skills` helper injects its stdout with Claude Code's `!`-prefixed
command-injection syntax, granting exactly
`Bash(node "${CLAUDE_PLUGIN_ROOT}/scripts/concept-skills.cjs" list)` in `allowed-tools`, and maps
empty output, `[shell command execution disabled by policy]` or a "none found" message to **NO LIST**.
Other skills reach the list only through it (`use-code-architecture-design-check` directly,
`code-architecture-design` via `explore-concept-skills`), so changing `list`'s human output shape is
a published-surface change that must keep that NO LIST mapping true. `--json` is the stable form for
programmatic callers; leave it to them.

## Traps

- **A skill without the markers is invisible to `list`,** however concept-shaped it reads. This repo
  hit exactly that: eight hand-written concept skills existed under `apps/maestro/.claude/skills`
  while `list` reported none.
- **Repo-level state is not in `maestro.json`.** Since `ff24b37` the `concept-skills` plugin keeps it in its own
  `<root>/.claude/concept-skills.json` (`ConceptSkillsState`: `version`, `last_update`, plus the `agents` list). Docs
  or code referencing a `concept-skills-last-update` key on `maestro.json` are stale.
- **With code-graph, the state is in `scribe.config.json`.** This repo has switched: its
  `{version, last_update, agents}` record is the `skills` block of `<root>/scribe.config.json`. The
  `code-graph.cjs` CLI reads that block when it carries string `version` and `last_update`, and falls back to
  `.claude/concept-skills.json` only otherwise; `agents` follows the block whenever the block has an `agents`
  key. So `.claude/concept-skills.json` here is legacy: editing it changes nothing the code-graph CLI sees.
  (Read from the bundled `code-graph.cjs`; the `concept-skills.cjs` CLI below still reads only the legacy file.)
- **`create-concept-skills` must not write `agents/`.** Those notes need an understanding it has
  deliberately not acquired.

## Files

| File | Role |
| --- | --- |
| `plugins/concept-skills/scripts/concept-skills.cjs` | The CLI. |
| `plugins/concept-skills/scripts/lib/concept-skills.cjs` | Generated bundle of the shared logic (never hand-edit). |
| `packages/concept-skills/src/concept-skills.ts` | The source: parsing, discovery, stamping, state, the agents list. |
| `packages/concept-skills/scripts/build-plugin-lib.mjs` | Builds the bundle: `pnpm --filter @repo/concept-skills build:plugin-lib`. |
| `plugins/concept-skills/skills/{create,update}-concept-skills/`, `update-single-concept-skill/`, `scribe/` | The four skills. |
| `plugins/concept-skills/skills/concept-skills-{install,update,uninstall}/` | Lifecycle: enable the plugin and seed `concept-skills.json` (with the `agents` list); disable it. They never edit `maestro.json`. |
| `plugins/concept-skills/skills/{load,explore}-concept-skills/`, `use-code-architecture-design-check/`, `code-architecture-design/` | Helpers and the two design skills. |
| `packages/concept-skills/test/concept-skills.test.ts` | Tests. |

## Opt-in, and how Maestro relates

The plugin is opt-in per project (Claude Code `enabledPlugins`). Maestro names none of it: the
scribe agent has no concept-skill trigger, gaps are a generic `skill_gaps`, and the seeds name the
design skill only when `seedSkillsFor()` (`apps/maestro/src/core/skill-availability.ts`) finds it
resolvable: `DESIGN_CHECK_CANDIDATES` is `code-graph:use-code-architecture-design-check`, then
`concept-skills:…` (first available wins). `maestro-update` runs `maestro-stale-refs.cjs` to flag
skill ids in `maestro.json` that no longer resolve, and its `pluginSuggestions()` suggests: enabling
`code-graph` when a root `scribe.config.json` exists without it; installing code-graph from its own
marketplace and migrating via `/code-graph-install` when the legacy `.claude/concept-skills.json`
exists and code-graph is off (whether or not `concept-skills` is still enabled). It no longer
suggests `concept-skills@maestro`. `readAgentsAvailable` lives in Maestro's `config.ts`; the CLI's
`agents` reads its own list instead.

## Relationships

- [`task-queue`](../task-queue/SKILL.md) — the other plugin subsystem with a CJS/TS pair.
- `plugin-libs-parity` (in `apps/maestro/.claude/skills`) — how the Maestro libs are built; the concept-skills lib has its own build in `packages/concept-skills`.
- `maestro-architecture` — the runtime that dispatches the `@scribe` agent that maintains this list.

## Sub-concepts

- [Metadata markers](sub-concepts/metadata-markers.md) — the frontmatter contract and versioning.
- [The four skills](sub-concepts/the-four-skills.md) — how create / update / update-single / scribe
  divide the work.
