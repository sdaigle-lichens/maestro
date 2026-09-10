# Staleness and refresh

"Is this project current?" has **three different answers**, computed in different places for
different callers. Reaching for the wrong one is the usual mistake.

| Answer         | Where                               | Cost                               | Used by                            |
| -------------- | ----------------------------------- | ---------------------------------- | ---------------------------------- |
| Content hash   | `installStatus()` → `runtimeDigest` | reads every asset, both sides      | the app's install page             |
| Version string | `refreshStaleRuntime()`             | one config read + a string compare | project selection, automatically   |
| Readiness      | `maestro-check-runtime.cjs`         | six ordered checks                 | the `maestro-step0` hook, inside a session |

## The content hash

`runtimeDigest()` hashes the manifest in order, mixing in **each destination path** and either the
file's bytes or the literal `absent` — so an incomplete install can never hash equal to a complete
one, and moving a file changes the id. `HOOK_REGISTRATIONS` is folded in too: **adding a hook
without touching a script still makes every installed project out of date**, which it should.

`installStatus()` reports the pieces separately as well (`scriptsMissing`, `scriptsOutOfDate`,
`hooksMissing`, `orchestratorSkillOutOfDate`) so the UI can say _what_ is stale. `stale` is only ever
true for a project that is `installed` — a project with nothing is not stale, it is absent, and that
distinction is what keeps the install button from becoming an update button.

Decided **by content, not by modification times**; there is a test asserting exactly that.

## The version stamp, and the auto-refresh

`installRuntime` stamps `plugin.json`'s version into `maestro.json` as `runtimeVersion`, **last** —
after the files it describes are current. `refreshStaleRuntime()` is the cheap trigger built on it:
a project already current costs one config read and a string compare, with **zero** reads of the
runtime assets.

Two deliberate refusals, both because it fires on project _selection_ rather than a button press:

- **It never installs fresh.** A project with no runtime is what the install button is for;
  auto-triggering would install Maestro into every repo the user happens to open.
- **It uses a raw parse**, not `readConfig()`'s blank-on-corrupt fallback. Treating "the file is
  corrupt" as "a legitimately empty v3 config" would silently rewrite a user's damaged graph just
  because they opened the project.

## The readiness check

`maestro-check-runtime.cjs` answers a different question — _can this project orchestrate right now,
and if not, which ONE command fixes it?_ It returns `action` (`continue` / `install` / `update`) and
`instruction`, the sentence to obey. **The collapse from many states to three lives in code on
purpose**: prose that re-derives it is re-read at the top of every orchestration, costs tokens on
the healthy run too, and getting it subtly wrong either blocks a healthy project or lets a broken
one run.

That argument was followed all the way: the check is no longer prose at all. `checkRuntime()` is
`require`d by the `maestro-step0` hook, so the healthy answer costs **nothing** — no tool call, no
output, no tokens — and `install` exits 2 and genuinely blocks, which prose could only ask for. The
orchestrator template has no readiness step left to run. The `require.main` CLI still prints the
same JSON, for a **person** debugging a project by hand.

Six checks, cheapest and most fundamental first:

1. `.claude/maestro.json` exists and is v3 → else `install`
2. It actually configures workflows → else `install`
3. The orchestrator skill is on disk → else `install`
4. Every script in `SKILL_INVOKED_SCRIPTS` is present in `.claude/scripts/` → else `update`, with
   the reason naming the missing file (`032`)
5. Its `<!-- Maestro:HANDOFFS -->` table matches what `maestro.json` renders to **today** → else `update`
6. The stamped `runtimeVersion` matches the plugin the marketplace last pulled → else `update`

**Check 4 is new and it guards an abort, not a degradation** (`032`). `SKILL_INVOKED_SCRIPTS` is the
set the orchestrator invokes **by `$CLAUDE_PROJECT_DIR` path** rather than through a hook:
`maestro-step1-gates.cjs`, `maestro-set-session-workflow.cjs`, `maestro-task-status.cjs`. It is a
list rather than the one script `032` added because the failure shape is identical for all three and
one loop costs nothing. The gates script is the sharpest case: its call is an injected
the `!`-prefixed command-injection syntax with no `|| true`, so `node` on an absent file exits 1 and takes the entire
`/maestro` invocation with it before the model sees a word. This nag is the only thing standing
between a half-installed project and that abort — which is also why it must stay an `update` and
never become an `install`.

**Check 5 is the one nothing else catches.** The orchestrator routes work by reading that table, so
a hand-edited `maestro.json` whose table was never re-rendered sends work down a path that is not
the configured one — silently, and forever. `handoffTable()` is imported from the renderer rather
than reimplemented, so the comparison cannot drift from what a re-render would produce.

Files: `apps/maestro/src/core/install.ts` (`runtimeDigest`, `installStatus`, `refreshStaleRuntime`),
`plugins/maestro/scripts/maestro-check-runtime.cjs`.
