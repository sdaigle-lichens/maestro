// Node config: the app's core, Electron main/preload, build scripts and tests.
import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", "out"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,mts,js,mjs}"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.node },
    rules: {
      // Deliberate: a leading underscore marks an intentionally unused binding.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          destructuredArrayIgnorePattern: "^_",
        },
      ],
      // Deliberate: comments hold a zero-width space to spell a glob without closing the comment.
      "no-irregular-whitespace": ["error", { skipComments: true }],
    },
  },
  {
    // Deliberate: tests build loose fixtures and poke at private shapes, where `any` is the honest type.
    files: ["**/test/**", "**/*.test.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  }
);
