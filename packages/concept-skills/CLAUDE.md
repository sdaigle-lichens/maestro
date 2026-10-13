# @repo/concept-skills

The TypeScript behind the opt-in `concept-skills` plugin (`plugins/concept-skills/`): concept-skill
discovery, metadata stamping, the repo-level `concept-skills.json` state and its `agents` list.
Framework-free, `fs` only. Maestro the app does not depend on it.

```bash
pnpm --filter @repo/concept-skills build:plugin-lib   # regenerates plugins/concept-skills/scripts/lib/concept-skills.cjs
pnpm --filter @repo/concept-skills test
pnpm --filter @repo/concept-skills typecheck
```

Never hand-edit the generated lib. Any change under `plugins/concept-skills/` bumps that plugin's
`.claude-plugin/plugin.json` version (see `.claude/rules/plugin-publishing.md`). The developer
documentation is the `concept-skills-system` skill.
