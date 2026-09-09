# Key the agent stores by namespace, not by agent name

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Three global stores key an agent's Maestro metadata on nothing but its name:

```sql
agent_types        (agent_name TEXT PRIMARY KEY, tag)          -- ~/.claude/maestro-agent-types.sqlite
agent_project_tags (agent_name TEXT PRIMARY KEY, project_tag)  -- ~/.claude/maestro-agent-project-tags.sqlite
agent_avatars      (agent_name TEXT PRIMARY KEY, layers)       -- ~/.claude/maestro-avatars.sqlite
```

So two projects that each define their own `.claude/agents/reviewer.md` — different agents, doing
different jobs, that happen to share a name — share one avatar, one type and one project tag. Give
the reviewer a red hat in one project and it turns up wearing it in the other. This is live today,
and it gets much more likely once `029` ships, because forking exists precisely to produce
same-named agents across projects.

The assumption being violated is one the codebase already states. `report-defaults.ts`' header
explains a skill tag is global *"because a skill is the same skill everywhere"* — true of a skill,
true of a `~/.claude/agents/` agent, and exactly false of a project agent, which is one project's
file and nobody else's.

**Fix it by namespacing the key by tier, not by inventing an id.** Agents have no identity beyond
their name and their path, and a synthesised `maestro-id:` in frontmatter is not available: it would
mean writing into files the app does not own, and it cannot work at all for the immutable tiers. So:

- a **project**-tier agent keys on `(projectRoot, agentName)`
- a **user**, **maestro** or **plugin**-tier agent keys on `agentName` alone, because for those the
  global assumption is genuinely true — it is the same agent in every project

That is a keying change, not a data-model change. The read and write functions gain the scope they
should always have had, and the storage finally matches the semantics `029`'s split list makes
visible on screen.

**Leave the report stores alone.** `agent_reports` (agent_name → report_id) and `reports`
(report_id → content + version) *are* the global fallback tier by definition — "what a reviewer
outputs by default on this machine" — and every project already has `.claude/reports/<name>.md` as
its override, resolved by `resolveReport`'s project → global → none order. Rekeying those two would
collapse two tiers into one. Three stores change; the fourth deliberately does not, and the ticket
says so here so that nobody later "finishes the job".

**No migration.** Maestro is not installed anywhere that matters yet, so existing rows may be
dropped outright; a reinstall reseeds them. Do not build a promote-to-global or attribute-to-current
-project path — bump the schema and let the seed-on-first-read discipline both stores already follow
refill them.

## Acceptance criteria

- [ ] `agent-types.ts`, `agent-project-tags.ts` and `avatar-store.ts` key project-tier agents by
      project scope as well as name, and non-project tiers by name alone
- [ ] Two projects with same-named project agents hold independent type, project tag and avatar
      values, proven by a test that writes in one scope and reads the other
- [ ] A `user`/`maestro`/plugin agent still resolves to one shared row from any project
- [ ] `report-defaults.ts`'s two tables are unchanged, and a comment there records that the omission
      is deliberate
- [ ] `agentsForProjectTags` returns agents scoped to the project asking, not every same-named agent
      on the machine
- [ ] `readAllAgentTypes` / `readAllAgentProjectTags` / `readAllAvatars` — the batched reads
      `/agents` and `/templates` fan out on refresh — return the rows for the open project only,
      still in one database open each
- [ ] `/templates` continues to edit the machine-wide tier and is not silently scoped to the open
      project by this change
- [ ] The seed-on-first-read behaviour still produces the seven built-in agents' classifications on
      a fresh machine

## Notes for whoever picks this up

`/templates` and `/agents` write to the same three stores with different intent — `/templates` edits
the global tier for every project, `/agents` edits one agent in the open project. Check both call
sites; scoping the store without scoping the caller is how `/templates` quietly becomes a
project-local editor.

**Staleness check (`029` landed since this page was written):** `029` added a fourth call site —
`copyAgentAttributeRows` in `apps/maestro/src/core/agent-fork.ts`, called by `forkAgent` for a
**renamed** fork. It calls `getAvatar`/`setAvatar`, `readAllAgentTypes`/`setAgentType`, and
`readAllAgentProjectTags`/`setAgentProjectTag` with the same by-name keying those modules use today,
copying the template's row to the new name. Once this ticket scopes those getters/setters by
`(projectRoot, agentName)` for project-tier agents, `copyAgentAttributeRows`'s calls need to move
with them — the fork is always copying *from* a global-tier agent (that's the only thing `forkAgent`
can fork), so the read side stays name-only, but the write lands on a **project**-tier agent (the new
fork), so it needs the fork's own `projectRoot` threaded through. `copyAgentAttributeRows` already
takes an optional `dbPaths` override (added for `029`'s tests); the new project-scope argument is
separate from that. No other part of `029` needs to change — the rest of this page still describes
the code accurately.

## Blocked by

_none_
