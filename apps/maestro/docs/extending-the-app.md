# Extending the app: adding a route, a tab, or a doc page

Developer how-to for three common additions to the Maestro desktop app. See `apps/maestro/CLAUDE.md`
for the process layout (`src/core`/`src/main`/`src/preload`/`src/renderer`/`src/shared`) these steps
assume, and the `create-skills-architecture` concept skill for how the four `create-*` routes work
end-to-end once one exists.

## Adding a create-\* route (a fifth `create-*` form)

1. Create `src/renderer/src/routes/<name>.tsx` mirroring `create-plugin.tsx` (no mode) or
   `create-skill.tsx` (auto/manual + target). Define the zod schema, wire `useForm` + `Controller`,
   render with `Field`/`Input`/`Select`/`ChipInput` from `@repo/ui`, and wrap it in `create-shell`.
2. Add a `scaffold<X>` function to `src/core/scaffold.ts` and a prompt builder to `claude-preview.ts`.
   Both must resolve the path through `resolveCreateTarget`.
3. Create the preview component under `src/renderer/src/components/`.
4. Add the channel to `src/shared/ipc.ts` and the handler to `src/main/ipc.ts` — the renderer must
   never touch `fs`.
5. Write the consuming prompt at `plugins/maestro/skills/<name>/SKILL.md`, documenting the payload
   shape and the file(s) Claude should finish.

A create-\* route is reached from the **Create** link at the bottom of its matching `/tools` tab
(`components/tabs/create-link.tsx`), not from a top-bar menu, and its prompt reaches Claude through
the Claude bridge (`claude-session-bridge` in `apps/maestro/.claude/skills`).

Each of the four existing forms follows one pattern, worth matching rather than reinventing per
route:

- **State**: `react-hook-form` + `zod` (via `@hookform/resolvers/zod`). The schema lives at the top
  of the route file; the inferred type drives `useForm<T>`.
- **UI primitives**: `@repo/ui` — `Button`, `Field`, `Input`, `Textarea`, `ChipInput`, `Select`,
  `ModePill`, `ThemeToggle`, `ShortcutsDialog`, `FilePreview`, `SyntaxLine`. Icons from
  `lucide-react`.
- **Layout**: split pane — form left, live `FilePreview` right showing the file that will be
  generated. Per-route preview components compose `FilePreview` with their own `lines: string[]`.
- **Submit feedback**: the window is long-lived and the user creates repeatedly, so a form is never
  replaced by a terminal success view. Each submit fires a `toast` (`@repo/ui/toast`) and the route
  stays mounted; the create forms `reset()` for the next artifact.
- **Keyboard shortcuts**: ⌘N (jump to field), ⌘↵ (submit), `?` (help), Esc (close). The map lives in
  the route and is rendered by `create-shell.tsx`.
- **`target` toggle (skill & subagent only)**: a second `ModePill` picks `marketplace` or `project`.
  In project mode the marketplace/plugin selectors are hidden and the file is written under
  `<projectRoot>/.claude/`.

## Adding a tab to `/tools`

Four of the five steps are in `src/core/` and `src/main/`; only the last is a component.

1. Write the read in a `src/core/*.ts` module, taking `projectRoot` as an argument — never
   `process.cwd()` — so the dashboard works against a project that is not this one.
2. Put the type it returns in `src/core/contracts.ts` (interfaces only) and widen `ToolsData`.
3. Fold it into the **existing** `data:tools` handler in `src/main/ipc.ts` rather than adding a
   channel, so all tabs share one round trip.
4. Add the component under `src/renderer/src/components/tabs/` and an entry to `TABS` in
   `routes/tools.tsx`.

Unless the tab **runs something** — then it is not loader data at all, and needs a preview/run
channel pair and a purpose-tagged token, the way `/tools`' Usage Stats tab does for `ccusage`.

## Adding a doc page

Two different ways, depending on which reader:

- **`/project-docs`** (the open project's own docs): drop a `.md` file into the open project's
  `docs/`. The slug is the filename; `listDocs()` and `searchDocs()` in `src/core/docs.ts` pick it up
  with no registration anywhere. Heading anchors come from `slugifyHeading()`, which the search index
  and the reader must go on sharing — a second slugifier means search hits that scroll nowhere.
- **The global `/docs` reader** (unrelated to the open project): drop a `.md` file into
  `apps/maestro/docs/app/` for the `"app"` group (Maestro's own **end-user** docs — see the root
  `CLAUDE.md`'s publishing rule for why developer-facing material may not live there), or the
  repo-root `docs/` for the `"claude-code"` group (synced into a packaged build by
  `scripts/sync-claude-docs.mjs`). `globalDocsData()`/`readGlobalDoc()` in `src/core/global-docs.ts`
  pick it up the same way, with no registration.
