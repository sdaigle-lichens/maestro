# Configure maestro's code-graph concepts so subagents can explore it through the graph

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

Precondition: do not start until code-graph 0.3.2 (code-graph task 008) is installed; after updating, run `code-graph deps install` once to fill its plugin-owned typescript/ts-morph dir. That release is the fix that resolves typescript and ts-morph without relying on this repo's root node_modules (in this pnpm monorepo typescript lives only under apps/maestro, and nothing here depends on ts-morph), and that makes extract/apply skip cleanly when no concepts are configured. The code-graph epic manager reports the version. If it is not installed, stop and say so.

After the cutover, this repo uses code-graph only for concept skills: `scribe.config.json` has a `skills` block but no `concepts`, so there is no graph and subagents still explore by reading files. Give it the graph layer.

- Define graph concepts in `scribe.config.json` for the TypeScript parts of the repo (the desktop app's core, main and renderer, and the shared packages), each with its globs and a tsconfig, keyed so each concept lines up with the existing concept skill that documents it (the SKILL.md stays where it is; config and marker must agree, as `skills check` verifies).
- Run extract + apply for every concept and confirm search and concept queries return real results.
- Keep it opt-in: nothing in maestro's own code starts depending on code-graph; this is project configuration only.

## Acceptance criteria

- [ ] code-graph `skills check` reports no concept without a SKILL.md and no path mismatch
- [ ] extract + apply succeed for every configured concept, with no manual install of typescript or ts-morph at the repo root
- [ ] `code-graph search` for a known maestro term (e.g. the task queue's blockedBy cascade) returns the right concept and code
- [ ] A scribe run after a small code change inside a concept's globs flags that concept as changed and runs extract + apply instead of skipping
- [ ] No maestro source or plugin file gains a dependency on code-graph

## Blocked by

- `106-switch-this-repo-to-code-graph-and-dogfood-the-scribe.md`
