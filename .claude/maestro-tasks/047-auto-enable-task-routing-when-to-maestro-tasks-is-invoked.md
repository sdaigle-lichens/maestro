# Auto-enable task routing when /to-maestro-tasks is invoked

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Add a new hook script, `maestro-enable-task-routing.js`, that fires the first time the `/to-maestro-tasks` skill is invoked in a session and flips `use_maestro_tasks` to `true` in `.claude/maestro.json` — so future Step 4 renders keep showing the directive from the previous task without the user having to find the setting in the app.

Dual-register it exactly like `maestro-step0.js`: `UserPromptExpansion` (matcher on the bare skill name, i.e. the user typed `/to-maestro-tasks`) and `PreToolUse` (matcher `Skill`, checking the invoked skill name against it). Reuse the same leading-`/`-and-`plugin:`-prefix-tolerant, exact-last-segment bare-name matching `maestro-step0.js` already implements (`isOrchestrator`/`invokesOrchestrator`), generalized to compare against `to-maestro-tasks` instead of `maestro`. Unlike `maestro-step0.js`, this hook injects NO context at all — no stdout, no additionalContext — it exists purely for the config write side-effect, and must never fire for any other skill (in particular, never for `/maestro` itself).

The write must be safe and quiet, matching the 'a hook that cannot answer must not take the session down with it' discipline every other Maestro hook follows: read `.claude/maestro.json`, parse it, and on ANY failure (missing file, corrupt JSON, anything unexpected) do nothing and exit 0 with no stderr. If the field already resolves to `true`, also do nothing — no redundant write, which narrows the window against a concurrent app write. Otherwise, mutate ONLY that one field on the parsed object — every other field passes through exactly as read, never re-derived — and write it back with the exact same serialization `writeConfig` uses: `JSON.stringify(cfg, null, 2)`, no trailing newline.

Register the hook in `plugins/maestro/hooks/hooks.json` for both events, and deliver it to an installed project the same dual-location way the other six hooks are delivered (a `.cjs` copy under `.claude/scripts/` plus a registration entry in the project's own `.claude/settings.json`), via both `installRuntime()` and `maestro-install.js`/`maestro-update`. Bump the plugin version again.

## Acceptance criteria

- [x] Invoking /to-maestro-tasks (both as a typed command and via the Skill tool) in a session where use_maestro_tasks is false or absent flips it to true in .claude/maestro.json, leaving every other field byte-identical to before — verified against fixture projects: typed `/to-maestro-tasks` flipped absent → `true` with the diff limited to that one key; the `Skill`-tool path (plugin-namespaced `maestro:to-maestro-tasks`) flipped correctly too, confirming the namespace-tolerant matching
- [x] Invoking it again when already true writes nothing to disk (no-op, verified by content/mtime unchanged) — verified via `sha256sum` and `stat -c %Y` a second apart: both unchanged, no write occurred
- [x] A missing or corrupt maestro.json leaves the hook silent: exit 0, no stderr, no crash, and no file is created where none existed — verified both cases: missing config → exit 0, zero stderr, zero stdout, no file created; corrupt config (`{ this is not json`) → exit 0, zero stderr, hash unchanged (left untouched, not "fixed")
- [x] The hook does not fire for any other skill invocation, in particular /maestro itself, and does not interfere with maestro-step0.js's own registrations on the same two events — verified: `command_name: "maestro"` did not fire it, and `Skill` calls for an unrelated skill (`maestro:maestro-help`) did not fire it either; structurally confirmed maestro-step0.js's own matchers/commands are untouched in hooks.json and both installers' HOOK_REGISTRATIONS/HOOK_SCRIPTS, and each script arbitrates independently via its own `projectOwnsHook(__filename, ...)` call
- [x] The hook script is delivered to a project (both the .cjs copy and its .claude/settings.json registration) by both install implementations, matching how maestro-step0.js is delivered — added to HOOK_SCRIPTS (gets the .js → .cjs rename) and two HOOK_REGISTRATIONS entries in both `apps/maestro/src/core/install.ts` and `plugins/maestro/scripts/maestro-install.js`, mirrored by hand; all 969 existing tests pass (they assert against `HOOK_REGISTRATIONS.map(...)` dynamically, not a hardcoded count) and `pnpm --filter maestro typecheck` passes clean
- [x] Running /maestro after invoking /to-maestro-tasks once, on a task that reaches Step 4, now shows the /to-maestro-tasks directive from the gate script added in the prior task — follows directly from the flip being verified above and `046`'s `maestro-step4-gate.cjs` already reading `use_maestro_tasks` correctly
- [x] Plugin version bumped again — `0.5.2` → `0.5.3`, a patch (new file under `scripts/` is not a published surface; the two new registrations are on events the plugin already registers, no new top-level `hooks.json` key; no skill, agent, or command added or renamed), per the `updating-maestro` skill's table

## Blocked by

- `046-add-the-use-maestro-tasks-setting-and-the-step-4-gate-script.md`
