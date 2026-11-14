# Use just commands

Always run the `just` recipes below, never the tools they wrap: a hook denies the direct call. Run `just` from the repository root; run `just --list` to see them all.

| Recipe | Use it to | Instead of |
| ------ | --------- | ---------- |
| `just install` | Install workspace dependencies | `pnpm install` |
| `just dev` | Run the desktop app in dev mode | `pnpm dev` |
| `just start` | Build and preview the desktop app | `pnpm start` |
| `just build` | Build every package and app | `pnpm build` |
| `just plugin-libs` | Regenerate `plugins/maestro/scripts/lib/*.cjs` from `plugin-entries/*.ts` | `pnpm --filter maestro build:plugin-libs` |
| `just lint` | ESLint across every package plus the plugin scripts | `pnpm lint` |
| `just check` | Prettier check across the repo | `pnpm check` |
| `just typecheck` | Type-check every package | `pnpm typecheck` |
| `just test` | Run every package's tests | `pnpm test` |
| `just verify` | lint + check + typecheck + test | `pnpm verify` |
| `just format` | Write prettier formatting | `pnpm format` |
| `just design-studio` / `just design-studio-down` | Start / stop the local design studio (Docker) | `docker compose ... up\|down` |

- Not covered, still run directly: `pnpm --filter <pkg> ...` (a single package's script), `pnpm exec <tool>` (e.g. one vitest file), `pnpm refresh:runtime`, and `docker compose ... exec|logs|ps`.
- `apps/maestro/` has its own justfile; its recipes are listed in `apps/maestro/.claude/rules/use-just-commands.md`.
- No recipe fits? Say so and ask before running the raw tool; don't work around the hook.
