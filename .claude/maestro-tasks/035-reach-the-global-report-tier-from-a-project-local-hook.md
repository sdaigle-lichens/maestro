# Reach the global report tier from a project-local hook

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`maestro-inject-agent-context.js` resolves an agent's report across two tiers — the project's
`.claude/reports/<agent>.md`, then the global row in `~/.claude/maestro-report-defaults.sqlite`. The
global read goes through the generated bundle:

```js
const { readAgentReportDefault } = require("./lib/maestro-report-defaults.cjs");
```

wrapped in a try/catch, because `node:sqlite` needs `node` >= 22.5.

**`lib/maestro-report-defaults.cjs` is not in `STATIC_ASSETS`.** The install copies four libs —
`maestro-session`, `maestro-tasks`, `maestro-skill-regions`, `maestro-agent-sync` — and that is not
one of them. So from the project-local copy of the hook at `<project>/.claude/scripts/`, the
`require` resolves nothing, the try/catch swallows it, and **the global report tier is silently
unreachable**. The plugin's copy of the same hook, running from the marketplace cache, finds the lib
beside itself and resolves the report correctly.

The failure is therefore invisible *and* inconsistent: which copy of the hook won the arbitration
decides whether an agent gets its report at all. A project that has a `.claude/reports/<agent>.md`
never notices; one relying on the global default gets no output-format block and no error.

This was found while closing `033`, whose handoff tier has the **same** shape by design — but there
the seed constant ships inside `maestro-session.cjs`, so a missing sqlite bundle degrades to the
shipped protocol rather than to nothing. Reports have no seed tier, which is what makes this one a
bug rather than a design choice. See `033`'s divergence 7.

### Pick one of two fixes, and say why

- **Copy the lib.** Add `scripts/lib/maestro-report-defaults.cjs` to `STATIC_ASSETS` in **both**
  `apps/maestro/src/core/install.ts` and `plugins/maestro/scripts/maestro-install.js`. Smallest
  change; costs one more copied file and moves `shippedRuntimeId`, so every installed project
  reports stale once.
- **Resolve the lib from the plugin root.** Have the hook try `./lib/…` and then
  `$CLAUDE_PLUGIN_ROOT/scripts/lib/…`. No new asset, but it only works when the plugin is installed,
  which a project-local install does not require.

The first matches how `maestro-agent-sync.cjs` was handled in `031` for exactly this reason, and is
the expected answer unless the second turns out cheaper.

Whichever is chosen, the audit is the point: **check every `require("./lib/…")` in every
`HOOK_SCRIPTS` entry against `STATIC_ASSETS`** and record the result, because this class of bug is
one missing manifest line and it fails silently every time.

## Acceptance criteria — all met

**Option 1 was taken ("copy the lib"), for the reason this page gives**: it matches how `031`
handled `maestro-agent-sync.cjs`, and option 2 (resolving from `$CLAUDE_PLUGIN_ROOT`) only works
when the plugin is installed, which a project-local install does not require.

Suite: **841 tests / 43 files, all passing**. `pnpm --filter maestro typecheck` clean, Prettier
clean on all four changed files. No `src/core/plugin-entries/` source was touched;
`pnpm --filter maestro build:plugin-libs` was run anyway and produced **no diff** under
`plugins/maestro/scripts/lib/`.

- [x] A project-local copy of `maestro-inject-agent-context` resolves an agent's global report
      default — proven by a test that runs the hook from a `<project>/.claude/scripts/` layout, not
      from the plugin directory
      — new describe in `test/core/install.test.ts` › "the installed hooks actually run" ›
      **"global report defaults, from the project's own copy of the hook"**, three tests:
      *"resolves an agent's global report default"*, *"emits nothing at all when the copied lib is
      missing, without failing the hook"* (the pre-`035` state, which is what makes the first one
      mean something), and *"still prefers a project override over the global row"*. The agent name
      is `docsmith`, in no fixture's `agents_available`, so the report sync materializes no
      `.claude/reports/docsmith.md` and the project tier cannot be what answers — the real case
      being an agent used outside Maestro's routing. `runHook` already points `HOME` at the test's
      tmp dir, so the store the hook opens is `<tmp>/.claude/maestro-report-defaults.sqlite`,
      written by `writeAgentReportDefault(..., hookReportsDb())` — deliberately not `REPORTS_DB`,
      which is the install's own read.
      Also proven live, outside the suite: the **terminal** installer
      (`node plugins/maestro/scripts/maestro-install.js <dir>`, `HOME` isolated) wrote both libs
      into a scratch project and stamped `runtimeVersion: "0.4.4"`; running the copied
      `.claude/scripts/maestro-inject-agent-context.cjs` with `agent_type: "frontend"` (a seeded
      global row, no project file) injected ``Mandatory output format for the `frontend` agent``,
      and deleting `lib/maestro-report-defaults.cjs` then re-running produced **empty stdout,
      exit 0**.
- [x] Every `require("./lib/…")` reachable from a `HOOK_SCRIPTS` entry resolves from the copied
      layout; the audit's result is written down even where it found nothing
      — the table below, **and** the audit was made enforceable rather than only recorded: new test
      in `install.test.ts`'s `installRuntime` describe, *"copies every lib a copied script requires,
      including the ones inside a try/catch"*. It reads every `runtimeAssets()` entry's source,
      regex-scans for relative `require()` specifiers, resolves each against the asset's
      **destination** (the copied layout, not the plugin's), and asserts a manifest entry copies it.
      Static rather than a spawn because the failing branch sits behind a caught exception. Verified
      non-vacuous: deleting the `maestro-report-defaults` line from `install.ts` fails it with
      `.claude/scripts/maestro-inject-agent-context.cjs requires ./lib/maestro-report-defaults.cjs,
      which no STATIC_ASSET copies`.
- [x] `apps/maestro/src/core/install.ts` and `plugins/maestro/scripts/maestro-install.js` agree, and
      the app-vs-plugin install parity test covers the change
      — the two manifests carry the same two new entries, and `test/core/parity.test.ts` ›
      "STATIC_ASSETS manifest parity (source-level)" › "the app's manifest and the plugin script's
      list exactly the same files" passes over them (unchanged — it parses both manifests and
      already covered the new lines).
- [x] `plugins/maestro/.claude-plugin/plugin.json` is bumped — a patch, per
      `.claude/skills/updating-maestro/`
      — `0.4.3` → `0.4.4`. `updating-maestro` now carries it as its **seventh** worked example: a
      new *copied* file is no more a published surface than a new script under `scripts/` was in
      `0.3.5`.

## The audit, which is the point of the ticket

Every `require("./lib/…")` reachable from a `HOOK_SCRIPTS` entry, checked against `STATIC_ASSETS`:

| Copied script | requires | in the manifest? |
| --- | --- | --- |
| `maestro-inject-agent-context` | `lib/maestro-session.cjs` | yes |
| | `lib/maestro-handoff-defaults.cjs` (try/catch) | **NO → added** |
| | `lib/maestro-report-defaults.cjs` (try/catch) | **NO → added** |
| `maestro-subagent-log` | `lib/maestro-session.cjs` | yes |
| `maestro-session-log` | `lib/maestro-session.cjs` | yes |
| `maestro-validate-tasks` | `lib/maestro-session.cjs` | yes |
| `maestro-step0` | `lib/maestro-session.cjs`, `lib/maestro-agent-sync.cjs` (in-branch), sibling `./maestro-check-runtime.cjs` | yes (all three) |
| `maestro-check-runtime.cjs` (STATIC_ASSET, `require`d by step0) | `lib/maestro-skill-regions.cjs` | yes |
| `maestro-render-orchestrator.cjs` | `lib/maestro-session.cjs`, `lib/maestro-skill-regions.cjs` | yes |
| `maestro-task-status.cjs` | `lib/maestro-tasks.cjs` | yes |
| `maestro-agent-forks.cjs` | `lib/maestro-agent-sync.cjs` | yes |
| `maestro-session-cleanup.cjs` | `lib/maestro-session.cjs` | yes |
| `maestro-set-session-workflow.cjs`, `maestro-step1-gates.cjs` | none (`fs`/`path` only) | n/a |

Plugin-only scripts that are never copied (`maestro-install.js`, `maestro-uninstall.js`,
`maestro-concept-skills.cjs`, `maestro-post-mortem.js`, `maestro-apply-rules.js`) are out of scope
by construction — they run from the plugin root, where the whole `lib/` is present.

## Divergences from what this page planned

Four, each with the reason it was taken.

1. **The audit found TWO missing libs, not one.** This page names only
   `maestro-report-defaults.cjs` and argues the handoff gap is by design (the seed ships inside
   `maestro-session.cjs`, so it degrades to the shipped protocol rather than to nothing).
   `maestro-handoff-defaults.cjs` was added as well, for two reasons: (a) acceptance criterion 2
   says *every* `require("./lib/…")` reachable from a `HOOK_SCRIPTS` entry must resolve from the
   copied layout; and (b) the global handoff row is the tier `/templates`' Handoffs tab writes, and
   `syncProjectHandoffs` runs only from `installRuntime`/`refreshStaleRuntime` (`install.ts` lines
   ~629-633) and never on a config save — so a route wired in the app *after* the last install has
   **no materialized project file**, and the global row was the only tier that could have answered
   it. Degrading to the seed there silently discards the user's customization, and does so only for
   projects running their own copy of the hook. Cost is one more copied file (14 KB) in the same
   `shippedRuntimeId` move the report lib already forces.
2. **An existing `033` test changed meaning.** `install.test.ts` › "still emits the shipped seed
   with the sqlite bundle unresolvable and no project file" used to assert
   `maestro-handoff-defaults.cjs` **is not copied** and treat that as the unresolvable condition. It
   now deletes the copied lib to reach the seed. The seed fall-through is therefore **simulated** (a
   `node` older than 22.5, or a project installed by a pre-`0.4.4` runtime) rather than a property
   of the manifest — the comment above the describe says so.
3. **Both requires stay inside their try/catch.** Copying the file does not make it importable:
   `node` < 22.5 has no `node:sqlite`, and that is still the degradation path.
4. **`install.ts`'s new comment misnames the enforcing test's home** — it says
   `test/core/parity.test.ts`; the test is in `test/core/install.test.ts`. Flagged by the scribe,
   not edited (a one-word fix in application code, for whoever next touches that block).

Everything else is as planned: option 1, the patch bump, the source-level `STATIC_ASSETS` parity
test unchanged, and the once-only staleness move.

## Downstream

**Nothing.** `035` is the last file in `.claude/maestro-tasks/` — there is no later page to
reconcile against what was built here, and the queue is empty after it.

## Checked against `034` as built

Reconciled by the scribe when `034` closed. **This page is unaffected.** `034` touched neither
`STATIC_ASSETS` (in either implementation), nor `HOOK_SCRIPTS`, nor
`plugins/maestro/scripts/lib/maestro-report-defaults.cjs`, nor
`maestro-inject-agent-context.js` — so the bug described above still exists exactly as written and
the asset manifest has not moved. Two things to carry in:

- **The plugin is now at `0.4.3`**, so this ticket's bump is `0.4.3 → 0.4.4`. It stays a patch:
  adding a copied lib to the asset manifest is not a published surface. `.claude/skills/updating-maestro/`
  now carries `0.4.3` as its sixth worked example.
- **`034` added no channel this could reuse**, and did not need one: its two new IPC channels
  (`handoff:routes`, `handoff:save`) are renderer↔main, on the handoff tier, and touch no hook. It
  did, however, add a second hand-mirrored site to `plugins/maestro/scripts/maestro-install.js` (the
  `no-template` branch in its own `syncProjectHandoffs`) — unrelated to the manifest, but a reminder
  that the two installers' parity is prose in two files, not one shared module.

## Notes for whoever picks this up

Read `.claude/skills/installing-maestro/` (the manifest sub-concept) and
`apps/maestro/.claude/skills/plugin-libs-parity/` first. Note that adding an asset makes every
installed project report stale exactly once — expected, and documented in the installing-maestro
skill's "Things that bite".

## Blocked by

Nothing.
