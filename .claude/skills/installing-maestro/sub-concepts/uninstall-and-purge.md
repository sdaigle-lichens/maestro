# Uninstall and purge

`uninstall.ts` is install's mirror and is **deliberately not symmetrical with it**: install writes
files the app owns, uninstall deletes files the _user_ may have hours of work in.

## The two levels are the contract

**Default** — removes the registered hooks and the ephemeral session files, and **keeps
`maestro.json`**. Someone who wants the hooks to stop firing has not asked to throw away their
workflow graph and rule assignments. It also clears a legacy `agent: "maestro"` key older installs
left behind.

**`--purge`** — additionally removes the orchestrator skill (and any `SKILL.md.bak` the
managed-region migration left), the copied runtime scripts, and `maestro.json`. It does **not**
remove `.claude/handoffs/` — since `033` that directory holds the user's own tracked protocol
overrides, which are workflow content in the same sense `maestro.json` is.

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

**Since `060` the terminal skill asks about all three surviving directories, one at a time, not
just the task queue — the app's side of this is unchanged.** `.claude/reports/` and
`.claude/handoffs/` used to be mentioned in the purge report and nothing more, so a user reading it
couldn't tell "deliberately never deleted" from "forgot to ask". `maestro-uninstall.js` gained two
more independent, purge-gated flags — `--delete-materialized-reports` and
`--delete-materialized-handoffs` — matching the shape `--delete-maestro-tasks` already had: each
requires `--purge`, each is refused without it, and the script still prompts for none of them — the
`maestro-uninstall` skill asks per directory (skipping one that is empty or absent, and never
folding the three into one all-or-nothing question) and passes only the flags the user agreed to on
one follow-up run. This is deliberately **terminal-only**: `uninstallRuntime()`'s `UninstallOptions`
still carries only `deleteMaestroTasks`, and the two directories remain exactly what the header
above already said — never touched by the app, at either level. The app's confirmation dialog was
not the gap this closed; the terminal report reading like a silent omission was.

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
that release shipped. Anything else in `.claude/scripts/` is the user's.

**The `.claude/templates/handoffs/` half of the sweep is now purely archaeological.** `033` stopped
installing that directory, so on a project installed by `0.4.2` or later it matches nothing. It
stays because a project installed by `0.4.1` or earlier still has ~23 orphaned files there and
nothing else would ever remove them. Don't read its presence in `uninstall.ts` as evidence that
something still writes there — only `uninstall.ts`'s header says why it survives.

**`.claude/handoffs/` is never touched, and the reason changed.** It used to be untouched because
nothing installed it; now install *does* materialise it, and it is still untouched because those
files are the user's opinion — a hand-edit is tracked as `staleCustomized` rather than overwritten,
and deleting them on a purge would throw away exactly what `syncedFrom` exists to protect.
**`.claude/reports/` is the same story and was undocumented until `059`** — `uninstall.ts`'s header
comment now explains both directories side by side rather than leaving the omission looking like an
oversight.

**A purge deletes `maestro.json`, which deletes every `syncedFrom` tracking entry — but not the
materialized files themselves, and that used to freeze them (`059`).** With the config gone, both
directories' files looked `untracked` to `decideSync` on the next install, and `untracked` answered
`unchanged` unconditionally: a reinstall never refreshed a purged project's reports or handoffs
again, silently, because nothing about a purge said so and nothing about a plain reinstall reported
it either. The fix is a sixth `decideSync` verdict, `adopt` — an untracked file whose content matches
the current template or a recorded prior version is retracked and rewritten to current rather than
left alone forever. See `agent-fork-sync`'s shared-decision sub-concept for the verdict itself.
**A purge now also *reports* what it is about to leave behind**, the same way it already reports
`maestroTasks`: `UninstallPlan`/`UninstallReport` gained `materializedReports` and
`materializedHandoffs` (`{ dir, files }`), populated at every uninstall level by a new
`findMaterializedFiles()` helper — informational only, nothing deletes on the strength of it.

`purgeTargets()` returns the list **most consequential first**, and that ordering is functional
rather than cosmetic: it is what the confirmation renders. With `maestro.json` last it would sit
below the fold of the scroll box — the one file the user cannot get back. The list is far shorter
than it was (an install writes 17 files, not ~37), but the ordering rule is unchanged.

**`maestro-uninstall.js` used to re-type both halves of this by hand, and fell behind (`060`).**
Its hook-script list was a hardcoded array last touched before `maestro-agent-forks.cjs`,
`maestro-resume-target.cjs`, `maestro-step1-gates.cjs` and `maestro-step4-gate.cjs` existed, and its
purge-target list was a second hardcoded array with the same four missing — so a purge on a
current-release project reported `removedHooks: false` and "nothing to purge" for work it had
simply never looked for, silently. The fix ports the app's own reasoning rather than adding the
four entries by hand (which would only restore parity until the fifth asset): `maestro-uninstall.js`
now `require`s `HOOK_REGISTRATIONS` and `runtimeAssets` straight out of `maestro-install.js` — no
second manifest to fall behind — and carries its own `looksAppInstalled()`, the same narrow
`maestro-`/`bash-validation.sh` predicate `uninstall.ts` uses, over a **recursive** sweep of
`.claude/scripts/` (so `lib/*.cjs` orphans are caught too) plus `.claude/templates/handoffs/`.
`maestro-install.js`'s manifest data (`HOOK_REGISTRATIONS`, `STATIC_ASSETS`, `runtimeAssets`) is
therefore importable with no side effect — everything that reads or writes a project in that file
runs only behind `require.main === module`, which is what makes requiring it from
`maestro-uninstall.js` safe. Hook removal keys on the same basename-inside-the-command match
`hasHook()`/`uninstall.ts`'s `maestroScriptIn()` use, ported in full (a regex extraction compared
against the exact basename) rather than the substring `.includes()` test the old script used, so a
user's own `maestro-session-log-wrapper.cjs` still can't be claimed by
`maestro-session-log.cjs`.

Files: `apps/maestro/src/core/uninstall.ts`, `plugins/maestro/scripts/maestro-uninstall.js`,
`plugins/maestro/scripts/maestro-install.js` (source of the manifest the uninstaller requires),
`plugins/maestro/skills/maestro-uninstall/SKILL.md`. Test: `test/core/uninstall.test.ts`,
`test/core/uninstall-plugin-script.test.ts`.
