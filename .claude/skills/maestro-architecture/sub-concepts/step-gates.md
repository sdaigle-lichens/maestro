# Injected context: the Step 1 and Step 4 gates

**Injected context is a third delivery channel, and it is the only one that can abort the
invocation.** A hook pushes context in from outside the skill; the template's prose carries it
statically inside the body. Step 1 uses neither: the body holds a `!`-prefixed command line, and
Claude Code runs that command and substitutes its **stdout** before the model ever sees the prompt.

**The injected line is the whole of Step 1, not a flag the body branches on**, and that is the
point of using this channel at all. `maestro-step1-gates.cjs` prints the full instruction for the
resolved state — which skills, in what order, with the `Skill` tool in the orchestrator's own
context, and what to do about a low score — while the template holds only "do exactly what the line
above says" plus the fallback below. The reasoning is `maestro-check-runtime.cjs`'s, verbatim: a
branch table in `SKILL.md` is re-read at the top of **every** orchestration including the default
one, and prose that re-derives a decision made in code is prose that can disagree with it. An
earlier draft split them — a terse `Gates: run /confidence-check.` in the script and the bullets in
the template — and it is the wrong shape for both reasons.

Four consequences, all load-bearing:

- **The command needs a grant, and the grant is not optional.** A permission check answering
  anything but `allow` aborts the whole invocation — the model never sees the orchestrator at all.
  It is granted by `allowed-tools` in the *template's frontmatter*, which is a **grant**, not a
  restriction (`disallowed-tools` is the restriction field), so it does not narrow the
  orchestrator's access to `Task`/`TaskCreate`/`Skill`/`Read`. Deliberately **not** a
  `permissions.allow` entry in the project's `settings.json` — see `installing-maestro`.
- **A non-zero exit aborts it too.** Which is why `maestro-step1-gates.cjs` exits 0 unconditionally,
  writes nothing to stderr, and has no failure branch: every degenerate input resolves to the
  continue-to-Step-2 line instead.
- **Exactly one line, however long.** Each of the four is several sentences on a single
  newline-terminated line — it keeps the contract trivially assertable and lets the body say "the
  line above". `install.test.ts` pins the *properties* (one line, only the enabled gates named, in
  order, always sending the orchestrator on to Step 2, four distinct answers) rather than the
  wording, which is prose and expected to be reworded.
- **A missing script does not degrade — it kills `/maestro`.** The command is a single clause with
  no `|| true`, so `node` on an absent file exits 1. `maestro-check-runtime.cjs` therefore carries a
  presence check (`SKILL_INVOKED_SCRIPTS` — the scripts the orchestrator names by
  `$CLAUDE_PROJECT_DIR` path: `maestro-step1-gates.cjs`, `maestro-step4-gate.cjs` (`046`),
  `maestro-set-session-workflow.cjs`, `maestro-task-status.cjs`) and answers `update` when one is
  absent. That nag is the only thing between a half-installed project and an aborted invocation.

If the harness has `disableSkillShellExecution: true`, the line is replaced with the literal
`[shell command execution disabled by policy]`. **This is the one thing the script cannot speak
to** — its own output never arrived — so it is the one thing the template must still say for
itself: a missing, empty or policy-replaced line means this project has no Step 1, go to Step 2.
Keep that sentence in the template however much else moves into the script.

## Step 1's gates default to OFF (`032`)

`maestro.json`'s `gates: { confidence_check, use_code_architecture_design_check }` is resolved at
invocation time by `maestro-step1-gates.cjs`. All four combinations are valid and none nests inside
another. A seeded config has both `false`, and **every** degenerate case — no config, corrupt JSON,
`version !== 3`, `gates` absent or not a plain object, a non-boolean value, any throw — resolves to
the continue-to-Step-2 line, quietly, with exit 0. The checkboxes live on the desktop app's
`/maestro` page; there is no migration, so a project installed before `032` simply has no `gates`
field and skips. `/confidence-check` and `/use-code-architecture-design-check` are still bundled in
this plugin (`plugins/maestro/skills/{confidence-check,use-code-architecture-design-check}`), but
the orchestrator no longer references them "if available" — it runs what the injected line names,
and is told to say so rather than invent one if a named gate isn't installed.

**The design gate is a router, and what it routes to is a third bundled skill.**
`use-code-architecture-design-check` only decides RUN/SKIP; the pass itself is
`plugins/maestro/skills/code-architecture-design/` (deep modules, seams, the Design Brief), which
the model invokes with the Skill tool. Two consequences worth knowing: the check is
`user-invocable: false` and the design skill is **not**, so a user can reach the pass directly
without the gate; and both inject the project's concept list with a `!`-prefixed
`maestro-concept-skills.cjs list` at expansion time, which is why each carries that exact command in
`allowed-tools`. **`code-architecture-design` is not `/design`** — that name resolves to the Claude
Design canvas skill (visual mockups), which is the collision the rename exists to end.

**`use-code-architecture-design-check` means two different things and only one of them is a gate.**
The seeded **Refactor** workflow has a `skill:use-code-architecture-design-check` **node** in its
success path — that is Step 3's inline-skill mechanism, driven by `workflows`, and it is untouched
by the `gates` field. Turning both gates off does not remove it. `seed.ts` used to call it "the
always-present gate skill" in a comment; that was corrected in `032` because it invited exactly this
confusion. **The rename from `use-design-check` was not migrated in either place.**
`defaultV3Config` seeds the new name into `skills_available` and into the Refactor workflow's node,
but an existing `maestro.json` keeps `skill:use-design-check` and a `gates.use_design_check` key — a
node naming a skill the plugin no longer ships, and a gate flag `resolveGates` no longer reads, so a
project that had the design gate **on** comes back silently off. Both are hand-edits (or a
`/maestro` save) away, and nothing reports either.

## Step 4's task-routing nudge (`046`, `047`)

`maestro.json`'s top-level `use_maestro_tasks?: boolean` — a SIBLING of `gates`, not nested in it —
is resolved by `resolveUseMaestroTasks`, the same strict `=== true` discipline as `resolveGates`
(absent, corrupt, `version !== 3`, or non-boolean all resolve to off). `maestro-step4-gate.cjs`
mirrors `maestro-step1-gates.cjs`'s contract byte for byte: no arguments, exits 0 unconditionally,
never writes stderr, prints exactly one line — naming `/to-maestro-tasks` when on, a neutral line
when off.

**Both gate scripts write a `kind:"phase"` marker to the session's `log.jsonl` (`064`)**, resolved
from `CLAUDE_CODE_SESSION_ID` since these two have no stdin payload at all. The write sits inside
the existing `logPhase()` try/catch, which cannot touch stdout, so the one-line contract above is
unchanged and was re-verified in all three id states. Skipping the marker is now only the no-id
fallback rather than the normal path. `ctx_pct`/`ctx_model` stay absent on those two entries: they
need `transcript_path`, which the environment variable does not give.

**`047` built the first writer of the setting**: `maestro-enable-task-routing.js`, dual-registered
exactly like `maestro-step0.js` (`UserPromptExpansion` on `to-maestro-tasks`, `PreToolUse` on
`Skill`), flips it to `true` the first time `/to-maestro-tasks` is invoked by either entrance, and
injects nothing itself — the write is its only effect. A checkbox on the desktop app's `/maestro`
page is still unbuilt; until then, hand-editing `maestro.json` is the only other way to set it.

## The post-mortem prompt is NOT part of that mechanism (`049`)

Despite sitting back to back with the `046` gate line in Step 4. `maestro-step4-gate.cjs`'s
task-routing suggestion is script-injected and gated on `use_maestro_tasks`; the sentence directly
under it — asking once whether to run `/maestro-post-mortem` when the session needed a major review
fix, a mid-task refactor, or didn't land correctly on the first pass — is plain, always-on template
prose in the same `Maestro:STEPS` region: no script, no `maestro.json` field, reaches every project
on install/update regardless of any setting. It also carries its own gate in prose, not code: skip
the question entirely on a clean run, so it doesn't become something the user sees on every task.
