# Report how far each workflow has drifted from the seed in maestro-update

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`maestro-update` refreshes the runtime scripts, the orchestrator skill regions, report and handoff templates, and forked agents, but it never looks at the workflows in `.claude/maestro.json`. That is deliberate: `maestro-install.js` seeds `maestro.json` only when the file is absent, because an existing config is the user's own graph (see the comment above the `seededConfig` block). The consequence is that a project never learns that the seed's `default`, `tdd`, `Refactor`, `Documentation`, `Review` or `Tests` workflow changed in a newer plugin version, and cannot tell which of its own workflows were edited.

Add a read-only drift report. It compares each project workflow with the workflow of the same name in the seed (`defaultV3Config` in `plugins/maestro/scripts/lib/maestro-seed.cjs`) and prints what differs. It writes nothing: no change to `maestro.json`, no re-render of the orchestrator. Applying a change stays a user decision, through the Maestro app's workflow view or the `update-workflow` skill.

### Behavior

1. A new script, for example `maestro-workflow-drift.cjs` in the plugin's `scripts/`, copied to the project's `.claude/scripts/` by the installer like the other runtime scripts. It builds the seed with `defaultV3Config` using the project's own agent instances (so node ids and agent names line up), then compares workflow by workflow.
2. Match workflows by name, case-insensitively (the project's keys are numeric strings such as `"0"` and `"5"`, so the key is not the identity). A seed workflow absent from the project is reported as missing, and a project workflow with no seed counterpart as project-only. Neither is a problem, only information.
3. For a matched pair, report in terms a user can act on, not as a raw JSON diff:
   - nodes added to or removed from the seed's shape, by agent and node name;
   - edges added, removed or retargeted, with their condition labels;
   - changes to a node's loaded or referenced skills.
   Layout fields (positions) are ignored.
4. A verdict per workflow: `identical`, `differs`, `missing-in-project`, `project-only`.
5. The output is one line per workflow plus the detail for those that differ, and ends with how to apply: open the workflow in the Maestro app, or run the `update-workflow` skill with the wanted change. The script never offers to overwrite.
6. `maestro-update` runs the script after the existing steps and puts a short summary in its report. It stays out of the way: when every workflow is `identical` or `project-only`, it adds a single line.
7. Exit code is 0 in every case, like `maestro-stale-refs.cjs`, and the output is machine-readable JSON with a human summary line, so a later step can reuse it.

## Acceptance criteria

- [ ] The script compares each project workflow with the seed workflow of the same name and writes nothing to `maestro.json` or any other file.
- [ ] Workflows are matched by name, not by key, and position data is ignored.
- [ ] It reports added and removed nodes, added, removed and retargeted edges with their condition labels, and skill changes, in terms of agent and node names.
- [ ] It reports `identical`, `differs`, `missing-in-project` and `project-only` correctly, covered by tests on a seeded config, a config with one edge changed, a config with a node removed, and a config with an extra workflow.
- [ ] `maestro-update` runs it and reports a one-line summary when nothing differs, and the detail when something does.
- [ ] The installer copies the script to `.claude/scripts/` and `maestro-update` calls it by that path in the exact form the sandbox allow-list expects; any needed entry is added to `maestro-sandbox-allow.cjs` and documented.
- [ ] The `maestro-update` skill and its references describe the report and say it is read-only.
- [ ] The plugin version gets a bump, and the parity test and full verify pass.

## Touched surfaces

- plugins/maestro/scripts/maestro-workflow-drift.cjs (new)
- plugins/maestro/scripts/maestro-install.js (copy the script into the project)
- plugins/maestro/scripts/maestro-sandbox-allow.cjs (only if the new command needs an entry)
- plugins/maestro/skills/maestro-update/SKILL.md
- plugins/maestro/.claude-plugin/plugin.json (version)
- tests for the new script

## Notes

- The immediate use is acces-portail-email, whose `default` (7 nodes, 16 edges) and `Tests` (6 nodes, 10 edges) workflows have not been compared with the seed. After this lands, the project will run the report and apply whatever it wants by hand.
- Do not auto-apply, and do not add a `--apply` flag: the config is the user's graph.
- Reuse the seed builder rather than restating the seed workflows, so the report cannot drift from what a fresh install would write.
