# Make the orchestrator's Step 1 gates optional

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`plugins/maestro/templates/maestro/SKILL.md`'s **Step 1 — Custom Checks** is unconditional. Every
`/maestro` run, on every project, is told to run `/confidence-check` and `/use-design-check` before
it may classify the request. On a small or well-understood task that is two skill invocations of
pure overhead, and there is no way to turn either off: the step lives inside the `Maestro:STEPS`
managed region, so hand-editing an installed `SKILL.md` is undone by the next `/maestro-update`.

Make the two gates a **per-project setting** — two checkboxes on the desktop app's `/maestro` page,
persisted in `.claude/maestro.json`, read at invocation time by a small runtime script whose one
line of output is injected into the skill body through Claude Code's
[`` !`command` `` dynamic-context syntax](https://code.claude.com/docs/en/skills#inject-dynamic-context).

All four combinations are valid and none is nested under another:

| confidence | design | Step 1 does |
| --- | --- | --- |
| ✓ | ✓ | `/confidence-check`, then `/use-design-check` |
| ✓ | ✗ | `/confidence-check` only |
| ✗ | ✓ | `/use-design-check` directly |
| ✗ | ✗ | nothing — go straight to Step 2 |

### The settled decisions

These were decided when this page was written. They are not open questions; changing one is a
conversation with the user, not a judgement call during implementation.

- **A seeded `maestro.json` gets both gates `false`.** Opt in, not opt out.
- **An absent, partial or corrupt `gates` field resolves to `false` per field** — i.e. skip. Not
  "preserve the historical behaviour"; skip.
- **No migration.** Same stance as `030`: Maestro is not installed anywhere that matters, so an
  existing project is expected to uninstall and reinstall. Do not build a config-upgrade path.
- **The injected command is permitted by `allowed-tools` in the template's frontmatter**, not by a
  `permissions.allow` entry in the project's `.claude/settings.json`. See the notes at the bottom
  for why, and for the one consequence that bites.
- ~~**The Step 1 prose stays in the template's `STEPS` region.** The script prints a single directive
  line and nothing else.~~ **Reversed with the user after implementation — see divergence 4.** The
  script now prints the whole of Step 1 and the template holds only "do what the line says" plus the
  line-never-arrived fallback.

### Config model

`apps/maestro/src/core/types.ts`:

```ts
export interface MaestroGates {
  confidence_check: boolean;
  use_design_check: boolean;
}

export interface MaestroGatesSlice {
  gates: MaestroGates;
}
```

plus `gates?: MaestroGates` on `MaestroConfigV3`, doc-commented: absent means both gates are off and
Step 1 is skipped entirely.

`apps/maestro/src/core/config.ts`:

- Add `| { sliceType: "gates"; slice: MaestroGatesSlice }` to `ConfigSlice`.
- In `mergeSlice`, **turn the current `else` catch-all into an explicit
  `else if (input.sliceType === "project-tags")`** and add an explicit `gates` arm. Leave no `else`.
  The catch-all is a latent version of exactly the clobbering bug the header comment at
  `config.ts:87-92` warns about — the next slice added after this one would silently inherit the
  gates write.
- Export `DEFAULT_GATES: MaestroGates = { confidence_check: false, use_design_check: false }` and
  `resolveGates(cfg)`, which reads each field with a strict `=== true` so anything non-boolean
  resolves to off.

`apps/maestro/src/core/seed.ts` — `defaultV3Config` emits
`gates: { confidence_check: false, use_design_check: false }`.

### The runtime script

New file `plugins/maestro/scripts/maestro-step1-gates.cjs`, modelled closely on
`maestro-set-session-workflow.cjs`: shebang, a long header comment stating the contract, CommonJS,
`process.env.CLAUDE_PROJECT_DIR ?? process.cwd()`, no dependencies.

- **No arguments.** Reads `<projectDir>/.claude/maestro.json`.
- **Exit code 0 unconditionally. Nothing is ever written to stderr.** There is no failure branch and
  no `process.exit(1)`. This is load-bearing: a non-zero exit from an injected command aborts the
  entire skill invocation, and Claude then never sees the orchestrator body at all.
- **Exactly one line on stdout**, newline-terminated:

| Resolved state | stdout |
| --- | --- |
| both on | `Gates: run /confidence-check, then /use-design-check.` |
| confidence only | `Gates: run /confidence-check.` |
| design only | `Gates: run /use-design-check.` |
| neither on — **and** every degenerate case below | `Gates: none — skip Step 1 and go straight to Step 2.` |

> **Superseded — see divergence 4.** Each line now carries the whole step (which skills, in what
> order, with the `Skill` tool in the orchestrator's own context) rather than a terse directive the
> template branches on. Still exactly one newline-terminated line per state, still four distinct
> answers, still every degenerate case landing on the both-off one. The tests assert those
> properties rather than the wording.

Degenerate cases that must all land on the skip line, quietly: `maestro.json` missing, unreadable,
unparseable, `version !== 3`, `gates` absent, `gates` present but not a plain object, a gate whose
value is not a boolean, and any unexpected throw (wrap the whole body in `try`/`catch`).

Register it as a runtime asset in **both** implementations of the manifest —
`apps/maestro/src/core/install.ts` (`STATIC_ASSETS`, ~L145-177) and
`plugins/maestro/scripts/maestro-install.js` (`STATIC_ASSETS`, ~L366-383) — as
`{ src: "scripts/maestro-step1-gates.cjs", dest: ".claude/scripts/maestro-step1-gates.cjs" }`, in
the same position in each. It needs no entry in `build-plugin-libs.mjs`: it imports nothing from
`src/core`.

Extend `plugins/maestro/scripts/maestro-check-runtime.cjs` so a project missing the script reports
**stale**. That nag is the only thing standing between a half-installed project and an aborted
`/maestro` — see the notes.

### The template

`plugins/maestro/templates/maestro/SKILL.md` — add one line to the frontmatter:

```yaml
allowed-tools: Bash(node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-step1-gates.cjs")
```

and replace the Step 1 block *inside* the `<!-- Maestro:STEPS -->` region with the following. Steps
2, 3 and 4 keep their numbers and their text.

````markdown
### Step 1 — Custom checks (optional gates)

!`node "$CLAUDE_PROJECT_DIR/.claude/scripts/maestro-step1-gates.cjs"`

The line above is this project's gate configuration, read from `.claude/maestro.json` and injected
before you saw this prompt. Run exactly the gate skills it names, in the order it names them, and no
others.

- **If it names one or more gates**, run each with the `Skill` tool in your own context before
  Step 2. If confidence is low, gather more information; if the design check raises issues, address
  them. Both gates are on the same thing — that the request is understood well enough to commit a
  workflow to it — so clear them before choosing and executing one (Steps 2 and 3).
- **If it says none — or the line is missing, empty, or says shell execution is disabled by
  policy —** this project has opted out of the gates. Go straight to Step 2.

Skip any named gate this project doesn't actually have, and say so — never invent one.
````

That second bullet is what makes `disableSkillShellExecution: true` (which replaces the command with
the literal `[shell command execution disabled by policy]`) land on the same answer as an absent
`gates` field: skip.

### The UI chain

Mirror `ProjectTagsCard` — it is the same shape of thing (a post-install card of checkboxes that
writes `maestro.json` on every click, with no Save button) and the closest analogue in the app.

1. `apps/maestro/src/core/contracts.ts` — `MaestroGates` lives here, interfaces only. Never export it
   through the `src/core/index.ts` barrel; the renderer's type graph must not pull `fs` in.
2. `apps/maestro/src/shared/ipc.ts` — `gatesData: "data:gates"`, `gatesSet: "project:gates:set"`,
   `GatesData { gates: MaestroGates }`, the `ConfigSlice` union arm, and the `MaestroApi`
   declarations. Doc-comment them as the pair that drives the orchestrator's injected Step 1.
3. `apps/maestro/src/preload/index.ts` — `data.gates` and `project.gates.set`, beside
   `project.tags.set` (L29 / L48). No generic passthrough.
4. `apps/maestro/src/main/ipc.ts` — a read handler returning
   `{ gates: resolveGates(readConfig(currentRoot())) }`, falling back to `DEFAULT_GATES` when no
   project is open (it must not reject; the card renders on a route that is reachable in that
   state), and a write handler calling `saveConfig(root, { sliceType: "gates", slice: { gates } })`
   and returning the saved gates. Unlike `projectTagsSet` there is **no** second cross-slice write.
5. `apps/maestro/src/renderer/src/routes/maestro.tsx` — a `GatesCard({ viewedRoot })` structurally
   copied from `ProjectTagsCard` (L332-406): `useState<GatesData | null>`, a `useEffect` fetch
   through `callMain` keyed on `viewedRoot`, a `busy` flag, a save on **every** checkbox change,
   `toast(…, { variant: "error" })` on failure, and the same `<label>` wrapping a native
   `<input type="checkbox" className="… accent-primary">` (there is no Checkbox in `@repo/ui`;
   native-inside-a-label is the established pattern in all five existing call sites). Two fixed
   rows — *Run `/confidence-check`* and *Run `/use-design-check`* — with copy saying that unchecking
   both skips Step 1 entirely and that checking only the design box runs it on its own. Render it at
   L660, immediately after `ProjectTagsCard`, under the same
   `{status?.installed && viewedRoot && …}` guard and with `key={viewedRoot}`.

### Version bump

`plugins/maestro/.claude-plugin/plugin.json` `0.4.0` → **`0.5.0`**. Minor: the published surface
grows by a script.

> **Shipped as `0.4.1`, not `0.5.0`** — see the divergence below. This paragraph is what the page
> planned; the reasoning in it was measured against the project's own rule and did not hold.

## Acceptance criteria

All met. Evidence in brackets; the suite is `pnpm --filter maestro test` — **42 files, 784 tests,
all passing**, with `typecheck` (both tsconfig projects) and repo-wide `pnpm check` clean.

- [x] All four gate combinations produce the documented single stdout line, with exit 0 and empty
      stderr — [`install.test.ts` › `maestro-step1-gates.cjs (032)` spawns the **copied** script over
      all four combinations; and live against a fixture project scaffolded by the real
      `maestro-install.js`, all four states gave one line, exit 0, 0 bytes on stderr. Per divergence
      4 the assertion is on the contract — one line, only the enabled gates named, in order, four
      distinct answers, every state routing on to Step 2 — not on the sentences, which are now the
      step itself and expected to be reworded. Mutation-checked in both directions]
- [x] A missing `maestro.json`, corrupt JSON, `version: 2`, an absent `gates`, a partial `gates`, a
      non-object `gates` and a non-boolean gate value all produce the both-off line, with exit 0 and
      empty stderr — [twelve degenerate inputs in `install.test.ts`, each asserting byte equality
      with the both-off line **read back from the script** rather than restated, plus exit 0 and
      empty stderr; plus a `resolveGates` describe in `config.test.ts` over well-formed,
      absent, null config, partial, non-boolean, non-object, and fresh-object-per-call]
- [x] `mergeSlice` has an explicit `gates` arm and an explicit `project-tags` arm and no `else`; a
      gates save leaves `workflows` / `rules` / `project_tags` untouched, and each of those saves
      leaves `gates` untouched — [`config.test.ts` › `mergeSlice — gates` asserts isolation in both
      directions across all four slices, replace-not-merge, and absent on `blankConfig`; confirmed
      live — the gates saves left `workflows` / `workflow_instances` / `rules` / `project_tags`
      byte-identical on disk]
- [x] A freshly seeded `maestro.json` carries
      `gates: { confidence_check: false, use_design_check: false }` — [`defaultV3Config` in
      `seed.ts`, **and** the regenerated `lib/maestro-seed.cjs` so the terminal installer agrees —
      see divergence 2]
- [x] `serializeConfig` output is unchanged in shape — 2-space indent, no trailing newline —
      [`save.test.ts`; and verified on the on-disk file the real UI wrote]
- [x] A fresh install from **both** implementations copies `maestro-step1-gates.cjs` into
      `.claude/scripts/`, and `maestro-check-runtime.cjs` reports a project missing it as stale —
      [`install.test.ts` (the app path) and `real-project.test.ts` (the real `maestro-install.js`);
      `installStatus` reports stale when the file is deleted and clean after a reinstall, and
      `maestro-check-runtime.cjs` answers `update` naming the missing script. New
      `parity.test.ts` › `STATIC_ASSETS manifest parity` parses both source manifests and asserts
      the two `src` sets are **equal** (13 each)]
- [x] The installed `SKILL.md` carries the `allowed-tools` line and the exact `` !`…` `` literal, and
      the command string inside `allowed-tools` is asserted **byte-identical** to the one in the
      STEPS region — one assertion, so the two cannot drift apart — [`real-project.test.ts`, one
      assertion, against the project the real installer scaffolds]
- [x] A managed-region re-sync leaves everything before `<!-- Maestro:STEPS:START -->`
      byte-identical, frontmatter included — [`real-project.test.ts`]
- [x] Toggling either checkbox on `/maestro` writes `.claude/maestro.json` immediately, and both
      boxes render unchecked on a freshly seeded project — [driven in a real packaged Electron
      window over CDP: both boxes unchecked on a fresh seed; box 1 → `{true, false}`; box 2 →
      `{true, true}`; unchecking box 1 → `{false, true}`, the design-only combination, with the DOM
      agreeing and **0 console errors**. The script then read back exactly what the card wrote]
- [~] `plugins/maestro/.claude-plugin/plugin.json` reads **`0.4.1`**, not the `0.5.0` this page
      specified — [deliberate, decided with the user; see the version divergence below. The
      criterion behind it — that the plugin version moved off `0.4.0`, so autoUpdate re-pulls — is
      met, and that is the only part of it anything reads]

## Divergences from what this page planned

Three, all recorded here so the page describes what exists rather than what was intended.

1. **The check-runtime staleness test is a LIST, not a single file.** The page said "extend
   `maestro-check-runtime.cjs` so a project missing the script reports stale". It landed as a
   `SKILL_INVOKED_SCRIPTS` array covering all three scripts the orchestrator invokes by
   `$CLAUDE_PROJECT_DIR` path — `maestro-step1-gates.cjs`, `maestro-set-session-workflow.cjs`,
   `maestro-task-status.cjs` — because the failure shape is identical for all three and one loop
   costs nothing. A missing one answers `update` with reason
   `the project's copied runtime is missing .claude/scripts/<name>`. The new check is numbered **4**,
   which renumbered the existing checks 4 and 5 to **5 and 6** throughout that file's header, its
   numbered list and its prose.
2. **`plugins/maestro/scripts/lib/maestro-seed.cjs` had to be regenerated**, which this page did not
   mention. It is a `build-plugin-libs.mjs` bundle of `seed.ts`, so without
   `pnpm --filter maestro build:plugin-libs` the terminal installer kept seeding a `maestro.json`
   with no `gates` block — which resolves to "both off" and therefore *looked* correct. Caught by
   installing into a real fixture project, not by any test.
3. **The plugin shipped as `0.4.1`, not the `0.5.0` this page specified** — decided with the user
   rather than during implementation. Detail below.
4. **The script prints the whole of Step 1, not "a single directive line and nothing else"** —
   reversing one of this page's settled decisions, at the user's direction. Detail below.

Everything else landed exactly as specified, including the `allowed-tools` decision, the narrow
grant, the four-arm `mergeSlice` with no `else`, and the fixture split. **The `sh -c '… || true'`
fallback this page offered was not needed.**

### On the fourth: where Step 1's prose lives

This page settled that the prose stays in the `STEPS` region and the script prints "a single
directive line and nothing else". Built that way, Step 1 was ten lines of template describing a
four-way branch, of which the default project takes the do-nothing arm.

That is the exact shape `maestro-check-runtime.cjs`'s header rejects for itself — *"the collapse
belongs in code: prose that re-derives it is re-read at the top of every single orchestration, costs
tokens on every run including the healthy one... The wording travels with the logic instead, so the
two can never disagree."* Its `INSTRUCTIONS` map is one sentence per action for the same reason.
Step 1 as specified was the branch table that comment exists to argue against, and the user called
it. So the script now prints the whole step and the template collapsed to three lines.

**One thing had to stay behind**, and it is the reason this is a collapse rather than a move: the
template still says what to do when the injected line is *missing, empty, or replaced by
`[shell command execution disabled by policy]`*. The script cannot speak to the case where its own
output never arrived. Everything else is in the script.

The consequences for the tests: the four outputs are prose now, so `install.test.ts` asserts the
contract — one newline-terminated line, only the enabled gates named, confidence before design when
both are on, every state routing on to Step 2, and four distinct answers — instead of byte-copying
sentences that are expected to be reworded. The degenerate-input test reads the both-off line from
the script rather than restating it. Both were mutation-checked: collapsing design-only onto the
both-off line, and reversing the order in the both-on line, each fail.

### On the third: the version component

This page called for a minor on "the published surface grows by a script". Measured against
`.claude/skills/updating-maestro/`'s own table and its `0.3.5` precedent — *"a new file under
`scripts/` is not a published surface; a new directory under `skills/` or `agents/` is"* — that does
not hold: `hooks/hooks.json` is untouched, no skill, agent or command was added or renamed, and a
consumer gains nothing new to **invoke**. `/maestro` simply does less by default.

Raised with the user, who chose to follow the rule over the page, so it shipped as **`0.4.1`**.
Nothing reads the magnitude — autoUpdate compares the string for inequality only — so delivery is
identical either way; what the correction buys is that the next person reading `updating-maestro`'s
worked examples is not taught the wrong rule by a live counter-example. `updating-maestro` carries
it as the fourth worked example, and as the case where the table was applied *against* a ticket
that specified the bump.

## Notes for whoever picks this up

**Why `allowed-tools` and not a `permissions.allow` entry in `.claude/settings.json`.** An injected
command never prompts: *"When a command's permission check returns anything other than allow, Claude
Code aborts the invocation. This includes a rule that would normally ask you."* An abort means Claude
never sees the skill body — so a grant is not optional. `allowed-tools` is documented as *"tools
Claude can use without asking permission during the turn that invokes this skill"*: it is a **grant**,
not a restriction (`disallowed-tools` is the separate restriction field), so it does **not** narrow
the orchestrator's access to `Task`, `TaskCreate`, `Skill` or `Read`. Choosing it keeps the installer
out of the `permissions` block of `settings.json` entirely — no new uninstall-removal logic, and no
new claim for `.claude/skills/installing-maestro/` to have to answer for.

**The consequence, and it will bite someone.** Frontmatter sits *outside* the managed regions, so
`syncManagedRegions` never rewrites it, and `installOrchestratorSkill` copies the template whole
**only when the destination is absent**. A plain uninstall keeps `.claude/skills/maestro/SKILL.md`.
So on an already-installed project the new frontmatter arrives only after a `--purge` uninstall, or
after deleting that one file, before reinstalling. Say this in `.claude/skills/updating-maestro/`.

**Why there is no `|| true` around the injected command.** Keeping it a single clause with no shell
operators lets the grant be an exact string instead of needing `Bash(sh -c *)` breadth. The trade is
that a *missing* script makes `node` exit 1 and takes the whole invocation with it. That is the known
failure mode; the staleness check on the script's absence is what is supposed to catch it first. If
you find during implementation that the staleness nag cannot fire early enough, the fallback is a
`sh -c '… || true'` wrapper with a matching exact-string grant — but take the narrow grant first.

**`use-design-check` also appears elsewhere, and this ticket does not touch it.**
`skills_available` always carries `use-design-check`, and the seeded **Refactor** workflow has a
`skill:use-design-check` node in its success path. That is Step 3's skill-step mechanism — a
different thing from the Step 1 gate — and it stays as it is. The comment at `seed.ts:272` calling it
"the always-present gate skill" is now misleading and should be corrected as part of this work.

**Tests to extend.** `apps/maestro/test/core/config.test.ts` (slice isolation in both directions;
`resolveGates` over absent / partial / corrupt) · `install.test.ts` (the new asset is copied; spawn
the *copied* script over every input case above asserting exact stdout, empty stderr and exit 0;
staleness when it is deleted) · `real-project.test.ts` (the real `maestro-install.js` copies it, and
the `allowed-tools` ↔ STEPS byte-identity assertion) · `parity.test.ts` (add a source-level assertion
that the `src` sets of the two `STATIC_ASSETS` manifests are **equal** — this is the drift the twin
implementations are otherwise free to accumulate, and this ticket is the occasion to lock it) ·
`fixtures/configs.ts` (give one fixture a `gates` block and leave `defaultish` without one, so both
branches are walked) · `isolation.test.ts` (re-run it: it fails if the two new channels are not
declared in `shared/ipc.ts`, which is the intended guard) · `save.test.ts` / `render.test.ts` (a
gates save still re-renders HANDOFFS and does not disturb STEPS). The card itself is not
unit-testable — drive the real Electron window per `apps/maestro/.claude/skills/test-maestro/`.

**Docs to update.** `.claude/skills/maestro-architecture/` (Step 1 is now config-driven and injected;
injected context is a *third* delivery channel beside hooks and prose; add the script to the
inventory) · `apps/maestro/.claude/skills/maestro-config-model/` (`gates?` in the shape table;
`ConfigSlice` is now four arms and the `else` catch-all is gone) ·
`.claude/skills/installing-maestro/` (the asset manifest gains a script; `settings.json` is still
hooks-only — say so explicitly, since that is the question this skill exists to answer) ·
`.claude/skills/updating-maestro/` (the purge-and-reinstall requirement above) ·
`apps/maestro/CLAUDE.md` script list · `plugins/maestro/skills/maestro-install/SKILL.md` (~L102) and
`maestro-update/SKILL.md` (L18, L80), both of which enumerate the copied scripts by name. Bump
`metadata.version` / `last-update` on every concept skill touched — through
`maestro-concept-skills.cjs`, never by hand.

## Blocked by

_none_
