# Skill discovery and resolution

Two related questions the install pipeline answers about a project's skills: **which skill ids exist**
(seeding `skills_available`), and **where a given id's `SKILL.md` actually lives** (a runtime lookup
after the fact). They share one walk.

## Discovery — what a fresh seed sees (`056`)

The `skillMap` / `skills_available` flags only ever affect a **fresh seed**; a project with an
existing `maestro.json` is never re-derived.

Until `056` both readers behind them saw only the repository root's `.claude/skills/`.
`discoverSkills()` (app) and `discoverProjectSkillIds()` (terminal) now both walk **every**
`.claude/skills` in the tree — the same bounded walk `concept-skills-system`'s `skillSearchDirs`
uses, via the new `discoverProjectSkillsTree`.

On this repo that was the difference between seven `skills_available` entries and eighteen: the
twelve concept skills living beside `apps/maestro` were invisible, and a monorepo instance could be
seeded with **no skills at all and never know it**.

A name collision between two directories keeps the first found in walk order and is **reported
rather than silently resolved** — `console.warn` in the app, stderr in the terminal script, and
`InstallReport.warnings` for the app's caller.

## Resolution — a discovered id is not necessarily an invokable one (`061`)

**The Skill tool only indexes the repository ROOT's `.claude/skills` plus installed plugins.** A
monorepo skill discovered elsewhere in the walk gets "Unknown skill" from it, even though the
install recorded it in `skills_available`.

The walk both `discoverProjectSkillsTree` (app) and `discoverProjectSkillIds` (terminal) already do
at install time is factored into `apps/maestro/src/core/skill-resolve.ts` —
`walkProjectSkillIds` / `resolveProjectSkillPath` / `isRootSkillPath`, **root-wins on a collision**,
same order as the discovery functions — so a runtime caller can ask the identical question after the
fact. Two callers do:

- `maestro-inject-agent-context.js` resolves each `loaded_skills` / `referenced_skills` id it injects
  and appends a "read this file directly" note for any that land outside the root.
- The orchestrator template's Step 3 shells out to the project-copied
  `maestro-resolve-skill-path.cjs` when a task's own `Skills to use` name gets rejected the same way.

`maestro-resolve-skill-path.cjs` is a `STATIC_ASSET`, **not a hook** (`061`). Given a skill id on
argv it prints the `SKILL.md` path `walkProjectSkillIds` recorded it under, or nothing when the id
isn't a project skill at all; it **exits 0 either way**. `walkProjectSkillIds` reaches it bundled
into `lib/maestro-session.cjs`, so a change to `skill-resolve.ts` needs
`pnpm --filter maestro build:plugin-libs` — see `plugin-libs-parity`.

`skills_available` itself is unchanged by `061` — still bare ids. Only what a runtime caller *does*
when the Skill tool can't act on one changed.

Files: `apps/maestro/src/core/skill-resolve.ts`, `apps/maestro/src/core/install.ts`
(`discoverSkills`, `discoverProjectSkillsTree`), `plugins/maestro/scripts/maestro-install.js`
(`discoverProjectSkillIds`), `plugins/maestro/scripts/maestro-resolve-skill-path.cjs`,
`plugins/maestro/scripts/maestro-inject-agent-context.js`.
