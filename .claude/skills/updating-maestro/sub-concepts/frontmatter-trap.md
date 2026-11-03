# The frontmatter trap — an update cannot deliver it, only a purge-and-reinstall can

**`/maestro-update` re-syncs the orchestrator's MANAGED REGIONS. It never rewrites its
frontmatter.** `syncManagedRegions` touches only what is between the `Maestro:*` markers, and
`installOrchestratorSkill` copies the template whole **only when the destination is absent** — and a
plain (non-purging) uninstall keeps `.claude/skills/maestro/SKILL.md`. So anything the template adds
*outside* a region reaches new installs and nothing else.

`032` is the first change where that matters, because the thing outside the region is a **grant**:

```yaml
allowed-tools: Bash(node .claude/scripts/maestro-step1-gates.cjs)
```

An injected command whose permission check answers anything but `allow` **aborts the invocation**.
So on a project installed before `0.4.1`, an ordinary update copies the new script and re-syncs the
new Step 1 into the STEPS region, and `/maestro` then **fails to start** — it does not degrade,
because the frontmatter that permits the command it now contains never arrived.

The fix is one of:

- `/maestro-uninstall --purge`, then reinstall — the thorough option, and it also removes
  `maestro.json`, so only do this where the workflow graph is disposable or committed;
- **delete `.claude/skills/maestro/SKILL.md` and re-install** — the file then counts as absent and
  the template is copied whole, frontmatter included. This is the one to reach for: it costs only
  the customisations kept outside the managed regions in that file.

**`089` repeats it with a second grant.** The template's `allowed-tools` gained
`Bash(node .claude/scripts/maestro-end-skills.cjs)` (originally a braced project-dir form; `101` made it relative) for the new Step 7
`!`-injected end-skills line. An existing project updated normally gets the script, the
`lib/maestro-skill-lists.cjs` bundle and the new STEPS region, but **not** that grant, so the Step 7
injection is not permitted and `/maestro` fails to start. Same remedy: delete
`.claude/skills/maestro/SKILL.md` and re-install.

The template's `allowed-tools` now carries four grants — `maestro-step1-gates.cjs`,
`maestro-end-skills.cjs`, `maestro-resume-target.cjs *` and `maestro-step4-gate.cjs` — and **each**
is outside a managed region, so a project whose frontmatter predates any one of them hits the same
abort or a denied call. Check the project's frontmatter against `templates/maestro/SKILL.md`'s, not
against the two examples above.

Generalise it: **a template change outside a managed region is not deliverable by an update.** If
the change must reach existing projects, either put it inside a region, or say plainly in the ship
notes that it needs the file deleted first. `plugins/maestro/skills/maestro-update/` carries this in
`references/frontmatter-trap.md` (pointed to from a Notes bullet) so a user driving the terminal
path is told the same thing.
