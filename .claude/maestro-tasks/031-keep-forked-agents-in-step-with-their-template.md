# Keep forked agents in step with their template

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`029` makes a forked agent a project-local copy of a global one, and records where it came from. A
copy goes stale: the plugin ships a better reviewer, and every project that forked it keeps running
last year's version with no sign anything moved.

**Start from `report-sync.ts`, do not write a second one.** This repo already solves this exact
problem for reports, and its header states the rules:

```
- no project file at the mapped id             -> materialize (copy the global default in)
- project file present, unmodified since sync,
  global version advanced past `syncedFrom`    -> refresh (overwrite, bump syncedFrom)
- project file present, hash != syncedFrom.hash -> the user edited it: skip, flag as
                                                    stale-but-customized
- a hand-authored override (no `syncedFrom`)   -> never touched
```

`MaestroReportEntry.syncedFrom` is `{ version: number; hash: string }`, and "detach" is already
modelled as dropping that field — `saveProjectReportOverride` drops it because "a hand-authored save
is no longer tracking a moving global default, it IS the project's answer now". That is precisely
the fork/detach distinction, already built. Lift the decision function out into something both
callers share, the way `resolveReport` is shared between the hook and the app so the two "must never
be able to disagree". A parallel implementation that drifts from `report-sync.ts` is the failure
this ticket exists to avoid.

Three things differ once the same rules are applied to agents.

**The description does not track.** Reports sync content wholesale; a forked agent syncs its *body*
while its description stays the user's. That is what makes forking worth doing, and it means the
staleness hash must cover the body only. A whole-file hash marks every fork as user-modified the
instant its description is edited, and the refresh branch would then never fire for anyone. `029`
already establishes the body-only hash; this ticket depends on it being right.

**The two global tiers need different triggers.** Per the `updating-maestro` skill, a plugin's files
come from a per-VERSION marketplace cache that `autoUpdate` re-pulls only when `plugin.json`'s
`version` changes — so a plugin agent's content *cannot* change without a version bump, and
comparing versions is sufficient, exactly as `report-sync` compares the global store's integer
`version`. The `user` tier has no version at all: `~/.claude/agents/*.md` are hand-edited files, so
those forks need the template content hashed on both sides. Two triggers, one merge rule.

**Nothing writes without being asked.** Compute status on app launch and surface it; do not rewrite
agent files. Those files may be committed, and a diff nobody asked for is hard to explain. Concretely:

- **On project selection**, compute a summary in the shape `ReportSyncSummary` already uses
  (`materialized` / `refreshed` / `staleCustomized` / `unchanged`) and keep it read-only.
- **On `/maestro`**, show the count — "3 forked agents differ from their template" — as the entry
  point, not a modal.
- **In the app**, an explicit review action per agent: show the diff, then offer *update* (take the
  new body, keep my description), *keep as fork* (leave it, stay tracked, ask again next version),
  or *detach* (drop the provenance record; it is just a project agent now).
- **In the `maestro` / `maestro-update` skills**, print the same diff to the console and ask there.
  Both paths read one shared decision function, so the terminal and the app cannot disagree about
  whether a fork is stale.

Show the description next to the body diff in the review UI. When the body advances and the
description stays put, the two can drift — the description promising something the new body no
longer does. Not a blocker, but the user can only notice it if both are on screen.

## Acceptance criteria

- [ ] `report-sync.ts`'s materialize / refresh / skip-as-customized / never-touched decision lives
      in one shared, `fs`-free function, and both the report path and the agent path call it
- [ ] The existing report sync behaviour is unchanged — its tests pass without modification
- [ ] A forked agent whose body is untouched and whose template version advanced is reported as
      refreshable, and taking the refresh replaces the body while leaving the description exactly as
      the user wrote it
- [ ] A forked agent whose body the user edited is reported as stale-but-customized and is never
      overwritten
- [ ] A detached agent (no provenance record) is never reported and never touched
- [ ] Plugin-tier forks are checked by plugin version; user-tier forks are checked by template
      content hash
- [ ] Selecting a project computes the summary and writes nothing to `.claude/agents/`, proven by a
      test asserting no file mtime changes
- [ ] `/maestro` shows the count of diverged forks and links to the per-agent review
- [ ] The review action offers update / keep as fork / detach, and detach removes only the
      provenance record
- [ ] The `maestro` and `maestro-update` skills print the same diff and reach the same verdict as the
      app for the same project state
- [ ] A plugin change shipped without a `plugin.json` version bump is correctly reported as *no
      update available*, matching how delivery actually works

## Notes for whoever picks this up

Read `.claude/skills/maestro-architecture/` and the `updating-maestro` skill before touching the
skill-side half — the per-VERSION cache is the reason version comparison is sufficient here, and it
is also the reason a change to those skills does not reach installed projects until
`plugins/maestro/.claude-plugin/plugin.json` is bumped.

Landing `030` first is recommended. It is not a hard dependency — this ticket's state lives in the
fork sidecar, not in the sqlite stores — but building conflict UI for same-named agents across
projects while those agents still share one avatar row will be confusing to test.

## Blocked by

- `029-make-project-the-only-editable-agent-tier.md`
