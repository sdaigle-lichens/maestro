# Rules slice

`MaestroRulesSlice` is just `rules: MaestroRuleV3[]` — each rule file and the scope it is assigned to
(the project root, or specific directory paths).

The slice is unusual in that saving it has a **filesystem side effect**: `saveConfig` applies the
placements, physically moving or installing each rule file into its assigned directory. The config
and the disk are meant to agree after a save, so a hand-edit to this slice without a re-apply leaves
them out of step.

Each rule carries an optional `placement?: "move" | "scope-only"`. Absent means `"move"` — the
behavior above, unchanged. `"scope-only"` scopes the rule to its assignment's `paths`/`scope`
without moving or installing anything at the target: a `source: "project"` rule's file is left
where it is (`unchanged`), and a `source: "vibe-rules"` rule installs into the **project root's**
`.claude/rules/` instead of the assigned directory's — so a directory can be scoped by a rule
without a `.claude/` ever being created under it.

Files: `src/core/types.ts`, `src/core/rules.ts`, `src/core/save.ts`.
