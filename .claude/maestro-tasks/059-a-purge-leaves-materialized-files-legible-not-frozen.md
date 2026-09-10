# A purge leaves materialized files legible, not frozen

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Fix what a `--purge` uninstall leaves behind, so a project that is purged and reinstalled does not end up with materialized files that are permanently cut off from their global defaults.

**The situation.** An install materializes two directories from the machine-wide default stores: the per-agent report bodies and the per-route handoff protocols. Which materialized copies are still in sync is recorded in the config's own `reports` and `handoffs` slices — the file on disk carries no provenance of its own. A `--purge` deletes the config and keeps both directories.

Keeping them is correct and stays. They are seeded-then-editable content, the same category as the file-based task queue, which a purge reports but refuses to delete without a second explicit flag. Nothing in this slice should start deleting them.

**The bug is what the reinstall then does.** With the config gone, every surviving file has no tracking entry, and the shared sync decision classifies a file with no entry as untracked and leaves it alone — deliberately, because a file sitting where a copy would go might be somebody else's. The consequence after a purge is that the whole directory is untracked at once, so every one of those files is silently frozen: never refreshed when its global default advances, and never reported as being in that state. The behaviour is right for a stray file and wrong for the file a previous install itself wrote.

**Distinguish the two by content.** A file whose bytes exactly match some version of its global default is one the install wrote and nobody has edited since — adopting it costs nothing, because refreshing it would produce the same bytes anyway. A file that does not match is genuinely unattributable and must keep today's leave-it-alone treatment. Make that distinction in the shared decision function rather than at either call site, so the report path and the handoff path cannot drift, and so the plugin's generated copy of the logic stays a build artifact of the same source.

Be careful about what "matches its global default" means: the stores keep a version history, and a file written by an older install matches an older version, not the current one. Decide explicitly whether adoption compares against the current version only or against any known version, and say why in the code — comparing only the current version means a project that skipped a release stays frozen, which is most of the cases this is meant to fix.

**Two smaller pieces that belong with it.**

The report directory's survival is undocumented. The handoff directory carries an explicit comment in both uninstall implementations saying it is never touched by either level and why; the report directory is simply absent from the target list, so a reader cannot tell a decision from an oversight. Give it the same comment in both places.

And a purge should say what it left. It already reports the task queue it declined to delete — file count, path, and whether it was deleted. Materialized reports and handoffs deserve the same line, so someone who purged because they wanted a clean slate can see that these two directories are still there and choose.

Both uninstall implementations and both install implementations have to move together, as always; the plugin's scripts are published surface, so this carries a `plugin.json` bump — nothing a consumer can newly do is added, so patch.

## Skills to use

Load these before you start — they carry what this task needs, and reading them beats
rediscovering the same thing from source:

- `installing-maestro` — the two install and two uninstall implementations that must agree, what each level removes, and the materialization step this changes
- `global-stores` — the report and handoff default stores, their version history, and why they are machine-wide
- `maestro-config-model` — the `reports` and `handoffs` slices that carry the tracking a purge destroys
- `plugin-libs-parity` — the generated bundle behind the shared sync decision, and why a stale one fails silently
- `updating-maestro` — which version component to bump

## When you're done

End by handing off to the **@scribe** agent with the `scribe` skill loaded. It is the routing rule
for what belongs in a concept skill versus in `docs/`, and it has to be in context before anything
is written. This changes what an uninstall level does and what a reinstall adopts — both are
documented behaviour, so updating the concept skills is part of the change rather than a follow-up.

## Acceptance criteria

- [ ] A purge still keeps `.claude/reports/` and `.claude/handoffs/`; nothing in this slice deletes either, at either uninstall level
- [ ] The shared sync decision adopts an untracked file whose content matches a known version of its global default, and continues to leave an untracked file that matches nothing alone
- [ ] Whether adoption compares against the current default version or any historical version is decided explicitly and the reasoning is stated in the code
- [ ] A purge followed by a reinstall leaves the surviving report and handoff files tracked again, and a later advance of a global default refreshes them rather than skipping them
- [ ] A hand-edited file that survives a purge is not adopted, is not overwritten, and reaching this state is covered by its own case
- [ ] Both uninstall implementations carry an explicit comment on `.claude/reports/` matching the one `.claude/handoffs/` already has
- [ ] The purge result reports the materialized report and handoff directories it left behind, in the same shape as the existing task-queue report
- [ ] The app and plugin implementations agree, the generated bundle is rebuilt from source rather than hand-edited, and `plugin.json` is bumped patch
- [ ] Handed off to the @scribe agent with the `scribe` skill loaded, and the concept skills this change affects are updated

## Blocked by

None — can start immediately
