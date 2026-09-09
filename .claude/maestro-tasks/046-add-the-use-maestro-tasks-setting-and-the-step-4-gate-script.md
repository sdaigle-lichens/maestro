# Add the use_maestro_tasks setting and the Step 4 gate script

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Add a new project setting, `use_maestro_tasks` (boolean, top-level field on MaestroConfigV3, a SIBLING of `gates` — never a field nested inside `gates`, since `gates` is documented specifically as the orchestrator's Step 1 gates and this is a Step 4 concern with a different write story). Give it the same absent/malformed/non-boolean-resolves-to-false discipline the existing `gates` field has, via a new `resolveUseMaestroTasks(cfg)` reader in config.ts (mirror `resolveGates`'s strict `=== true` comparison and its doc comment style) and its own explicit `mergeSlice` arm keyed `sliceType: "task-routing"` — the merge dispatcher has no trailing `else` on purpose, so this must be a new explicit branch, not folded into an existing one.

Then add a new project-only plugin script, `maestro-step4-gate.cjs`, following EXACTLY the contract `maestro-step1-gates.cjs` already establishes: no arguments, exits 0 unconditionally under every input including a missing/corrupt/wrong-version config, writes nothing to stderr ever, and prints exactly one newline-terminated line. Since it's a project-only script (like `maestro-step1-gates.cjs` and `maestro-task-status.cjs`), it cannot import from src/core and must read `.claude/maestro.json` directly with `fs`, re-implementing the same strict-boolean resolution rule inline. When the setting resolves true, the line is a short directive telling the orchestrator to consider running `/to-maestro-tasks` at this point in the workflow to queue up any follow-up work; when false/absent/corrupt, print a short neutral line saying there's nothing to do here — never silence, matching Step 1's "an explicit line says the script ran and the answer is deliberate" reasoning.

Wire this into the orchestrator template's Step 4 (`plugins/maestro/templates/maestro/SKILL.md`, inside the managed `Maestro:STEPS` region): add a new `!`command`` dynamic-context line invoking the script, appended AFTER Step 4's existing mark-task-done prose — do not replace, reorder, or restructure that existing content. Add the exact new command to the orchestrator's frontmatter `allowed-tools` grant, alongside the existing Step 1 and resume-target grants (a missing grant silently aborts the whole `/maestro` invocation, so this is not optional).

Finally, register `maestro-step4-gate.cjs` as a project-only static asset in BOTH install implementations that must stay in sync — `apps/maestro/src/core/install.ts` and `plugins/maestro/scripts/maestro-install.js` — following exactly how `maestro-step1-gates.cjs` is registered in each today. Bump `plugins/maestro/.claude-plugin/plugin.json`'s `version` (patch is the safe default for a behavior change to existing scripts/templates — consult the `updating-maestro` skill if unsure which component).

## Acceptance criteria

- [x] resolveUseMaestroTasks(cfg) returns false for every degenerate input (absent field, corrupt/null config, version !== 3, a non-boolean value like a string or number) and true only for a literal `true`, mirroring resolveGates's existing test coverage style — `test/core/config.test.ts` › `describe("resolveUseMaestroTasks (046)")`
- [x] mergeSlice gains an explicit sliceType === "task-routing" arm that writes only use_maestro_tasks and leaves every other slice (workflows, rules, gates, project_tags, reports, handoffs) byte-identical — `test/core/config.test.ts` › `describe("mergeSlice — task-routing (046)")`
- [x] maestro-step4-gate.cjs takes no arguments, always exits 0, never writes to stderr under any input (missing file, corrupt JSON, wrong version, non-boolean value), and always prints exactly one newline-terminated line — verified for both the true and the false/absent/corrupt cases — `test/core/install.test.ts` › `describe("maestro-step4-gate.cjs (046)")`, on/off contract test + ~9-case degenerate-input table
- [x] A hand-edited maestro.json with use_maestro_tasks: true produces a rendered Step 4 (via /maestro-install or /maestro-update) that shows the /to-maestro-tasks directive line; false or absent produces the neutral line — in both cases the existing mark-task-done instructions are unchanged — manual end-to-end verification against `maestro-install.js` + `maestro-render-orchestrator.cjs` in a scratch project
- [x] maestro-step4-gate.cjs is copied into a freshly installed or updated project by both installRuntime() (apps/maestro) and maestro-install.js/maestro-update (plugin), matching how maestro-step1-gates.cjs is delivered today — asset-copied test in `test/core/install.test.ts` (046) + `test/core/parity.test.ts` `STATIC_ASSETS manifest parity`
- [x] plugins/maestro/.claude-plugin/plugin.json's version is bumped — `0.5.1` → `0.5.2` (patch)

## Divergence from plan

`plugins/maestro/scripts/maestro-check-runtime.cjs`'s `SKILL_INVOKED_SCRIPTS` gained
`"maestro-step4-gate.cjs"` (alongside the existing `maestro-step1-gates.cjs`), with the comment
above the list updated to explain why both Step 1 and Step 4 gate scripts are the "fatal if
missing" case. Not in the original acceptance criteria above, but follows directly from Step 4's
`!`command`` line sharing Step 1's failure mode: a missing script kills `/maestro` outright rather
than degrading, since all `!`command`` lines in a skill body are expanded before the model sees the
prompt, on every invocation, not just ones that reach Step 4. Without this addition, a project that
manually deleted `maestro-step4-gate.cjs` post-install would get no staleness warning before
`/maestro` started failing outright. Verified with a `maestro-check-runtime.cjs` integration test
proving a missing `maestro-step4-gate.cjs` reports `action: "update"` with the filename in `reason`.

## Blocked by

None — can start immediately
