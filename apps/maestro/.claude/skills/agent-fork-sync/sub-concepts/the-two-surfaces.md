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
  agent:sync · agent:sync:apply                        ▲
        │                                              │ require("./lib/…")
        ▼                                    plugins/maestro/scripts/maestro-agent-forks.cjs
  /maestro count · /agents review card                 │
                                          maestro (Step 0) · maestro-update (step 3)
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

Where each skill puts it:

- **`maestro` (the orchestrator template), Step 0** — runs `list`, reports the count in **one line**,
  and carries on. It must not block a workflow to ask about a fork.
- **`maestro-update`, step 3** — the real review: `list`, then `diff` per named agent, then the
  user's answer applied one at a time.

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
- **Both new files are copied into the project** (`.claude/scripts/maestro-agent-forks.cjs` and
  `.claude/scripts/lib/maestro-agent-sync.cjs`), so the orchestrator invokes them by
  `$CLAUDE_PROJECT_DIR` path and they are refreshable without a version bump. The *skills* that call
  them are not: Step 0 is a managed region, so the fork check reaches an installed project only after
  a `plugin.json` re-pull. See `updating-maestro`.
