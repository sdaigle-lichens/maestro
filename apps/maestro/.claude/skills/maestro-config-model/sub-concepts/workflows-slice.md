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

Files: `src/core/types.ts`, `src/core/success-path.ts`, `src/core/render.ts`.
