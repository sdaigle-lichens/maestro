# Auto lint and format

A hook runs `prettier` after every Write/Edit/MultiEdit on `*.ts`, `*.tsx`, `*.js`, `*.mjs`, `*.cjs`, `*.json`, `*.css`, and `eslint` on code in `apps/maestro`, `packages/ui`, `packages/claude-fs` and `plugins/maestro/scripts`. It fixes formatting in place. Don't run them on those files: no hook message means the file is clean.

Not covered, run them yourself: files changed through Bash, markdown, `justfile`, `.claude/**` and the generated `plugins/*/scripts/lib/` bundles, type checking (`just typecheck`), tests, and a full `just lint` / `just verify` before finishing.
