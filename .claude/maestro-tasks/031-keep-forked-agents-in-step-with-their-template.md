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

- [x] `report-sync.ts`'s materialize / refresh / skip-as-customized / never-touched decision lives
      in one shared, `fs`-free function, and both the report path and the agent path call it —
      `src/core/sync-decision.ts` (`decideSync`, branch order lifted verbatim); `report-sync.ts` and
      `agent-sync.ts` are its only importers
- [x] The existing report sync behaviour is unchanged — its tests pass without modification —
      `test/core/report-defaults.test.ts` and `reports.test.ts`, 26 tests, untouched, green
- [x] A forked agent whose body is untouched and whose template version advanced is reported as
      refreshable, and taking the refresh replaces the body while leaving the description exactly as
      the user wrote it — unit test, plus a live Electron window: the file afterwards kept
      `description: My own words — the strict one, and it reviews requirements too.` and gained
      `- check requirement coverage`
- [x] A forked agent whose body the user edited is reported as stale-but-customized and is never
      overwritten — unit test asserts bytes unchanged; the window probe confirmed one Update click
      writes nothing (see divergence 6 for the deliberate second-click escape hatch)
- [x] A detached agent (no provenance record) is never reported and never touched — unit test:
      `entries: []` for an agent with no record
- [x] Plugin-tier forks are checked by plugin version; user-tier forks are checked by template
      content hash — two unit tests, plus a live CLI run against a fake `$HOME`
- [x] Selecting a project computes the summary and writes nothing to `.claude/agents/`, proven by a
      test asserting no file mtime changes — `"writes NOTHING when computing the summary"` compares
      `mtimeMs` **and** bytes across two `computeAgentSync` calls and asserts no new directory entries
- [x] `/maestro` shows the count of diverged forks and links to the per-agent review — window probe:
      `data-count="1"`, text `"1 forked agent differs from its template — reviewer…"`, and an
      `a[href*="/agents"]`
- [x] The review action offers update / keep as fork / detach, and detach removes only the
      provenance record — window probe read the three button labels; after Detach the `.md` was
      byte-identical and `agent-forks.json` had lost only that key
- [x] The `maestro` and `maestro-update` skills print the same diff and reach the same verdict as the
      app for the same project state — the CLI and the app ran against one fixture and both reported
      `reviewer: update available from probe-plugin 0.5.0 (tracking 0.4.0)`, verdict `refresh`, same
      diff line
- [x] A plugin change shipped without a `plugin.json` version bump is correctly reported as *no
      update available*, matching how delivery actually works — unit test: body moved, version did
      not → `refreshed: []`, `unchanged: ["reviewer"]`, `templateAdvanced: false`

Window probes ran against the packaged build (`pnpm --filter maestro build`, then `electron .`) with
a fixture project and a fake `$HOME` in the scratchpad; both exited PASS with zero console errors,
and the fixture was deleted afterwards. Full suite: 758 tests, 42 files, green.

## Notes for whoever picks this up

Read `.claude/skills/maestro-architecture/` and the `updating-maestro` skill before touching the
skill-side half — the per-VERSION cache is the reason version comparison is sufficient here, and it
is also the reason a change to those skills does not reach installed projects until
`plugins/maestro/.claude-plugin/plugin.json` is bumped.

Landing `030` first is recommended. It is not a hard dependency — this ticket's state lives in the
fork sidecar, not in the sqlite stores — but building conflict UI for same-named agents across
projects while those agents still share one avatar row will be confusing to test.

**What `029` actually landed (read this before the sync logic above):**

- Read the sidecar via `readAgentForks(projectRoot)` / `agentForksPath(projectRoot)`, exported from
  `apps/maestro/src/core/agent-fork.ts` and re-exported off `src/core/index.ts`. It is
  `<projectRoot>/.claude/agent-forks.json`, a flat JSON object keyed by the forked agent's name —
  this page's "fork sidecar" is that file.
- `AgentForkRecord`'s tier field is **`sourceTier: "user" | "plugin"`**, not the raw
  `DiscoveredDefinition.source` string this page's acceptance criteria describe in prose ("Plugin-tier
  forks are checked by plugin version; user-tier forks are checked by template content hash" —
  that wording already matches the landed shape). `"maestro"` (this repo's own bundled copy) and any
  real installed plugin both land in tier `"plugin"`, with `sourcePlugin` naming which one (`"maestro"`
  or the plugin's name) and `pluginVersion` set from it. `sourceTier: "user"` always carries
  `sourcePlugin: null` and `pluginVersion: null`.
- Compare a fresh `hashAgentBody(currentTemplateContents)` against the stored `templateBodyHash` — the
  description-line-and-continuation normalization this ticket's body-only-hash requirement depends on
  is already implemented in `bodyForHashing`/`hashAgentBody` and tested in `test/core/agent-fork.test.ts`.
- **Only `forkAgent`-created agents get a sidecar entry.** `/create-subagent`'s "Start from a
  template" field (also from `029`) is a plain form seed — `mode: "manual"` plus `name`/`description`
  copied from a `DiscoveredDefinition` into a fresh skeleton — and writes no provenance record at all.
  If this ticket's sync is meant to also cover agents created that way, that needs a different
  detection path; as landed, there is nothing there to read.

## Blocked by

- `029-make-project-the-only-editable-agent-tier.md`

## Divergences from this page

1. **`bodyForHashing` now strips the `name:` line too, not just `description:`.** This page said
   "`029` already establishes the body-only hash; this ticket depends on it being right." It was not
   right. `forkAgent` rewrites exactly the `name:` line on a renamed fork, so
   `hashAgentBody(fork) !== record.templateBodyHash` **from birth**, and every renamed fork would
   have sat permanently in `staleCustomized` with the refresh branch never firing for it — the
   precise failure the description-stripping exists to prevent, one field over. Fixed in
   `agent-fork-record.ts`, pinned by `"strips the name line too, so a RENAMED fork is not modified
   from birth (031)"` (`agent-fork.test.ts`) and `"tracks a RENAMED fork without calling it
   modified"` (`agent-sync.test.ts`). **`029`'s page has been corrected**, since its Notes section
   described the normalisation as description-only.
2. **`AgentForkRecord` gained an optional `acknowledgedFrom` field.** This page asks that "keep as
   fork" mean "leave it, stay tracked, ask again next version". With nothing recorded, the same diff
   re-raises on every launch and keeping is not a choice at all. `acknowledgedFrom` stores the
   `{ pluginVersion, templateBodyHash }` that was declined; `templateAdvanced` compares against it
   when set and against the fork baseline otherwise. Optional and backwards-compatible — pre-`031`
   records read fine.
3. **The summary is `ReportSyncSummary`'s four buckets plus two fields.** This page asked for "a
   summary in the shape `ReportSyncSummary` already uses". The review UI additionally needs per-agent
   detail (diff, both descriptions, tier, versions) and the headline needs a count, so
   `AgentSyncSummary` adds `diverged: string[]` and `entries: AgentSyncEntry[]`. The past tense is
   aspirational on the agent side: `refreshed` means "would refresh if asked", and
   `computeAgentSync` never writes.
4. **`materialized` means something different for agents.** Nothing is materialized. The bucket holds
   forks whose own `.md` has gone missing while the provenance record remains.
5. **The headline count is NOT `refreshed + staleCustomized`.** `decideSync` answers
   `stale-customized` *before* it looks at whether the template moved, so counting all of them would
   leave `/maestro`'s badge lit forever for any fork the user has ever edited. `summary.diverged` is
   `refresh` ∪ (`stale-customized` **and** `templateAdvanced`) — an update exists that cannot be
   applied automatically. `AgentSyncEntry.templateAdvanced` is carried for exactly this. A customized
   fork on an unchanged template is reported in `staleCustomized` but not counted.
6. **Update IS offered for a stale-customized fork, behind a two-click confirmation** ("Take the new
   body…" → "Discard my edits and take it"). The criterion "never overwritten" is preserved for the
   AUTOMATIC path — `computeAgentSync` writes nothing, ever — but a user who has read the diff and
   pressed twice is being asked, and refusing them the update outright would leave no route to take
   it. Verified in a window: the first click writes nothing.
7. **`agent-fork.ts` was split into `agent-fork.ts` + `agent-fork-record.ts`.** Not cosmetic:
   `copyAgentAttributeRows` writes three sqlite stores, so `agent-fork.ts` transitively imports
   `node:sqlite`, and the generated `lib/maestro-agent-sync.cjs` must run under a bare `node` that
   may predate it (the constraint `maestro-skill-tags.cjs` already lives with). Verified:
   `grep -c "node:sqlite"` on the generated bundle is **0**. `agent-fork.ts` re-exports the record
   module, so every existing import still resolves.
8. **The review UI renders BELOW the card, not inside `AgentCard`.** `CARD_MIN_HEIGHT` is a measured
   constant keeping the card the same height in view and edit mode; a conditional diff block inside
   would make that height vary by agent and by template state. `CARD_MIN_HEIGHT` was not re-measured
   and did not need to be — no edit-mode card content changed. The review is also hidden while
   editing.
9. **Two new files are copied into every project** (`.claude/scripts/maestro-agent-forks.cjs` and
   `.claude/scripts/lib/maestro-agent-sync.cjs`), so the install manifest grew and
   `installedRuntimeId`/`shippedRuntimeId` changed. Every installed project reports stale once and
   re-copies. That is the intended delivery path, not a regression.
10. **The orchestrator's Step 0 is a MANAGED region**, so the new fork check reaches installed
    projects only via `/maestro-update` (or an app save) after the `0.3.5` re-pull. The version trap
    working as designed.

Plugin version: `0.3.4` → **`0.3.5`**, a patch. New scripts and new behaviour in existing skills, but
no new skill, agent, command or hook event — the published surface did not grow. See the
`updating-maestro` skill's table and its `0.3.5` worked example.

## Downstream tasks

There is no `032`, and nothing else in `.claude/maestro-tasks/` is blocked by this file — so **no
downstream task page needed correcting**. `029`'s page was corrected for divergence 1 (see above);
`030`'s page says nothing about `bodyForHashing` or `AgentForkRecord` and was left alone.
