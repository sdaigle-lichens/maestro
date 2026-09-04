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

## Acceptance criteria

- [ ] A project-local copy of `maestro-inject-agent-context` resolves an agent's global report
      default — proven by a test that runs the hook from a `<project>/.claude/scripts/` layout, not
      from the plugin directory
- [ ] Every `require("./lib/…")` reachable from a `HOOK_SCRIPTS` entry resolves from the copied
      layout; the audit's result is written down even where it found nothing
- [ ] `apps/maestro/src/core/install.ts` and `plugins/maestro/scripts/maestro-install.js` agree, and
      the app-vs-plugin install parity test covers the change
- [ ] `plugins/maestro/.claude-plugin/plugin.json` is bumped — a patch, per
      `.claude/skills/updating-maestro/`

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
