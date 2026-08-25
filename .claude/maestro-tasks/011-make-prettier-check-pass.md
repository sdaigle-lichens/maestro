# Make prettier --check pass across the workspaces

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

`prettier --check .` currently fails in three of the four workspaces that run it — `apps/maestro`
(45 files), `packages/maestro-core`, and `apps/ai-tools-manager`. Only `apps/help-server` passes.
A `check` script that has never passed is not a check; nobody runs it, and it cannot be wired into
anything that would keep it from rotting further.

The failures are not all the same kind, and the difference matters more than the file count:

**Build output and generated files are being linted.** Sixteen of maestro's forty-five are
compiled bundles under `out/renderer/assets/`, plus the router's generated `routeTree.gen.ts`.
There is a root `.prettierrc` but no `.prettierignore` at all, so prettier walks build artifacts
and generated code and reports them as style violations. Reformatting either is pointless —
artifacts are rebuilt and generated files are rewritten by their generator. This is the prefactor:
fix what is in scope before formatting anything, or the second run reintroduces the noise.

**The rest is genuinely unformatted source**, authored before anyone ran the checker.

Formatting is a mechanical change, so the risk is not in the diff — it is in burying real changes
under it and in reformatting code that is about to move. Keep the ignore-scope change separate
from the bulk reformat so each is reviewable on its own.

Finish by making the check enforceable rather than merely passing: a `check` that passes today and
is run by nobody is back where it started within a month. Wire it into whatever already runs
`typecheck` and `test` for these workspaces.

## Acceptance criteria

- [ ] `prettier --check .` passes in every workspace that defines a `check` script
- [ ] Build output directories and generated files are excluded from formatting rather than
      reformatted — a fresh build followed by `check` still passes
- [ ] The exclusion is configured once at the level that covers all workspaces, not duplicated
      per app
- [ ] The scope change and the bulk reformat are separable in review, so the mechanical diff does
      not hide the decision
- [ ] No behavioural change: type checking and every existing test suite pass unchanged afterwards
- [ ] `check` runs alongside the existing `typecheck`/`test` tasks, so a regression fails rather
      than accumulating silently

## Blocked by

- `010-fold-maestro-core-into-the-app.md`

`packages/maestro-core`'s sources move into the Maestro app in that task. Formatting them in place
first means formatting them twice and inflating a rename commit the plan requires to be a pure
move.
