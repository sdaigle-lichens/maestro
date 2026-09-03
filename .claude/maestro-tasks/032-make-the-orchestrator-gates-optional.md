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
- **The Step 1 prose stays in the template's `STEPS` region.** The script prints a single directive
  line and nothing else.

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

## Acceptance criteria

- [ ] All four gate combinations produce the documented single stdout line, with exit 0 and empty
      stderr
- [ ] A missing `maestro.json`, corrupt JSON, `version: 2`, an absent `gates`, a partial `gates`, a
      non-object `gates` and a non-boolean gate value all produce the skip line, with exit 0 and
      empty stderr
- [ ] `mergeSlice` has an explicit `gates` arm and an explicit `project-tags` arm and no `else`; a
      gates save leaves `workflows` / `rules` / `project_tags` untouched, and each of those saves
      leaves `gates` untouched
- [ ] A freshly seeded `maestro.json` carries
      `gates: { confidence_check: false, use_design_check: false }`
- [ ] `serializeConfig` output is unchanged in shape — 2-space indent, no trailing newline
- [ ] A fresh install from **both** implementations copies `maestro-step1-gates.cjs` into
      `.claude/scripts/`, and `maestro-check-runtime.cjs` reports a project missing it as stale
- [ ] The installed `SKILL.md` carries the `allowed-tools` line and the exact `` !`…` `` literal, and
      the command string inside `allowed-tools` is asserted **byte-identical** to the one in the
      STEPS region — one assertion, so the two cannot drift apart
- [ ] A managed-region re-sync leaves everything before `<!-- Maestro:STEPS:START -->`
      byte-identical, frontmatter included
- [ ] Toggling either checkbox on `/maestro` writes `.claude/maestro.json` immediately, and both
      boxes render unchecked on a freshly seeded project
- [ ] `plugins/maestro/.claude-plugin/plugin.json` reads `0.5.0`

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
