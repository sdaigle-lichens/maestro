# The terminal uninstall stops hand-mirroring the install manifest

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Bring the plugin's uninstall script back in line with the app's, which already solved this. The two implementations have diverged, and the terminal one leaves a partly-installed project behind.

**Observed, on this repository.** A `--purge` through the terminal path reported `removedHooks: false` — "no hooks were registered" — while `settings.json` still carried two live Maestro hook registrations, and it reported purging every script while four remained on disk: the task-routing enabler, the resume-target lookup, and the two gate scripts. Both claims were wrong in the same direction: the uninstall reported success for work it never attempted.

**Why.** The plugin's uninstall re-types by hand two lists that the install already owns. Its hook-script list is a hardcoded array that has fallen four entries behind the install's hook registrations, so an unlisted hook is not recognised as Maestro's and survives — and because the removal function reports whether it changed anything, an unrecognised hook produces a confident "nothing to remove" rather than a warning. Its purge target list is a hardcoded array of paths that has fallen behind the install's static-asset manifest the same way. Every asset or hook added since either list was last touched is an orphan by default, silently, and nothing fails when they drift.

**The app's copy does not have this bug, and is the template.** It derives its hook-script names from the install's hook registrations directly, and rather than enumerating script paths it sweeps the scripts directory for the install's own namespace plus the one file shipped under another name — so a script added by any release, including one older than the code doing the uninstalling, is still found. Port both of those, keeping the app's reasoning: the manifest covers what the current release installs, the namespace sweep covers what an older one did, and a purge needs both.

Do not fix this by adding four entries to two arrays. That restores parity for exactly as long as it takes someone to add a fifth asset, and the failure mode is silent, which is what makes it worth the structural fix.

**Two things to preserve while porting.** The hook removal must keep matching on the script basename inside the command rather than on an exact string, so a hand-requoted command is still removed — that is the same key the installer uses to decide a hook is already present. And the namespace sweep must not widen into deleting files the user put in that directory themselves; the app's predicate is deliberately narrow and its reasoning should come across with it.

**Second half: the uninstall asks about all three surviving directories.** Three directories survive a purge as the user's own content — the file-based task queue, the materialized reports, and the materialized handoffs. Today the task queue gets an explicit offer to delete it behind its own flag while the other two are mentioned in the report and nothing more, so a user reading that report cannot tell the deliberate decision from the omission.

Make the skill prompt for all three. After the purge reports what each directory holds, it asks per directory whether to delete it, and deletes only the ones the user names. Ask about each separately rather than as one all-or-nothing question — wanting to drop stale materialized handoffs while keeping a 58-file task queue is the normal case, not an edge one.

Only ask about a directory that actually has something in it; an empty or absent one is not a question worth asking. And the prompt belongs to the skill, which has a user in front of it — the script keeps taking explicit flags and must stay non-interactive, so a scripted or CI uninstall deletes nothing it was not told to. That means one flag per directory rather than the single queue-specific one that exists today, each still requiring the purge level, and the existing flag's name and behaviour preserved so an existing invocation does not change meaning.

The plugin's scripts are published surface, so this carries a `plugin.json` bump. Whether a new delete flag counts as the published surface growing is the judgement call the version rule already covers.

## Skills to use

Load these before you start — they carry what this task needs, and reading them beats
rediscovering the same thing from source:

- `installing-maestro` — the two implementations that must agree, the asset + hook manifest, and what each uninstall level removes
- `plugin-libs-parity` — the generated bundle, and why a stale one fails silently
- `updating-maestro` — which version component to bump, and why nothing reads its magnitude

## When you're done

End by handing off to the **@scribe** agent with the `scribe` skill loaded. It is the routing rule
for what belongs in a concept skill versus in `docs/`, and it has to be in context before anything
is written. `installing-maestro` documents what a purge removes and how the two implementations
stay in step, so updating it is part of the change rather than a follow-up.

## Acceptance criteria

- [ ] The plugin's uninstall derives its hook-script names from the install's hook registrations rather than a hand-maintained array, and no list of script names is duplicated between the two files
- [ ] The plugin's purge finds any `.claude/scripts/` file in the install's own namespace, including one written by a release older than the code running the uninstall, using the same narrow predicate the app uses
- [ ] Running a purge on a project installed by the current release leaves no Maestro script in `.claude/scripts/` and no Maestro hook in `settings.json`
- [ ] The four assets that survived — the task-routing enabler, the resume-target lookup, and both gate scripts — are covered by a case that would have failed before this change
- [ ] Hook matching still keys on the script basename inside the command, so a hand-requoted command is still removed
- [ ] A file in `.claude/scripts/` that the install never wrote is not deleted
- [ ] The uninstall no longer reports that hooks were absent when hooks it did not recognise are present
- [ ] The uninstall skill prompts separately for the task queue, the materialized reports and the materialized handoffs, and deletes only the ones the user accepts
- [ ] A directory that is empty or absent is not prompted about
- [ ] The script itself stays non-interactive — one explicit flag per directory, each requiring the purge level — and a run with no flags deletes none of the three
- [ ] The existing task-queue flag keeps its name and behaviour, so an existing invocation still means what it meant
- [ ] The app's uninstall behaviour is unchanged by this slice; only the plugin's copy moves
- [ ] `plugin.json` is bumped, with the component matching what a consumer sees change
- [ ] Handed off to the @scribe agent with the `scribe` skill loaded, and the concept skills this change affects are updated

## Blocked by

None — can start immediately
