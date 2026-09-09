---
name: agent-fork-sync
description: "Explains how a project-local copy of a global template is kept in step with it: the one shared fs-free decision function (sync-decision.ts) that its three callers — the report sync, the forked-agent sync and (since 033) the handoff sync — all call so they can never drift, why a plugin-tier fork is checked by VERSION STRING while a user-tier one is checked by content hash, what the agent-forks.json provenance record holds and what detaching removes, why computing the summary writes nothing, and the two surfaces (the /agents review card, and the terminal side — the maestro-step0 hook plus /maestro-update's CLI) that must always reach the same verdict. Use when changing report-sync.ts, agent-sync.ts or handoff-sync.ts, adding a fourth caller of decideSync, wondering why a forked agent is or isn't reported as behind its template, why a plugin edit reports 'no update available', why a fork's description never counts as a change, or why the terminal and the app disagree (they shouldn't — that's a bug in one of them)."
metadata:
  type: concept-skill
  version: "1.6"
  last-update: d50a9830adcb15f7d6a8e8493264149a3ca96d43
---

# Keeping a copy in step with the thing it was copied from

Two things in this repo are a **project-local copy of a moving global template**:

- a **report** — `.claude/reports/<agent>.md`, copied from the global report-defaults store;
- a **forked agent** — `.claude/agents/<name>.md`, copied from a `user`- or plugin-tier agent by
  `/agents`' "Fork into this project" (`029`), with its provenance recorded in a sidecar.

They look nothing alike and they age identically. Both can be untouched-and-behind, both can be
edited-by-the-user, both can have had their template deleted out from under them, and in every one
of those states the right answer is the same. That answer is written down **once**, in
`src/core/sync-decision.ts`, and this skill exists to keep it that way.

```
              ┌──────────────────────────────────────────────┐
              │  sync-decision.ts  ·  decideSync()           │   pure. no fs. knows nothing
              │  detached / no-template / materialize /      │   about reports, handoffs
              │  refresh / stale-customized / unchanged      │   or agents.
              └──┬───────────────────┬─────────────────────┬─┘
                 │                   │                     │
        ┌────────┴────────┐ ┌────────┴────────┐ ┌──────────┴───────────────────┐
        │ report-sync.ts  │ │ handoff-sync.ts │ │ agent-sync.ts                │
        │ per AGENT       │ │ per ROUTE PAIR  │ │ per FORKED AGENT             │
        │ hash: whole file│ │ hash: whole file│ │ hash: hashAgentBody (body)   │
        │ moved: version >│ │ moved: version >│ │ moved: version+body  (plugin)│
        │        (integer)│ │        (integer)│ │        hash    !==  (user)   │
        │ WRITES on inst. │ │ WRITES on inst. │ │ WRITES NOTHING (read-only)   │
        └─────────────────┘ └─────────────────┘ └───┬──────────────────────┬───┘
                                                    │                      │
                                            /agents review card    maestro-step0.js (hook)
                                            (+ /maestro count)     maestro-agent-forks.cjs
                                                                   (maestro-update)
```

**Why one function and not two implementations that agree today.** `resolveReport` makes the same
argument for the hook and the app: the failure mode is not a wrong answer, it is *two* answers, each
correct for the surface that produced it, diverging silently over a year. `031` lifted these five
branches out of `report-sync.ts` rather than paraphrasing them, and the branch order was preserved
exactly — the report sync's tests passed unmodified, which is the evidence that nothing moved.

## The five branches

Read them in `sync-decision.ts`; the order is load-bearing and stated here because getting it
subtly wrong is invisible.

| Verdict | When | Note |
| --- | --- | --- |
| `detached` | The tracking record says the user owns this outright | Checked **first**, so it outranks every other consideration. Never compared, never touched, never reported. |
| `no-template` | Nothing to sync *from* | Answered before anything is compared. |
| `materialize` | No project copy on disk | |
| `unchanged` (untracked) | A file sits where the copy would go with nothing tracking it | Left alone — overwriting an unrelated file would be a surprise. |
| `stale-customized` | The local hash ≠ what was recorded | **Decided before `templateAdvanced` is consulted.** The user's edit outranks whether an update exists. |
| `refresh` / `unchanged` | Untouched, and the template did / did not move | |

The two things that genuinely differ between callers arrive **already answered**, as
`localHash` and `templateAdvanced`. Adding a caller means answering those two questions for it —
not adding a branch here. `033` proved the cost: `handoff-sync.ts` became the **third** caller and
reused both of `report-sync.ts`'s answers verbatim, so it added no branch and no test to
`sync-decision.test.ts`. Only its candidate set is new (see the shared-decision table).

See [the shared decision](sub-concepts/the-shared-decision.md) for the full table and what each
caller passes.

## The two triggers, and why they are not the same question

This is the part that looks like an inconsistency and is not:

- **Plugin tier → the `version` STRING must differ AND the body hash must differ.** Both halves,
  and each rules out the opposite mistake:
  - The **version** half is what makes the check *necessary*. A plugin's files come from a
    per-VERSION marketplace cache that `autoUpdate` re-pulls only when `plugin.json`'s `version`
    changes (see `updating-maestro` (at the repo root `.claude/skills`)), so a plugin agent's
    content *cannot* reach a machine without a bump. An edit shipped without one has reached
    nobody: *no update available* is the correct answer, not a missed one, and reporting otherwise
    would promise a refresh no delivery path can deliver.
  - The **body** half is what makes it *sufficient*. A bump says the PLUGIN moved, not that this
    agent did — and this repo bumps `plugin.json` for every change under `plugins/`, almost none of
    which touch `agents/`. On the version alone, every release lit the `/maestro` banner for every
    fork on the machine and sent the user to a review card that then told them *the body is
    identical to the template's*.

  Both directions are pinned by a test.
- **`user` tier → compare template content hashes alone.** `~/.claude/agents/*.md` are hand-edited
  files with no version anywhere. Nothing but the bytes can notice.

`report-sync.ts` is a third answer to the same question: the global store's integer `version`, with
`>` rather than `!==`, because that number only ever goes up. `handoff-sync.ts` uses that same
answer against `maestro-handoff-defaults.sqlite`, so there are three definitions of "the template
moved", not four.

## The description does not track — and neither does the name

`hashAgentBody` (in `agent-fork-record.ts`) hashes the file with its `name:` and `description:`
frontmatter lines — and any continuation lines under them — normalised out. Both are **expected** to
diverge, and that is the whole reason forking is worth doing:

- the `description:` is the one field `/agents` lets you edit after forking a global agent (`029`);
- the `name:` is rewritten by `forkAgent` itself on a **renamed** fork.

Hashing either puts a fork permanently in `stale-customized` and the refresh branch then never fires
for it. `029` normalised out only the description and shipped exactly that bug for renamed forks;
`031` fixed it, and both halves are pinned by tests. If you touch this function, that is the failure
to write a test against.

`mergeForkBody` is its exact inverse: **the two fields that hash out are the two fields that carry
over** on an update, verbatim rather than re-quoted. `hashAgentBody(mergeForkBody(t, f)) ===
hashAgentBody(t)` is a tested property, and it is why an update leaves a fork genuinely in step.

## Computing writes nothing. Applying writes one agent.

`computeAgentSync` runs on **project selection** (`InstallProvider`), from the `maestro-step0` hook,
and from `/maestro-update`. It stats and reads and writes nothing at all — no file, no sidecar, no directory. Those
`.claude/agents/*.md` are usually committed, and a diff nobody asked for is hard to explain. A test
asserts it on mtimes *and* bytes across two consecutive calls.

`applyAgentSync(projectRoot, agentName, action)` is the only writer, one agent per explicit answer:

- **`update`** — `mergeForkBody`, then a rename back to the fork's own name, then re-stamp
  `pluginVersion` / `templateBodyHash` / `templateBody` and clear `acknowledgedFrom`.
- **`keep`** — writes only `acknowledgedFrom`, which is what makes "ask me again next version" true
  instead of re-raising the same diff on every launch.
- **`detach`** — deletes the provenance record and touches no file. The agent becomes `decideSync`'s
  `detached` verdict, arrived at by the user.

## Forking has two entry points now, one mechanism (`041`)

`forkAgent` itself is unchanged, and neither is anything in this skill's decision function — a
renamed fork writes the same provenance record and hashes the same way regardless of who called it.
What's new is a **second UI call site**: `/workflows`' `InstancePicker`, from the all-placed dead
end (a workflow can't place two instances on one bare agent), alongside `/agents`' "Fork into this
project". Both go through the identical `forkAgent(...)` → `agent-forks.json` path this skill
describes; see `agents-view` and `workflow-view` for what each caller does with the result.

## Traps

- **`summary.diverged` is not `refreshed + staleCustomized`.** Because `stale-customized` is decided
  before `templateAdvanced`, counting every customized fork would leave `/maestro`'s count lit
  forever for any fork anyone ever edited. `diverged` is `refresh` ∪ (`stale-customized` **and**
  `templateAdvanced`) — an update exists that cannot be applied automatically.
- **`materialized` means something else on the agent side.** Nothing is ever materialized there; the
  bucket holds forks whose own `.md` has gone missing while the record remains. The whole summary's
  past tense is aspirational for agents: `refreshed` means "would refresh if asked".
- **Template resolution must not go through `findAgentFile`.** It resolves in `discoverAgents`' tier
  order and hands back the fork itself — a same-name fork shadows its own template by design.
  `agent-sync.ts` consults only the tier the record names, and recovers the *template's* name from
  `record.templateBody`'s frontmatter, since a renamed fork is keyed by its own name.
- **An agent with no record is invisible here, and that is the feature.** Hand-authored project
  agents and detached forks are the project's own answer. There is no scan that could recover what
  an unrecorded fork came from, which is why `forkAgent` writes the sidecar unconditionally.
- **`agent-fork.ts` and `agent-fork-record.ts` are split for a reason that is not tidiness.**
  `copyAgentAttributeRows` writes three sqlite stores, so `agent-fork.ts` transitively imports
  `node:sqlite`; the generated bundle the skills call must run under a bare `node` that may predate
  it. `grep -c "node:sqlite"` on `plugins/maestro/scripts/lib/maestro-agent-sync.cjs` must stay `0`.
- **The two surfaces reaching different verdicts is a bug in one of them, never a difference of
  opinion.** They run the same compiled code over the same files. See
  [the two surfaces](sub-concepts/the-two-surfaces.md).

## Files

| File | Role |
| --- | --- |
| `apps/maestro/src/core/sync-decision.ts` | `decideSync` — the one rule. Pure, no `fs`. |
| `apps/maestro/src/core/report-sync.ts` | Caller 1: reports, on install/update. Writes. |
| `apps/maestro/src/core/agent-sync.ts` | Caller 2: forked agents. `computeAgentSync` reads, `applyAgentSync` writes. |
| `apps/maestro/src/core/handoff-sync.ts` | Caller 3 (`033`): handoff protocols, on install/update. Writes. Candidates come from the workflow graph, not from a list of agents. |
| `apps/maestro/src/core/agent-fork-record.ts` | The `agent-forks.json` sidecar, `hashAgentBody`, `mergeForkBody`, `renameAgentInFrontmatter`. No sqlite. |
| `apps/maestro/src/core/agent-fork.ts` | `forkAgent` + `copyAgentAttributeRows`; re-exports the above. |
| `apps/maestro/src/core/diff.ts` | The line diff both surfaces render. Pure. |
| `apps/maestro/src/core/plugin-entries/maestro-agent-sync.ts` | Bundle entry → `plugins/maestro/scripts/lib/maestro-agent-sync.cjs`. |
| `plugins/maestro/scripts/maestro-agent-forks.cjs` | The CLI: `list` / `diff` / `update` / `keep` / `detach`. Driven by `/maestro-update`. |
| `plugins/maestro/scripts/maestro-step0.js` | The readiness hook. Calls `computeAgentSync` from the bundle directly — no CLI spawn; read-only, never blocks, speaks only when something diverged. |
| `apps/maestro/test/core/sync-decision.test.ts` | The branch table, incl. the two ordering guarantees. |
| `apps/maestro/test/core/agent-sync.test.ts` | One case per `031` acceptance criterion. |
| `apps/maestro/test/core/diff.test.ts` | The diff and its elision. |

## Relationships

- [`agents-view`](../agents-view/SKILL.md) — the review card, the diverged banner, and why the block
  renders below the card rather than inside it.
- [`global-stores`](../global-stores/SKILL.md) — `copyAgentAttributeRows`, the fourth writer of three
  of those stores, and the sqlite dependency this concept's bundle must avoid.
- [`plugin-libs-parity`](../plugin-libs-parity/SKILL.md) — how `agent-sync.ts` reaches the CLI.
- `updating-maestro` (repo root) — why a version-string comparison is the correct trigger for a
  plugin-tier fork, and why the fork check itself reaches installed projects only on a re-pull.
- `installing-maestro` (repo root) — the two runtime assets `031` added to the copied manifest.

## Sub-concepts

- [The shared decision](sub-concepts/the-shared-decision.md) — the five branches, what each caller
  passes, and the rule for adding a third.
- [The fork record](sub-concepts/the-fork-record.md) — `agent-forks.json`, the hashing
  normalisation, and what `keep` and `detach` actually write.
- [The two surfaces](sub-concepts/the-two-surfaces.md) — the app and the CLI, and why neither may
  grow its own copy of the rule.
