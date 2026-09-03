# The two surfaces

The same verdict has to be reachable from a window and from a terminal, and `031`'s acceptance
criteria say so explicitly: *"the `maestro` and `maestro-update` skills print the same diff and reach
the same verdict as the app for the same project state."* They do it by running the same compiled
code, not by two implementations that were written to agree.

```
apps/maestro/src/core/agent-sync.ts + sync-decision.ts + diff.ts
        │                                             │
        │ imported directly                           │ build-plugin-libs.mjs (esbuild → CJS)
        ▼                                             ▼
  src/main/ipc.ts                        plugins/maestro/scripts/lib/maestro-agent-sync.cjs
  agent:sync · agent:sync:apply                 ▲                    ▲
        │                    require("./lib/…") │                    │ require("./lib/…")
        ▼                                       │                    │
  /maestro count · /agents review card   maestro-step0.js   maestro-agent-forks.cjs
                                         (the hook)                  │
                                                            maestro-update (step 3)
```

## The app side

- `agent:sync` is a pure read, called by `InstallProvider.refresh()` on **project selection** and by
  `/agents`' own `refresh()`. `agent:sync:apply` is the write, one agent and one named action.
  Two channels rather than one for the same reason `install:status` and `install:run` are two.
- Main passes `{ bundled: { agentsDir: bundledAgentsDir(), version: bundledPluginVersion() } }`, so
  a **dev checkout** resolves the `maestro` plugin's templates even when no marketplace ever
  installed it. Every other plugin falls through to `~/.claude/plugins/installed_plugins.json` —
  which is exactly what the terminal reads, so both paths compare against the same files.

## The terminal side

`maestro-agent-forks.cjs`: `list [--json]`, `diff <agent>`, `update|keep|detach <agent>`.
`list` and `diff` write nothing; the other three each touch one agent after the user has answered.
It loads its lib defensively — a missing `lib/maestro-agent-sync.cjs` means the project's copied
runtime predates the file, which is a real answer (*run `/maestro-update`*) and not a stack trace,
the same shape `maestro-check-runtime.cjs` uses.

Where each caller puts it — note only one of the two is a skill:

- **The `maestro-step0` hook** (`UserPromptExpansion` matcher `maestro`, `PreToolUse` matcher
  `Skill`) — not the CLI at all: it `require`s `computeAgentSync` from the bundle directly. When
  `summary.diverged` is non-empty it injects **one line** naming those agents and telling the model
  to carry on; when it is empty it says nothing whatsoever. It must not block a workflow to ask
  about a fork — and structurally cannot, since only the readiness half ever exits 2.
- **`maestro-update`, step 3** — the real review, and the only CLI caller left: `list`, then `diff`
  per named agent, then the user's answer applied one at a time.

The hook also calls `projectOwnsHook(__filename, cwd, event)` and stands down when the project
registers its own copy, so the plugin's copy and a project-local one cannot both report the same
diverged fork. See `installing-maestro`'s hook-arbitration sub-concept.

## Constraints that hold this together

- **The bundle must not require `node:sqlite`.** A session's `node` may predate it. This is why the
  sidecar and frontmatter helpers live in `agent-fork-record.ts` rather than `agent-fork.ts`, whose
  `copyAgentAttributeRows` writes three sqlite stores. `grep -c "node:sqlite"` on the generated
  bundle must stay `0`.
- **The bundle is generated and committed** — never hand-edit it, and re-run
  `pnpm --filter maestro build:plugin-libs` after touching anything in its import graph. See
  `plugin-libs-parity`; the build fails quietly, and the symptom is the terminal quietly running last
  month's rule.
- **The diff is computed once, in `src/core/diff.ts`.** Main ships `DiffLine[]` to the renderer,
  which colours it; `unifiedDiffText` renders the same array for a terminal. A renderer-side differ
  would be a second thing that can disagree about what "diverged" looks like.
- **Three files are copied into the project** — `.claude/scripts/maestro-agent-forks.cjs` and
  `.claude/scripts/lib/maestro-agent-sync.cjs` (`STATIC_ASSETS`, copied under their own names), plus
  `.claude/scripts/maestro-step0.cjs` (a `HOOK_SCRIPTS` entry, so it gets the `.js` → `.cjs`
  rename). `/maestro-update` invokes the CLI by `$CLAUDE_PROJECT_DIR` path; the hook is run by the
  harness off its **registration**, so the install has to merge two entries into the project's
  `.claude/settings.json` as well as copy the file.
- **The delivery argument inverted in `0.4.0`, and the new failure is silent.** The fork check used
  to be prose inside the `Maestro:STEPS` managed region, reaching a project on a template sync. It
  is now a hook, so it arrives like every other Maestro hook: project-local registration on a
  re-install / `/maestro-update`, or the plugin's `hooks.json` on a version bump and re-pull. The
  cost is that a project whose runtime predates `maestro-step0` and has not updated gets **no fork
  check and no notice that one didn't happen** — the orchestrator no longer carries a fallback. An
  accepted trade, not an oversight. See `updating-maestro`.
