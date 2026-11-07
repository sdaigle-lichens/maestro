# Workflow drift report

`maestro-install.js` seeds `maestro.json` only when the file is absent, because an existing config
is the user's own graph. So a project never learns that a seed workflow (`default`, `tdd`,
`Refactor`, `Documentation`, `Review`, `Tests`) changed in a newer plugin version. The drift report
tells it, and tells which of the project's own workflows were edited.

**It is read-only.** `.claude/scripts/maestro-workflow-drift.cjs` writes nothing: no change to
`maestro.json`, no orchestrator re-render, and there is no `--apply` flag. It exits 0 under every
input, including a missing or unparseable `maestro.json` (`checked: false`).

## What it compares

It builds the seed with `defaultV3Config` (the same builder a fresh install uses, from
`lib/maestro-seed.cjs`), using the project's own implementation agents and referenced skills so
node ids and agent names line up. Workflows are matched **by name, case-insensitively**: the
project's keys are numeric strings, so the key is not the identity. Positions and label offsets are
layout and are ignored.

**Referenced skills are deliberately not compared.** A real install seeds each instance's
`referenced_skills` from the project's own tag and skill maps, so the seed builder is given the
project's own lists. Comparing them would flag every freshly installed project as drifted. Only an
instance's loaded skills and a skill node's skill are compared.

**The design-check skill node is not a difference only when it is removed with its edges rewired.**
Whether the seed has it depends on whether that skill is visible when the install runs, not on the
workflow's shape. The seed takes the skill from the project's own `Refactor` skill node (if it has
one), and a skill node is matched by its skill, not its node id, so a shorter or namespaced id is
not a change. If the node is removed but its edges are left unwired, the edges through it are
reported as `differs`.

**Two workflows with the same name (case-insensitively) in one project are not both compared.** The
first is compared and the second is skipped without a line in the report.

| Verdict | Meaning |
|---|---|
| `identical` | Same nodes, edges and skills as the seed workflow. |
| `differs` | Detail follows: nodes added or removed, edges added, removed or retargeted (with condition labels), changed loaded skills or skill node. |
| `missing-in-project` | A seed workflow the project does not have. Information only. |
| `project-only` | A project workflow with no seed counterpart. Information only. |

Nodes and edges are named by agent and node name, for example
`reviewer -> refactor [FAIL: code pattern violation or code redundancy]`.

## Applying a change

The report ends with how: open the workflow in the Maestro app's workflow view, or run the
`update-workflow` skill with the wanted change. It never offers to overwrite.
