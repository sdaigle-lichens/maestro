# Proposal file schema

One file per participant per round: `<meeting dir>/round-<n>/<agent>.json`, where `<agent>` is the
bare agent name (`backend`, not `maestro:backend`).

```json
{
  "agent": "backend",
  "round": 1,
  "proposals": [
    {
      "id": "backend-1",
      "kind": "skill.placement",
      "target": "instance:backend#api-conventions",
      "change": "move api-conventions from loaded to referenced",
      "rationale": "loaded on every run, needed in one of five",
      "evidence": "digest: backend read 0 files it documents in 4 runs"
    }
  ],
  "withdrawn": []
}
```

- Auto kinds need a structured field to be applied mechanically by `TM apply-placement`:
  `skill.placement` takes `"to": "loaded"` or `"referenced"`; `handoff.edit` takes `"content"`, the
  full new template text. Without it, the row is skipped by apply-placement and goes through the
  owner run (handoff.edit) or the main session (skill.placement).
- `agent.fork` takes an optional `"newName"` (kebab-case); `rule.move` takes `"destination"`, a
  project-relative directory (`"."` for the root), and optionally `"scopeOnly": true`. Both are
  applied by the main session with `maestro-agent-fork.cjs` / `maestro-rules.cjs`.
- If an id lacks the `<agent>-` prefix, the parser adds it.
- A proposal with an unknown kind, a wrong target shape or an empty `change` is dropped, and `TM conflicts` and `TM tally` report it under `errors`. The rest of the file still counts.
- Each agent's latest round replaces its earlier rounds, minus the ids it lists in `withdrawn`.

## Kinds

| kind | target | tier |
|---|---|---|
| `workflow.create` / `.update` / `.delete` | `workflow:<name>` | approval |
| `skill.create` / `.edit` / `.delete` | `skill:<id>` | approval |
| `skill.placement` | `instance:<instance>#<skill>` | auto |
| `agent.create` / `.edit` / `.delete` / `.tools` / `.fork` | `agent:<name>` | approval; edit/delete/tools of a plugin agent is blocked until an `agent.fork` is applied |
| `rule.edit` / `.delete` / `.to-agent` / `.move` | `rule:<id>` | approval; delete or to-agent of a rule listed in maestro.json is blocked (use `rule.move` or `/rules`) |
| `handoff.edit` | `handoff:<sender>/<receiver>` | auto |
| `report.edit` | `report:<agent>` | approval |
| `gate.change` | `gates` | approval |

**Conflicts:** two or more agents propose on the same target with different changes. Matching
kind and change text (ignoring case and whitespace) counts as agreement: the proposals merge into
one row with several supporters. When a target is still in conflict after round 2, every row on it
needs approval, including auto kinds.
