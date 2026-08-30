# create-concept-skills

Builds a project's **concept-skill list** from nothing: the directory, `SKILL.md` and
`sub-concepts/` skeleton for each of the project's core concepts.

This README covers the whole three-skill system, since the marker format, the script and the version
scheme are shared. The two siblings link back here.

## What a concept skill is

An ordinary `.claude/skills/<id>/SKILL.md` whose frontmatter `metadata:` map marks it:

```yaml
---
name: log-view
description: "How the session-log view is built end to end. Use when ..."
metadata:
  type: concept-skill
  version: "1.0"
  last-update: 1058482a1b2c3d4e5f6789
---
```

It explains one **core concept** — a large feature, or an important slice of logic or runtime — and
it is written for Claude and its subagents rather than for humans. Human-facing material stays in
`docs/`; the `scribe` skill is the rule for that split.

Optional subdirectories, both referenced from the `SKILL.md`:

- `sub-concepts/*.md` — a distinct part of the concept that deserves its own file
- `agents/*.md` — notes for one agent in particular, written only for agents in the project's
  `agents_available`

### Why `metadata`, and not a top-level key

`metadata` is the Agent Skills spec's designated home for third-party key-value data: Claude Code
accepts it and deliberately does not act on its contents — the docs call it a *"free-form YAML map
for your own key-value data … read by your own tooling from `SKILL.md`"*.

Inventing a top-level key such as `concept-version:` instead is not merely unsanctioned. `metadata`
is one of only **six** fields that survive the other distribution paths — claude.ai skill uploads,
the Skills API, and packaging with `package_skill.py` (`allowed-tools`, `compatibility`,
`description`, `license`, `metadata`, `name`) — and those paths reject an unknown key with a **hard
error** rather than ignoring it. A skill with a custom top-level key loads perfectly well in Claude
Code and fails to package, which is the worst place to discover it.

One trap on the read side: `parseFrontmatter` in `packages/claude-fs` has no notion of depth, so a
`metadata:` block does not fail — it **flattens** into top-level keys. It yields the right values by
accident, which is exactly why nothing should rely on it; use `parseFrontmatterMetadata`, which
parses the map properly and can tell `metadata.version` from a top-level `version`.

A stamp edits an existing `metadata:` map in place and keeps any keys that are not ours — it is the
user's map, and this feature is one tenant in it.

## The three flows

| Skill | When | Depth |
|---|---|---|
| `create-concept-skills` | No list exists | Wide, shallow. Skeletons only. |
| `update-concept-skills` | The list exists and the code moved | Wide, shallow. Reconciles against a diff. |
| `update-single-concept-skill` | One skill is thin, or an agent reported a gap | Narrow, deep. |

Each refuses to do the others' job: `create` stops if a list already exists, `update` stops if one
doesn't.

## Versions

`major.minor`, on each skill and on the repo-level record.

| Event | Skill | `maestro.json` |
|---|---|---|
| `create-concept-skills` | `1.0` | `1.0` |
| `update-concept-skills` revises a skill | minor | minor |
| `update-concept-skills` adds/deletes a skill | new one at `1.0` | **major** |
| `update-single-concept-skill` | **major** | untouched |

A skill still at `x.0` has never had a deep pass, which is exactly what `update-single-concept-skill`
reads to decide how hard to search. **Never hand-edit these** — a hand-set version silently changes
how much work the next pass does.

## The script

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" list [--json]
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" state
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" agents
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" stamp <id-or-dir> --bump minor|major|initial [--sha <sha>]
node "${CLAUDE_PLUGIN_ROOT}/scripts/maestro-concept-skills.cjs" state-set --bump minor|major|initial [--sha <sha>]
```

`agents` prints the project's `agents_available` as a JSON array — the list
`update-single-concept-skill` writes `agents/<agent>.md` notes for, and `[]` (meaning "write none")
for a project with no `maestro.json`.

Every command also takes **`--root <dir>`**, naming the repository to act on. It defaults to
`$CLAUDE_PROJECT_DIR` and then the process's cwd, so a skill running in a session never needs it;
it exists so the script can be pointed at another repo, the same way every module under
`apps/maestro/src/core/` takes a `projectRoot` argument. The root is resolved once, at the top of
the script, and passed down — nothing re-derives it per command, and nothing reads
`CLAUDE_PROJECT_DIR` without a fallback (an inline `node -e` that does reads `undefined/.claude/…`,
swallows its own error, and reports an empty answer that looks like a real one).

`list` walks **every** `.claude/skills` in the tree, not just the root's — in a monorepo a concept
skill lives beside the code it explains. The logic lives in
`plugins/maestro/scripts/lib/maestro-concept-skills.cjs`, generated from
`apps/maestro/src/core/concept-skills.ts` by `pnpm --filter maestro build:plugin-libs`; the `.cjs`
under `lib/` is **generated and must not be hand-edited**.

Version arithmetic, the `HEAD` lookup and the frontmatter rewrite live in the script rather than in
the skill prose because a model asked to "bump the minor version" gets it right most of the time, and
the times it doesn't are invisible.

## Output locations

- The concept skill: `<dir>/.claude/skills/<concept-id>/`, in the `.claude` **nearest the concept's
  code** — `apps/web/.claude/skills/...` for a concept living in `apps/web`.
- The repo-level record: the `concept_skills` block on `<root>/.claude/maestro.json`. Machine-owned,
  like `runtimeVersion`. Absent `maestro.json`, `state-set` reports `written:false` and the skills'
  own markers remain the source of truth.

## Related

- `update-concept-skills` — reconciles the list after the code moves
- `update-single-concept-skill` — takes one skill from skeleton to useful
- `scribe` — what belongs in a concept skill versus in `docs/`
