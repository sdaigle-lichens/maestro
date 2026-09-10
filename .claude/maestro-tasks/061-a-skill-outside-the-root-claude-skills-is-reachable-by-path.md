# A skill outside the root .claude/skills is reachable by path

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Make every skill Maestro records actually loadable by the session that is told to load it.

**The break.** `maestro.json`'s `skills_available` holds skill ids discovered by walking every `.claude/skills` in the tree — correct for a monorepo, where a skill lives beside the code it documents. But the Skill tool only indexes the **repository root's** `.claude/skills` plus installed plugins. In this repository that is 6 of 19 ids; the other 13 sit under `apps/maestro/.claude/skills/` and answer `Unknown skill` when anything tries to load them by name. The subagent-context hook tells an agent to `Load each one with the Skill tool`, and a task file's `Skills to use` section names them the same way, so both produce an error the agent cannot act on and silently proceeds without documentation it was told it needed.

**Resolve at runtime, not in the config.** The recorded id stays an id. Nothing about the config model, the desktop app, or the generated bundles should change — a path baked into `maestro.json` would be wrong the moment a skill moved, and would have to be kept in step by two implementations instead of none. The resolution belongs where the instruction is written.

**One resolver, used by both callers.** The install script's `discoverProjectSkillIds` already computes each skill's directory while walking and then throws it away, keeping only the id. Factor that walk so it can return the path too, and expose it as a small project-copied script that takes an id and prints the resolved `SKILL.md` path, printing nothing and exiting 0 when the id is not a project skill. Exiting non-zero for an unknown id would abort the caller that injects it; an unknown id is an ordinary answer, not a failure.

The two callers then differ only in what they say:

- `maestro-inject-agent-context.js` — when a `loaded_skills` or `referenced_skills` id resolves to a path outside the root, name the path alongside the id and say to read that file, since the Skill tool will not find it. A root or plugin skill keeps today's wording exactly.
- The orchestrator template — its Step 3 hands an agent the task file's `Skills to use` list. It needs the same fallback in one line, so a name that the Skill tool rejects gets resolved rather than skipped.

**A skill loaded by path is not identical to one loaded by name** and the wording should not pretend otherwise: reading the file gets the content but not the Skill tool's own resource handling. Every id affected here is a concept skill — prose, no scripts, no bundled resources — so reading the file is the whole of it. Say that plainly where the instruction is written rather than leaving a reader to wonder what they lost.

The collision rule the walk already implements — root wins, and the rest are reported rather than resolved silently — must survive: the resolver returns the same directory the id was recorded from, not whichever match a fresh search happens to reach first.

## Skills to use

Load these before you start — they carry what this task needs, and reading them beats
rediscovering the same thing from source. Two of them are the very skills this task makes
reachable: until it ships, read them from their paths under `apps/maestro/.claude/skills/`.

- `installing-maestro` — the tree walk that discovers skill ids, and the asset manifest a new project-copied script has to join
- `maestro-architecture` — the SubagentStart injection this changes, and the orchestrator template's managed regions
- `maestro-config-model` — why `skills_available` holds ids and must keep holding ids (`apps/maestro/.claude/skills/maestro-config-model/SKILL.md`)
- `updating-maestro` — the version bump this carries, and which component

## When you're done

Run the project's `default` workflow to completion — its success path is implementation → human
review → **@test** → **@reviewer** → **@scribe**. Do not treat the documentation step as a shortcut
past the two before it. When you reach **@scribe**, load the `scribe` skill: it is the routing rule
for what belongs in a concept skill versus in `docs/`, and it has to be in context before anything
is written.

## Acceptance criteria

- [ ] A skill under a nested `.claude/skills` resolves to its `SKILL.md` path from its recorded id, and a root or plugin skill is reported as loadable by name
- [ ] An id that matches no project skill prints nothing and exits 0, and every caller treats that as an ordinary answer rather than an error
- [ ] The resolver returns the directory the id was recorded from, honouring the existing root-wins collision rule rather than re-searching
- [ ] The subagent-context hook names the path for a nested skill and leaves the wording for a root or plugin skill byte-identical to today
- [ ] The orchestrator's Step 3 resolves a `Skills to use` name the Skill tool rejects, instead of skipping it
- [ ] The instruction says plainly that a path-loaded skill is read as a file, without implying the Skill tool ran
- [ ] A new project-copied script is registered in the install manifest, so an install writes it and an uninstall removes it, on both implementations
- [ ] `plugin.json` is bumped, with the component matching what a consumer sees change
- [ ] Loading this repository's own `global-stores` and `maestro-config-model` from a task file's `Skills to use` list succeeds end to end

## Blocked by

None — can start immediately
