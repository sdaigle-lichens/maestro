import { defineConfig } from "vitest/config";
import { storybookTest } from "@storybook/addon-vitest/vitest-plugin";
import { playwright } from "@vitest/browser-playwright";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

const dirname = fileURLToPath(new URL(".", import.meta.url));

// Two projects: the node unit tests (`pnpm test` runs only these) and the Storybook stories, which
// run in a real browser through the Storybook addon (the MCP's `test-run` tool, a11y included).
export default defineConfig({
  test: {
    projects: [
      { test: { name: "unit", environment: "node", include: ["test/**/*.test.ts"] } },
      {
        extends: true,
        plugins: [tailwindcss(), storybookTest({ configDir: `${dirname}.storybook` })],
        test: {
          name: "storybook",
          browser: { enabled: true, headless: true, provider: playwright({}), instances: [{ browser: "chromium" }] },
        },
      },
    ],
  },
});
