# Rules slice

`MaestroRulesSlice` is just `rules: MaestroRuleV3[]` — each rule file and the scope it is assigned to
(the project root, or specific directory paths).

The slice is unusual in that saving it has a **filesystem side effect**: `saveConfig` applies the
placements, physically moving or installing each rule file into its assigned directory. The config
and the disk are meant to agree after a save, so a hand-edit to this slice without a re-apply leaves
them out of step.

Files: `src/core/types.ts`, `src/core/rules.ts`, `src/core/save.ts`.
