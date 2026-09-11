# Workflows slice

`MaestroWorkflowsSlice` carries `agents_available`, `skills_available`, `workflow_instances` and
`workflows` — written as one unit by the `/workflows` route — and, since the `/agents` redesign, by `/agents`
too, which edits one instance's `loaded_skills` / `referenced_skills` and therefore re-reads the
config immediately before writing (the merge replaces the whole block).

A **`MaestroInstanceV3`** is a reusable agent+skills pairing; it keys off the agent's frontmatter
`name`, not a fixed roster, which is what lets Maestro dispatch to any agent on the machine. A
**`MaestroWorkflowV3`** holds `MaestroNodeV3`s (which point at instances) and `MaestroEdgeV3`s (the
success and condition paths between them). `success-path.ts` turns that graph into the ordered
agent→skill sequence the orchestrator renders as its handoff table.

## A third writer, and a fourth representation

**`workflow-spec.ts`'s `applyWorkflowSpec`/`workflowToSpec` add a fourth way to produce a workflow**,
alongside a canvas save, an `/agents` skill edit, and a hand-edited `maestro.json` — and the only one
that runs outside the app process. `WorkflowSpec` (`{ name, steps, conditions? }`, in `contracts.ts`)
is a compact, declarative alternative to hand-written `MaestroNodeV3`/`MaestroEdgeV3` graph JSON:
`steps` is the success chain as step tokens in `seed.ts`'s own vocabulary (`"human_review-1"`,
`"skill:<id>"`, or a bare `workflow_instances` name), `conditions` are `{from, to, label}` edges, on
or off the success path. Applying a spec writes the exact same `MaestroWorkflowV3` shape as every
other writer — no schema change — and reuses `seed.ts`'s layout functions (`sideTracker`,
`BASE_STEP`/`PER_SKILL_STEP`, both exported for this) for node positions, handle sides and
condition-label placement rather than inventing new geometry. `workflowToSpec` is the inverse, for
showing a workflow's current spec back to a user before an `update`.

The CLI half — `plugins/maestro/scripts/maestro-workflow-spec.cjs`, invoked by the `create-workflow`/
`update-workflow` skills — is the one part of this mechanism that touches the filesystem: it does its
own `readConfig` → `applyWorkflowSpec` → `writeConfig` → re-render cycle against
`.claude/maestro.json`, entirely outside the app and its `mergeSlice`/IPC path. See this skill's own
`## Slice merges` section for how that makes it the `workflows` slice's third writer.

**Trap: renaming a condition's `label` on `update` does not preserve its prior exit side.** An
`update` re-derives each condition edge's `sourceHandle` fresh through `sideTracker` rather than
carrying over the one already on disk, so a spec that only changes a `label` (not the endpoints) can
still flip which side of the node the curve leaves from. Untested edge case as of `063`; likely
harmless, but not something to assume away if a future change adds edge-preserving behavior here.

Files: `src/core/types.ts`, `src/core/success-path.ts`, `src/core/render.ts`, `src/core/workflow-spec.ts`.
