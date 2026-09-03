# Uninstall and purge

`uninstall.ts` is install's mirror and is **deliberately not symmetrical with it**: install writes
files the app owns, uninstall deletes files the _user_ may have hours of work in.

## The two levels are the contract

**Default** — removes the registered hooks and the ephemeral session files, and **keeps
`maestro.json`**. Someone who wants the hooks to stop firing has not asked to throw away their
workflow graph and rule assignments. It also clears a legacy `agent: "maestro"` key older installs
left behind.

**`--purge`** — additionally removes the orchestrator skill (and any `SKILL.md.bak` the
managed-region migration left), the copied runtime scripts, the installed handoff protocols, and
`maestro.json`.

Collapsing the two, or making purge the default, turns "stop the hooks" into silent data loss.

**On a machine with the plugin, plain uninstall stops the project's hooks and hands them back to the
plugin's copies, which keep firing.** That is the fallback, not a fault: the plugin's copy of a hook
stands down only while the project registers its own, so removing those registrations is exactly what
re-enables it. `uninstall.ts` used to warn about this and no longer does — the code carries a comment
saying why instead. `--purge` is still not the way to stop the plugin's hooks; disabling the plugin
is. See the hook-arbitration sub-concept.

**`.claude/maestro-tasks/` needs its own second opt-in** on top of `--purge` (an error without it).
That queue is user-authored content, not an install artifact. A purge _reports_ what is in it —
`uninstallPlan` carries `maestroTasks` — so the UI can show the user what a follow-up would take,
and the script never prompts: the calling skill owns that confirmation. See `task-queue`.

## Remove only our own

A hook command is Maestro's only if it points into `.claude/scripts/` **and** names a script the
install registers. Other hooks, other matchers, other events, and every non-hook key survive
untouched — a settings file emptied on uninstall is a worse bug than anything install can cause.

The pruning is equally narrow: entries and event lists are removed **only where the uninstall
emptied them**. An entry the user left empty, and an event Maestro never matched, come out exactly
as they went in. That is the difference between "removed our hooks" and "tidied the user's settings
file", and only the first is Maestro's to do.

The same preflight discipline as install: settings are parsed **before the first deletion**, so a
project whose `settings.json` doesn't parse is left exactly as it was rather than half-uninstalled.

## What a purge targets

Two sources, unioned and de-duplicated:

- **The manifest** — what the _current_ release installs.
- **A sweep** of the two directories the app owns, `.claude/scripts/` and
  `.claude/templates/handoffs/`, filtered by `looksAppInstalled()`: a basename starting with
  `maestro-`, plus the one exception shipped under another name, `bash-validation.sh`.

The sweep exists so a project installed by an **older** release isn't left with orphans of scripts
that release shipped. Anything else in `.claude/scripts/` is the user's. **`.claude/handoffs/` is
never touched** — it is the user's override location, not an install destination.

`purgeTargets()` returns the list **most consequential first**, and that ordering is functional
rather than cosmetic: a full install is ~37 files, nearly all handoff templates, and the
confirmation renders this list in order. With `maestro.json` last it would sit below the fold of the
scroll box — the one file the user cannot get back.

Files: `apps/maestro/src/core/uninstall.ts`, `plugins/maestro/scripts/maestro-uninstall.js`,
`plugins/maestro/skills/maestro-uninstall/SKILL.md`. Test: `test/core/uninstall.test.ts`.
