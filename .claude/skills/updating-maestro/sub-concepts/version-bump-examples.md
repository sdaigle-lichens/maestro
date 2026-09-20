# Version bump precedent — the worked examples

The [table in `SKILL.md`](../SKILL.md#which-component-to-bump) says which component to bump. This is
the case law behind it: every bump the repo has argued about, and the reasoning that settled it.
Read it when a change feels like it might be a minor.

**A `feat:` commit is not automatically a minor.** The repo's own history is the guide: `0.2.0` was
new skills, `0.3.0` was new script behaviour plus a new state file — but `0.3.1` (concept-skills
system), `0.3.2` (agent page) and `0.2.1` (a bare re-pull trigger) are all patches, and two of the
three landed under a `feat:` subject. The commit message describes the work; the version component
describes what a *consumer* of the plugin sees change.

## `0.3.3` — hook arbitration — patch

It changed the behaviour of four existing hook scripts and nothing about the surface: same skills,
same agents, same six hook registrations. Patch. It was first shipped as a `0.4.0`-style minor bump,
which is the mistake this file exists to stop repeating. (Unrelated to the real `0.4.0` below, which
earns its minor.)

## `0.3.5` — forked-agent sync (`031`) — patch

The more tempting case. It **added a script** (`scripts/maestro-agent-forks.cjs`) and its generated
lib, rewrote a step in `templates/maestro/SKILL.md` and added a step to `maestro-update`'s. Still a
patch: no new skill, agent, command, or hook event, so there is nothing a consumer can *invoke* that
they could not before — the existing `/maestro` and `/maestro-update` skills simply do more. **A new
file under `scripts/` is not a published surface; a new directory under `skills/` or `agents/` is.**

## `0.4.0` — Step 0 as a hook — the first legitimate minor

Worth keeping beside the patches. Almost everything in it would have been a patch alone: a new
script under `scripts/` (`maestro-step0.js` — explicitly not a surface, per `0.3.5`), a
`hook-arbitration.ts` bug fix, deleted template prose, and a second registration on `PreToolUse`, an
event the plugin already registered. **One thing carried the bump**: `hooks/hooks.json` gained a
top-level `UserPromptExpansion` key it had never had, and `install.ts`'s `HookEvent` union gained
the matching member. A hook event the plugin did not previously register is a new published
surface — the harness now calls the plugin at a moment it never used to. That is the minor row's "a
hook registered on a new event", and nothing else in the change comes near it.

## `0.4.1` — optional Step 1 gates (`032`) — patch

The case where the table was applied **against** the ticket that specified the bump. That page said
`0.5.0`, minor, on the reasoning "the published surface grows by a script". Measured against this
table and against `0.3.5`, that does not hold: a new file under `scripts/` is explicitly *not* a
published surface, `hooks/hooks.json` is untouched, and no skill, agent or command was added or
renamed. Everything else in it is a patch by the same precedent — a rewritten step inside
`templates/maestro/SKILL.md`'s managed region, a new check in `maestro-check-runtime.cjs`, an
additive optional `maestro.json` field. A consumer gains nothing they can *invoke*; `/maestro`
simply does less by default. So it shipped as `0.4.1`.

The tempting argument for a minor, and why it fails: the frontmatter grew an `allowed-tools` grant,
so the harness now runs a command it never used to at `/maestro` expansion. That is inside an
existing skill's own body, which `0.3.5` already settled as a patch; `0.4.0`'s minor turned on
`hooks.json` gaining a top-level event key, and nothing in `032` touches it. **The delivery
consequence of the patch is nil** — autoUpdate compares for inequality only — but the
[frontmatter trap](frontmatter-trap.md) is a real one, and it is orthogonal to the component chosen.

## `0.4.2` — customizable handoff templates (`033`) — patch

The first one where the published surface **shrank**: all 23 files under
`plugins/maestro/templates/handoffs/` were deleted, and `handoffAssets()` with them. Still a patch,
and the table says why on its own terms — a *published surface* is a skill, agent, command or hook
event, and `templates/` is none of those, so removing files from it is no more a major than adding a
script was a minor in `0.3.5`. The seed bodies did not go away; they moved into `SEED_HANDOFFS` and
ship inside `lib/maestro-session.cjs`. The delivery consequence, though, is the largest of any patch
so far: **the asset manifest lost ~23 entries, so `shippedRuntimeId` moved and every installed
project reports stale exactly once** — and the files an old project already has under
`.claude/templates/handoffs/` are removed only by an uninstall, whose sweep of that directory now
exists solely for them.

## `0.4.3` — the app's handoff editing surfaces (`034`) — patch

The least interesting on purpose. Nothing under `plugins/maestro/` changed except one branch inside
`scripts/maestro-install.js`: the terminal `syncProjectHandoffs()` now clears a `syncedFrom` left
pointing at a global row somebody deleted, mirroring `handoff-sync.ts`. No skill, agent, command or
hook event moved, and the asset manifest is untouched — so a **patch**, even though the commit is a
`feat:` and almost all of its diff is in `apps/maestro`. The rule the example illustrates: the bump
tracks what a *consumer of the plugin* sees change, not the size of the session's diff. It shipped
because the two implementations must agree, and an unbumped script change reaches nobody.

## `0.4.4` — the two sqlite libs a project's own hook needs (`035`) — patch

Settles "a new **copied** file is not a published surface either". It added two entries to
`STATIC_ASSETS` in both implementations (`lib/maestro-report-defaults.cjs`,
`lib/maestro-handoff-defaults.cjs`) so a project-local `maestro-inject-agent-context` can reach the
global report and handoff tiers at all. No skill, agent, command or hook event moved, and the libs
themselves already shipped inside the plugin — all that changed is where they get copied to.
**Patch**, under another `feat:` subject, by the same rule as `0.3.5`. Here the delivery consequence
is the part to plan for rather than the component: the asset manifest grew, so `shippedRuntimeId`
moved and **every installed project reports stale exactly once** — and until it re-installs, its own
copy of the hook goes on silently resolving nothing for an agent whose report is only global.

## `0.5.0` — `code-architecture-design` — the textbook minor

A new directory under `plugins/maestro/skills/`, which is the minor row's own wording. Nothing else
in the change argues for it — the rewiring of `use-code-architecture-design-check` and
`to-maestro-tasks` is prose inside existing skill bodies (`0.3.5`'s patch rule), and the gate-key
rename is script behaviour (`0.4.3`'s). It subsumes the `0.4.10` those would have shipped as on their
own; **a minor and the patch it swallows are one bump, not two.**

The tempting argument for a **major**, and why it fails: the table's major row says "a skill removed
or renamed", and `use-design-check` was renamed out of existence. But the row's test is the
consequence beside it — someone's `/command` stops resolving — and that skill is
`user-invocable: false`, so no user ever typed it. What does break is a *config* that names it: an
existing `maestro.json` keeps `skill:use-design-check` in its Refactor workflow and a
`gates.use_design_check` key, neither migrated. Judge the row by its consequence column, then say the
un-migrated part out loud in the release note — the bump component cannot carry that warning for you.

## `0.5.2` — the Step 4 task-routing gate (`046`) — patch

The same shape as `0.4.1`: a new `STATIC_ASSETS` entry (`maestro-step4-gate.cjs`, mirroring
`maestro-step1-gates.cjs`'s contract) and an additive optional `maestro.json` field
(`use_maestro_tasks`), not a published surface.

## `0.5.3` — auto-enabling task routing (`047`) — patch

The same shape as `0.4.0`'s two registrations rather than `0.4.0`'s own bump reason: a new
`HOOK_SCRIPTS` entry (`maestro-enable-task-routing`, the writer `0.5.2` left unbuilt) registered on
`UserPromptExpansion` and `PreToolUse` — **events the plugin already registers**, just a new matcher
on the first and a second command sharing an existing matcher block on the second. `0.4.0` earned its
minor because it added `UserPromptExpansion` as a **top-level key** `hooks.json` had never had; here
that key, and the `PreToolUse`/`Skill` matcher, already exist. No skill, agent, or command added or
renamed.

## `0.5.4` — the Step 4 post-mortem prompt (`049`) — patch

The plainest patch of the set: no new file at all, on either side of the manifest. The whole change
is two sentences of static template prose added inside the `Maestro:STEPS` region of
`templates/maestro/SKILL.md`, which every install/update already re-syncs — no script, no
`maestro.json` field, no skill, agent, command or hook event. It sits right beside `046`'s
task-routing line in Step 4 but shares none of its shape: that one is a `STATIC_ASSETS` entry
injected via `!`-prefixed command injection; this one is prose the model reads directly, gated on the
session's own judgement rather than a config field. Patch, by the table's plainest row: a behaviour
change to an existing template.
