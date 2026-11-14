# Use just commands (apps/maestro)

Always run the `just` recipes below, never the tools they wrap: a hook denies the direct call. Run `just` from `apps/maestro`; run `just --list` to see them all.

| Recipe | Use it to | Instead of |
| ------ | --------- | ---------- |
| `just dev` | Start the app in dev mode (HMR on the renderer) | `pnpm dev` |
| `just build` | Build the main/preload/renderer bundles into `out/` | `pnpm build` |
| `just start` | Build, then run the app the way a real launch does | `pnpm start` |
| `just build-plugin-libs` | Rebuild the CJS bundles the maestro plugin's hooks require() | `pnpm build:plugin-libs` |
| `just typecheck` | Type-check both tsconfig projects | `pnpm typecheck` |
| `just lint` | Prettier check, no writes (not ESLint) | `pnpm check` |
| `just format` | Fix formatting in place | `pnpm format` |
| `just test` | Run the vitest suite | `pnpm test` |
| `just verify` | typecheck + lint + test, the full pre-PR check | |

- Here `just lint` is the prettier check; ESLint is `pnpm --filter maestro lint` (or `just lint` at the repo root, which covers every package).
- No recipe fits? Say so and ask before running the raw tool; don't work around the hook.
