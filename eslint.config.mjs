// Root config: lints only the plugin's hand-written CommonJS runtime scripts, which belong to no
// workspace package (the plugin ships to end users and carries no package.json). Workspace
// packages lint themselves through `turbo run lint`.
import cjs from "@repo/eslint-config/cjs";

export default [
  { ignores: ["**/node_modules/**", "apps/**", "packages/**", ".claude/**"] },
  ...cjs.map((c) =>
    c.files
      ? { ...c, files: ["plugins/maestro/scripts/*.{cjs,js}", "plugins/maestro/scripts/lib/maestro-tasks.cjs"] }
      : c
  ),
];
