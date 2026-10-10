// CommonJS Node config: the plugin's hand-written runtime scripts (.cjs, and .js copied as .cjs).
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["**/scripts/lib/*", "!**/scripts/lib/maestro-tasks.cjs"] },
  {
    ...js.configs.recommended,
    files: ["**/*.{cjs,js}"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: globals.node },
  },
];
