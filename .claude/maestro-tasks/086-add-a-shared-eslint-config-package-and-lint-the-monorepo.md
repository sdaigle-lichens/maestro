# Add a shared ESLint config package and lint the monorepo

Implement the following vertical slice. When complete, ensure every acceptance
criterion below is met.

## What to build

The monorepo has a root `lint` script (turbo run lint), but no package defines `lint`, ESLint isn't installed and there is no ESLint config, so linting silently does nothing. Agents look for a linter that doesn't exist. Add one, modelled on the shared config package of the sibling lichens-reglo-2 repo.

That repo's package (@reglo/eslint-config, flat config, ESLint 9) is the template. Its whole react-app.js is:

```js
import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2020, globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-hooks/exhaustive-deps': 'off',
      'react-refresh/only-export-components': 'off',
    },
  },
);
```

Its package depends on @eslint/js, eslint-plugin-react-hooks, eslint-plugin-react-refresh, globals and typescript-eslint, with eslint as a peer dependency. Each app has an eslint.config.js that spreads the shared config, adds its own ignores, and defines `"lint": "eslint ."`. CI runs `turbo run lint`.

Create the equivalent workspace package here, named in this repo's @repo/* convention. Unlike reglo, this repo has more than one runtime, so the package exports one config per context:
- a React/browser config for the desktop app's renderer and the UI package;
- a Node config for the desktop app's node-side core, Electron main and preload processes, its build scripts and tests;
- a CommonJS Node config for the plugin's hand-written runtime scripts, if it is practical to lint them.

Never lint the generated plugin libs (the bundles under the plugin's scripts/lib, except the one hand-maintained file), build output, or the tracked mirrors under .claude/scripts. Give every workspace package that has source a `lint` script, so the root `lint` actually runs, and add lint to the root `verify` pipeline that CI runs. Keep Prettier as the only formatter: no stylistic ESLint rules.

For existing violations: fix the mechanical ones. Where a recommended rule flags many existing sites for a reason that is deliberate in this codebase, turn it off or downgrade it in the shared config, with a one-line comment saying why, rather than suppressing it file by file. The goal is a lint run that passes on main, not a backlog of warnings.

The sandbox blocks pnpm, so installing the new dependencies (and updating the lockfile) may need the user to run `pnpm install` themselves. Ask for it rather than hand-editing the lockfile. Start after the tasks currently in flight are merged, because fixing violations touches files across the repo.

## Acceptance criteria

- [ ] A shared ESLint config workspace package exists, modelled on @reglo/eslint-config, with separate configs for the React/browser, Node and (if practical) CommonJS plugin-script contexts.
- [ ] Every workspace package with source has a `lint` script using the shared config, and the root `lint` runs them all.
- [ ] Generated plugin libs, build output and the .claude/scripts mirrors are ignored. Prettier stays the only formatter.
- [ ] The root lint passes with zero errors. Every rule turned off or downgraded relative to the recommended presets has a one-line reason in the shared config.
- [ ] Lint is part of the root `verify` pipeline that CI runs, and the lockfile is updated through `pnpm install`, not by hand.
- [ ] The full test suite and typecheck still pass, and the repo's developer documentation mentions how to run lint.

## Blocked by

- `081-expose-agent-fork-and-rule-move-as-plugin-clis-and-evaluate-an-app-mcp-channel-bridge.md`
- `083-make-the-orchestrator-robust-without-taskcreate-and-enforce-verdict-handoff-agreement.md`
